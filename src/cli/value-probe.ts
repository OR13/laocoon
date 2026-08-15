#!/usr/bin/env bun
/**
 * Probe the contribution prompt on a sample, before spending a full pass.
 *
 *   bun run value-probe --limit 60
 *   bun run value-probe --limit 60 --model gemma4:31b
 *
 * A full pass over 1,339 messages takes tens of minutes of GPU time. The last
 * classifier was run to completion before anyone looked at whether its output
 * varied, and it turned out to have returned the same answer 162 times out of
 * 164. This runs a stratified sample first and prints the share of messages on
 * which each of the six flags fires.
 *
 * **What counts as a pass:** every flag strictly between 0 and 1, and the six
 * not all moving together. A flag that is always true carries no information;
 * six flags that always agree are one flag with five aliases.
 */
import { parseArgs } from "node:util";
import type { Event, MessageObserved, ReplyGraph } from "../schema/generated.ts";
import { JsonlEventStore } from "../store/jsonl-store.ts";
import { BodyCache } from "../ingest/body-cache.ts";
import { newText } from "../ingest/parse.ts";
import { OllamaClient } from "../classify/ollama.ts";
import {
  parseValueVerdict,
  renderValuePrompt,
  VALUE_PROMPT_HASH,
  VALUE_PROPERTIES,
  type ValueProperty,
} from "../classify/value-prompt.ts";
import { ARTIFACTS_DIR, EVENTS_DIR } from "../lib/paths.ts";
import { join } from "node:path";

const { values } = parseArgs({
  options: {
    limit: { type: "string", default: "60" },
    model: { type: "string", default: "gemma4:12b" },
  },
});
const limit = Number(values.limit);
const model = values.model!;

const graph = (await Bun.file(join(ARTIFACTS_DIR, "reply-graph.json")).json()) as ReplyGraph;
const bodies = new BodyCache();

const store = new JsonlEventStore<Event>(EVENTS_DIR, "event");
const superseded = new Set<string>();
const observed: { eventId: string; payload: MessageObserved }[] = [];
for await (const event of store.read()) {
  if (event.event_type === "ObservationSuperseded") {
    superseded.add((event.payload as { superseded_event_id: string }).superseded_event_id);
  } else if (event.event_type === "MessageObserved") {
    observed.push({ eventId: event.event_id, payload: event.payload as MessageObserved });
  }
}
const digestOf = new Map<string, string>();
const listOf = new Map<string, string>();
for (const o of observed) {
  if (superseded.has(o.eventId) || !o.payload.message_id) continue;
  digestOf.set(o.payload.message_id, o.payload.body.sha256);
  listOf.set(o.payload.message_id, o.payload.list_name);
}

const nodeOf = new Map(graph.nodes.map((n) => [n.message_id, n]));
const threadOf = new Map(graph.nodes.map((n) => [n.message_id, n.thread_id]));
const subjectOf = new Map(graph.threads.map((t) => [t.thread_id, t.subject]));
/** Thread members in send order, for the context block. */
const membersByThread = new Map<string, typeof graph.nodes>();
for (const node of graph.nodes) {
  const list = membersByThread.get(node.thread_id) ?? [];
  list.push(node);
  membersByThread.set(node.thread_id, list);
}
for (const list of membersByThread.values()) {
  list.sort((a, b) => (a.sent_at ?? "").localeCompare(b.sent_at ?? ""));
}

async function authored(messageId: string): Promise<string | null> {
  const digest = digestOf.get(messageId);
  if (!digest) return null;
  const body = await bodies.get(digest);
  return body === null ? null : newText(body);
}

// Stratify by list, so a probe is not a report about the larger corpus only.
const byList = new Map<string, string[]>();
for (const edge of graph.edges) {
  const list = listOf.get(edge.child);
  if (!list) continue;
  const own = byList.get(list) ?? [];
  own.push(edge.child);
  byList.set(list, own);
}
const sample: { child: string; parent: string }[] = [];
const parentOf = new Map(graph.edges.map((e) => [e.child, e.parent]));
const perList = Math.max(1, Math.floor(limit / Math.max(1, byList.size)));
for (const [, children] of byList) {
  // Evenly spaced through the list's history rather than the first N, so the
  // sample is not all from one week.
  const step = Math.max(1, Math.floor(children.length / perList));
  for (let i = 0; i < children.length && sample.length < limit; i += step) {
    const child = children[i]!;
    const parent = parentOf.get(child);
    if (parent) sample.push({ child, parent });
  }
}

