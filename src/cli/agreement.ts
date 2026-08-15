#!/usr/bin/env bun
/**
 * How much the two classifiers disagree.
 *
 *   bun run agreement
 *
 * PROBLEM.md section 6: disagreement between the 12b and the 31b model **flags a
 * case for review rather than resolving it silently**. There is no tie-break
 * here and there must not be one — picking a winner would manufacture a
 * confident label out of two models that do not agree, which is exactly the
 * false certainty the validation section exists to avoid.
 *
 * The per-message disagreement list is private: it is a set of per-message
 * quality labels, joinable to senders. The aggregate rate is a fact about the
 * method, and belongs in the published methodology.
 */
import { parseArgs } from "node:util";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { MessageClassified, PrivateEvent } from "../schema/generated.ts";
import { JsonlEventStore } from "../store/jsonl-store.ts";
import { PRIVATE_DIR } from "../lib/paths.ts";

const { values } = parseArgs({
  options: {
    a: { type: "string", default: "gemma4:12b" },
    b: { type: "string", default: "gemma4:31b" },
  },
});

const store = new JsonlEventStore<PrivateEvent>(join(PRIVATE_DIR, "events"), "private-event");

/** Latest verdict per (model, message, body digest). */
const verdicts = new Map<string, MessageClassified>();
for await (const event of store.read()) {
  if (event.event_type !== "MessageClassified") continue;
  const p = event.payload as unknown as MessageClassified;
  verdicts.set(`${p.model}|${p.message_id}|${p.body_sha256}`, p);
}

const byMessage = new Map<string, Map<string, MessageClassified>>();
for (const verdict of verdicts.values()) {
  const key = `${verdict.message_id}|${verdict.body_sha256}`;
  const entry = byMessage.get(key) ?? new Map<string, MessageClassified>();
  entry.set(verdict.model, verdict);
  byMessage.set(key, entry);
}

const matrix: Record<string, number> = {};
const flagged: { message_id: string; a: string; b: string; reason_a: string; reason_b: string }[] =
  [];
let compared = 0;
let agree = 0;
const coverage: Record<string, Record<string, number>> = {};

for (const [, entry] of byMessage) {
  for (const [model, verdict] of entry) {
    coverage[model] ??= {};
    coverage[model][verdict.verdict] = (coverage[model][verdict.verdict] ?? 0) + 1;
  }
  const first = entry.get(values.a!);
  const second = entry.get(values.b!);
  if (!first || !second) continue;
  compared += 1;
  matrix[`${first.verdict}/${second.verdict}`] =
    (matrix[`${first.verdict}/${second.verdict}`] ?? 0) + 1;
  if (first.verdict === second.verdict) {
    agree += 1;
  } else {
    flagged.push({
      message_id: first.message_id,
      a: first.verdict,
      b: second.verdict,
      reason_a: first.reason,
      reason_b: second.reason,
    });
  }
}

const report = {
  schema_version: "1.0.0",
  derived: true,
  publication: "private",
  generated_at: new Date().toISOString(),
  models: { a: values.a, b: values.b },
  coverage,
  compared,
  agree,
  disagree: compared - agree,
  agreement_rate: compared > 0 ? agree / compared : null,
  confusion: matrix,
  // Flagged, never resolved. A tie-break would invent certainty.
  flagged_for_review: flagged.sort((x, y) => x.message_id.localeCompare(y.message_id)),
};

await mkdir(join(PRIVATE_DIR, "artifacts"), { recursive: true });
const out = join(PRIVATE_DIR, "artifacts", "classifier-agreement.json");
await Bun.write(out, JSON.stringify(report, null, 2) + "\n");

console.log(
  JSON.stringify(
    {
      out,
      coverage,
      compared,
      agree,
      disagree: report.disagree,
      agreement_rate: report.agreement_rate,
      confusion: matrix,
    },
    null,
    2,
  ),
);
if (compared === 0) {
  console.log(
    `\nNothing to compare: no message has a verdict from both ${values.a} and ${values.b}.`,
  );
} else {
  console.log(
    `\n${report.disagree} message(s) flagged for review. Flagged, not resolved — ` +
      `there is deliberately no tie-break.`,
  );
}
