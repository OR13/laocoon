#!/usr/bin/env bun
/**
 * Compute per-thread measures and record them in the public log.
 *
 *   bun run measure
 *   bun run measure --as-of 2026-08-08T00:00:00Z
 *
 * The measures are computed in Python and handed back as JSON, then wrapped into
 * `ThreadMeasured` events here — event construction stays in one place.
 *
 * These events are public. What makes that acceptable is that they are per
 * thread: the per-message substance verdicts they aggregate stay in the private
 * log, because a per-message quality label joined to a sender would be a
 * per-person quality score. This command refuses to emit a measure that carries
 * a sender hash.
 */
import { parseArgs } from "node:util";
import { join } from "node:path";
import type { Event, SourceRef, ThreadMeasured } from "../schema/generated.ts";
import { JsonlEventStore } from "../store/jsonl-store.ts";
import { makeEvent } from "../events/factory.ts";
import { PROMPT_HASH, PROMPT_VERSION } from "../classify/prompt.ts";
import { assertNoSenderHash } from "../site/publishable.ts";
import { ARTIFACTS_DIR, EVENTS_DIR, PRIVATE_DIR, repoPath } from "../lib/paths.ts";

const { values } = parseArgs({
  options: {
    "as-of": { type: "string" },
    list: { type: "string", default: "agentproto" },
    model: { type: "string", default: "gemma4:12b" },
    "window-days": { type: "string", default: "7" },
  },
});

const asOf = values["as-of"] ?? new Date().toISOString();
const seedPath = join(PRIVATE_DIR, "artifacts", "seed.json");
if (!(await Bun.file(seedPath).exists())) throw new Error(`no ${seedPath}: run \`bun run seed\``);

const out = join(ARTIFACTS_DIR, "thread-measures.json");
const proc = Bun.spawn(
  [
    "uv", "run", "--quiet", "--directory", repoPath("python"),
    "python", "-m", "laocoon.measures",
    "--events", repoPath("events"),
    "--private-events", join(PRIVATE_DIR, "events"),
    "--seed", seedPath,
    "--out", out,
    "--as-of", asOf,
    "--window-days", values["window-days"]!,
    "--model", values.model!,
    "--prompt-hash", PROMPT_HASH,
    "--prompt-version", PROMPT_VERSION,
    "--health", join(ARTIFACTS_DIR, `health-${values.list}.json`),
    "--list", values.list!,
  ],
  { stdout: "inherit", stderr: "inherit" },
);
if ((await proc.exited) !== 0) throw new Error("laocoon.measures failed");

const measures = (await Bun.file(out).json()) as ThreadMeasured[];

// A measure is published. A sender hash inside one would make it a per-person
// record, so the check is here rather than in a review comment. The classifier's
// prompt hash is the same shape and is allowed by name, never by pattern —
// loosening the pattern would let a sender hash through with it.
assertNoSenderHash(
  "thread measures",
  JSON.stringify(measures),
  [PROMPT_HASH, ...measures.map((m) => m.provenance.prompt_hash)],
);

const SOURCE: SourceRef = { kind: "projection", name: "laocoon.measures" };
const store = new JsonlEventStore<Event>(EVENTS_DIR, "event");
const now = new Date().toISOString();
const result = await store.append(
  measures.map((measure) => makeEvent("ThreadMeasured", measure, SOURCE, now)),
);

console.log(
  JSON.stringify(
    {
      as_of: asOf,
      threads: measures.length,
      events_appended: result.appended,
      events_duplicate: result.duplicates,
    },
    null,
    2,
  ),
);
if (result.duplicates > 0) {
  console.log(
    `\n${result.duplicates} measure(s) unchanged for this horizon — recomputing the same ` +
      `horizon from the same inputs is a no-op by construction.`,
  );
}