const ollama = new OllamaClient();
const available = await ollama.models();
if (!available.includes(model)) {
  throw new Error(`ollama does not have ${model}. Available: ${available.join(", ")}`);
}

const counts = Object.fromEntries(VALUE_PROPERTIES.map((p) => [p, 0])) as Record<
  ValueProperty,
  number
>;
const rows: Record<string, unknown>[] = [];
let judged = 0;
let unparsed = 0;
let skipped = 0;

for (const [index, { child, parent }] of sample.entries()) {
  const replyText = await authored(child);
  const parentText = await authored(parent);
  if (!replyText || !parentText || replyText.trim().length < 20) {
    skipped++;
    continue;
  }
  const threadId = threadOf.get(child) ?? "";
  const earlier = (membersByThread.get(threadId) ?? [])
    .filter((n) => n.message_id !== child && (n.sent_at ?? "") < (nodeOf.get(child)?.sent_at ?? ""))
    .slice(-6);
  const context: string[] = [];
  for (const node of earlier) {
    const text = await authored(node.message_id);
    if (text) context.push(text.slice(0, 700));
  }

  const prompt = renderValuePrompt({
    subject: subjectOf.get(threadId) ?? "(unknown)",
    context,
    parent: parentText,
    reply: replyText,
  });

  const { text, durationMs } = await ollama.generateJson(model, prompt, 400);
  const verdict = parseValueVerdict(text);
  if (!verdict) {
    unparsed++;
    console.error(`unparsed (${child}): ${text.slice(0, 160)}`);
    continue;
  }
  judged++;
  for (const key of VALUE_PROPERTIES) if (verdict.properties[key]!.value) counts[key]++;
  rows.push({
    message_id: child,
    list_name: listOf.get(child),
    words: replyText.split(/\s+/).filter(Boolean).length,
    ...Object.fromEntries(VALUE_PROPERTIES.map((p) => [p, verdict.properties[p]!.value])),
    quotes: Object.fromEntries(
      VALUE_PROPERTIES.map((p) => [p, verdict.properties[p]!.quote]).filter(([, q]) => q),
    ),
  });
  if ((index + 1) % 10 === 0) {
    console.error(`  ${judged} judged, ${Math.round(durationMs)} ms last`);
  }
}

/** How often two flags give the same answer. 1.0 means one is redundant. */
function agreement(a: ValueProperty, b: ValueProperty): number {
  const same = rows.filter((r) => r[a] === r[b]).length;
  return rows.length ? Number((same / rows.length).toFixed(3)) : 0;
}

const distribution = Object.fromEntries(
  VALUE_PROPERTIES.map((p) => [p, judged ? Number((counts[p] / judged).toFixed(3)) : 0]),
);
const degenerate = VALUE_PROPERTIES.filter((p) => {
  const share = judged ? counts[p] / judged : 0;
  return share === 0 || share === 1;
});
const redundant = VALUE_PROPERTIES.flatMap((a, i) =>
  VALUE_PROPERTIES.slice(i + 1)
    .filter((b) => agreement(a, b) >= 0.95)
    .map((b) => `${a} == ${b} (${agreement(a, b)})`),
);

const report = {
  model,
  prompt_hash: VALUE_PROMPT_HASH,
  sampled: sample.length,
  judged,
  unparsed,
  skipped,
  per_list: Object.fromEntries(
    [...byList.keys()].map((list) => [list, rows.filter((r) => r.list_name === list).length]),
  ),
  distribution,
  // The two ways this prompt can fail without erroring.
  degenerate_flags: degenerate,
  redundant_pairs: redundant,
  verdict:
    degenerate.length === 0 && redundant.length === 0
      ? "six independent flags, all varying"
      : "does not separate — see degenerate_flags / redundant_pairs",
};
console.log(JSON.stringify(report, null, 2));
await Bun.write(
  join(ARTIFACTS_DIR, "..", ".git-ignored", "value-probe.json"),
  JSON.stringify({ report, rows }, null, 2) + "\n",
);
