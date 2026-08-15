#!/usr/bin/env bun
/**
 * Score the system against what actually happened, and record the result.
 *
 *   bun run holdout
 *   bun run holdout --horizon-days 7
 *
 * Runs the temporal holdout from PROBLEM.md section 6 over a rolling series of
 * origins, and appends one `ForecastEvaluated` event per origin per forecaster
 * to the public log. The accuracy of this system is a published figure — an
 * experimental system that shows its own hit rate is credible, and a confident
 * unvalidated score is not.
 *
 * The baseline is recorded alongside the others, always. A result that does not
 * beat raw reply volume is the finding, not something to leave out.
 */
import { parseArgs } from "node:util";
import { join } from "node:path";
import type { Event, ForecastEvaluated, SourceRef } from "../schema/generated.ts";
import { JsonlEventStore } from "../store/jsonl-store.ts";
import { makeEvent } from "../events/factory.ts";
import { ARTIFACTS_DIR, EVENTS_DIR, PRIVATE_DIR, repoPath } from "../lib/paths.ts";

const { values } = parseArgs({
  options: {
    "horizon-days": { type: "string", default: "7" },
    "origin-step-days": { type: "string" },
    origin: { type: "string", multiple: true },
    list: { type: "string", default: "agentproto" },
    model: { type: "string", default: "gemma4:12b" },
  },
});

const seedPath = join(PRIVATE_DIR, "artifacts", "seed.json");
if (!(await Bun.file(seedPath).exists())) throw new Error(`no ${seedPath}: run \`bun run seed\``);

const out = join(ARTIFACTS_DIR, "holdout.json");
const args = [
  "run", "--quiet", "--directory", repoPath("python"),
  "python", "-m", "laocoon.holdout",
  "--events", repoPath("events"),
  "--private-events", join(PRIVATE_DIR, "events"),
  "--seed", seedPath,
  "--out", out,
  "--horizon-days", values["horizon-days"]!,
  "--model", values.model!,
  "--list", values.list!,
];
if (values["origin-step-days"]) args.push("--origin-step-days", values["origin-step-days"]);
for (const origin of values.origin ?? []) args.push("--origin", origin);

const proc = Bun.spawn(["uv", ...args], { stdout: "inherit", stderr: "inherit" });
if ((await proc.exited) !== 0) throw new Error("laocoon.holdout failed");

const evaluations = (await Bun.file(out).json()) as ForecastEvaluated[];
const SOURCE: SourceRef = { kind: "projection", name: "laocoon.holdout" };
const store = new JsonlEventStore<Event>(EVENTS_DIR, "event");
const now = new Date().toISOString();
const result = await store.append(
  evaluations.map((evaluation) => makeEvent("ForecastEvaluated", evaluation, SOURCE, now)),
);

const baseline = evaluations.filter((e) => e.is_baseline);
const tested = evaluations.filter((e) => !e.is_baseline);
const beat = tested.filter((e) => {
  const peer = baseline.find((b) => b.origin_at === e.origin_at);
  return e.spearman !== null && peer?.spearman != null && e.spearman > peer.spearman;
});

console.log(
  JSON.stringify(
    {
      evaluations: evaluations.length,
      events_appended: result.appended,
      events_duplicate: result.duplicates,
      non_baseline_runs: tested.length,
      non_baseline_runs_beating_baseline: beat.length,
    },
    null,
    2,
  ),
);
