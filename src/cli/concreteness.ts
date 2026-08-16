#!/usr/bin/env bun
/**
 * Measure concreteness for every message, and report whether it separates.
 *
 *   bun run concreteness
 *
 * Writes one private artifact per list — the per-message rows are per-person
 * data once joined to a sender, so they stay under `private/`. What reaches
 * the site is the distribution and the contrasts, never a row.
 *
 * The report is the point. A measure that fires on everything is worth exactly
 * as much as one that fires on nothing, and the last classifier returned
 * `substantive` for 162 of 164 replies before anyone checked. Every run prints
 * the share of messages at each level so that failure is visible immediately
 * rather than after it has been built on.
 */
import { parseArgs } from "node:util";
import { join } from "node:path";
import type { Event, MessageObserved, ReplyGraph } from "../schema/generated.ts";
import { JsonlEventStore } from "../store/jsonl-store.ts";
import { newText } from "../ingest/parse.ts";
import { concreteness, type Concreteness } from "../classify/concreteness.ts";
import { distinctiveness, MIN_TERMS, type Document } from "../classify/distinctiveness.ts";
import { BodyCache } from "../ingest/body-cache.ts";
import { ARTIFACTS_DIR, EVENTS_DIR, PRIVATE_DIR } from "../lib/paths.ts";
import { assertPublishableArtifact } from "../site/publishable.ts";

const { values } = parseArgs({
  options: { lists: { type: "string", default: "agentproto,agent2agent" } },
});
const lists = values.lists!.split(",").map((s) => s.trim());

// Thread membership comes from the reply graph, which must cover every list
// being measured — distinctiveness compares a message against its own thread.
const graphPath = join(ARTIFACTS_DIR, "reply-graph.json");
if (!(await Bun.file(graphPath).exists())) {
  throw new Error(`no ${graphPath}: run \`bun run graph --list <each list>\` first`);
}
const graph = (await Bun.file(graphPath).json()) as ReplyGraph;
const missing = lists.filter((l) => !graph.coverage.lists.includes(l));
if (missing.length) {
  // The reply graph covered agentproto alone for the whole of phase 3, which
  // is why the old classifier never saw the larger list. Fail loudly instead.
  throw new Error(
    `${graphPath} covers [${graph.coverage.lists.join(", ")}] but was asked for ` +
      `[${missing.join(", ")}]. Rebuild it with a --list for each.`,
  );
}
const threadOf = new Map(graph.nodes.map((n) => [n.message_id, n.thread_id]));

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

interface Row extends Concreteness {
  message_id: string;
  thread_id: string | null;
  /** own-thread minus other-thread similarity; null when too short to score. */
  distinctiveness: number | null;
  similarity_to_own_thread: number | null;
  list_name: string;
  sender_id: string;
  /** First parent reference, when the message declared one. */
  in_reply_to: string | null;
  sent_at: string | null;
}

const rows: Row[] = [];
/** Authored text, kept for the corpus-level distinctiveness pass. */
const textOf = new Map<string, string>();
let missingBody = 0;
for (const { eventId, payload } of observed) {
  if (superseded.has(eventId) || !payload.message_id) continue;
  if (!lists.includes(payload.list_name)) continue;
  const body = await bodies.get(payload.body.sha256);
  if (body === null) {
    missingBody++;
    continue;
  }
  // Authored text only: quoting a draft name is not the same as engaging with
  // one, and a reply must not inherit its parent's citations.
  const authoredText = newText(body);
  rows.push({
    message_id: payload.message_id,
    thread_id: threadOf.get(payload.message_id) ?? null,
    distinctiveness: null,
    similarity_to_own_thread: null,
    list_name: payload.list_name,
    sender_id: payload.sender_id,
    in_reply_to: payload.in_reply_to?.[0] ?? null,
    sent_at: payload.sent_at ?? null,
    ...concreteness(authoredText),
  });
  textOf.set(payload.message_id, authoredText);
}

// Distinctiveness is scored per list: "could this be pasted into another
// thread" is a question about *this* list's vocabulary, and pooling two lists
// would make cross-list boilerplate look distinctive.
for (const list of lists) {
  const own = rows.filter((r) => r.list_name === list && r.thread_id);
  const documents: Document[] = own.map((r) => ({
    message_id: r.message_id,
    thread_id: r.thread_id!,
    text: textOf.get(r.message_id) ?? "",
  }));
  const scored = new Map(distinctiveness(documents).map((d) => [d.message_id, d]));
  for (const row of own) {
    const score = scored.get(row.message_id);
    if (!score || score.terms < MIN_TERMS) continue;
    row.distinctiveness = score.distinctiveness;
    row.similarity_to_own_thread = score.similarity_to_own_thread;
  }
}

const generatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * Thread-level medians are withheld below this many messages.
 *
 * Matches `MIN_MESSAGES` in `laocoon.health` for the same reason: a measure
 * averaged over one or two values is not a measure, and publishing it invites
 * a reader to sort by it and read the noise as a finding.
 */
const MIN_THREAD_MESSAGES = 4;
/** ...and at least this many of them must actually have scored. */
const MIN_SCORED = 3;

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const value = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Number(value.toFixed(4));
}

function share(subset: Row[], predicate: (r: Row) => boolean): number {
  return subset.length ? Number((subset.filter(predicate).length / subset.length).toFixed(4)) : 0;
}

for (const list of lists) {
  const own = rows.filter((r) => r.list_name === list);
  if (own.length === 0) continue;
  const substantial = own.filter((r) => r.words >= 40);
  const distribution = {
    messages: own.length,
    over_40_words: substantial.length,
    // Every one of these must be strictly between 0 and 1 for the measure to
    // be carrying information at all.
    with_any_referent: share(own, (r) => r.referent_kinds > 0),
    with_draft: share(own, (r) => r.draft_references > 0),
    with_rfc: share(own, (r) => r.rfc_references > 0),
    with_section: share(own, (r) => r.section_references > 0),
    with_url: share(own, (r) => r.urls > 0),
    with_code: share(own, (r) => r.code_blocks > 0),
    with_normative: share(own, (r) => r.normative_keywords > 0),
    asks_a_question: share(own, (r) => r.questions > 0),
    contends: share(own, (r) => r.contends > 0),
    offers_nothing_checkable: share(substantial, (r) => r.offers_nothing_checkable),
    scored_for_distinctiveness: own.filter((r) => r.distinctiveness !== null).length,
    // At or below zero the message sits as comfortably in another thread on
    // this list as in the one it was sent to.
    not_more_like_own_thread: share(
      own.filter((r) => r.distinctiveness !== null),
      (r) => (r.distinctiveness ?? 1) <= 0,
    ),
    distinctiveness_percentiles: (() => {
      const values = own
        .map((r) => r.distinctiveness)
        .filter((d): d is number => d !== null)
        .sort((a, b) => a - b);
      const at = (q: number) => (values.length ? values[Math.floor(q * (values.length - 1))]! : null);
      return { p10: at(0.1), median: at(0.5), p90: at(0.9) };
    })(),
    referent_kinds_histogram: [0, 1, 2, 3, 4, 5].map((k) => ({
      kinds: k,
      messages: own.filter((r) => r.referent_kinds === k).length,
    })),
  };

  // Per-thread rollup, publishable. Per-message rows carry a sender_id and
  // stay private (PROBLEM.md section 7); a thread-level median names nobody
  // and is the same class of figure as reach or uptake.
  const byThread = new Map<string, Row[]>();
  for (const row of own) {
    if (!row.thread_id) continue;
    const group = byThread.get(row.thread_id) ?? [];
    group.push(row);
    byThread.set(row.thread_id, group);
  }
  const threadRows = [...byThread]
    .map(([threadId, group]) => {
      const scored = group.filter((r) => r.distinctiveness !== null);
      const long = group.filter((r) => r.words >= 40);
      // A two-message thread's "similarity to its own thread" is one pairwise
      // comparison, and it lands near the top of any ranking by chance. Sorting
      // the published table by this column made that visible immediately:
      // every high scorer was a thread of two. Below the floor the value is
      // withheld rather than shown small, because a reader cannot tell a noisy
      // 0.94 from a real one.
      const enough = group.length >= MIN_THREAD_MESSAGES;
      return {
        thread_id: threadId,
        messages: group.length,
        median_referent_kinds: medianOf(group.map((r) => r.referent_kinds)),
        median_distinctiveness:
          enough && scored.length >= MIN_SCORED
            ? medianOf(scored.map((r) => r.distinctiveness!))
            : null,
        share_offering_nothing_checkable:
          enough && long.length >= MIN_SCORED
            ? Number((long.filter((r) => r.offers_nothing_checkable).length / long.length).toFixed(3))
            : null,
        share_asking_a_question:
          enough
            ? Number((group.filter((r) => r.questions > 0).length / group.length).toFixed(3))
            : null,
        share_contending:
          enough
            ? Number((group.filter((r) => r.contends > 0).length / group.length).toFixed(3))
            : null,
      };
    })
    .sort((a, b) => b.messages - a.messages);

  const publicOut = join(ARTIFACTS_DIR, `thread-language-${list}.json`);
  const scoredThreads = threadRows.filter((t) => t.median_distinctiveness !== null).length;
  const publicArtifact = {
    schema_version: "1.0.0",
    derived: true,
    publication: "aggregate_public" as const,
    generated_at: generatedAt,
    generator: "laocoon.concreteness/0.2.0",
    list_name: list,
    distribution: {
      ...distribution,
      threads_total: threadRows.length,
      // Stated, so a reader can see how much of the corpus the thread-level
      // columns actually cover rather than assuming it is all of it.
      threads_above_message_floor: scoredThreads,
      message_floor: MIN_THREAD_MESSAGES,
    },
    threads: threadRows,
  };
  assertPublishableArtifact(publicOut, publicArtifact);
  await Bun.write(publicOut, JSON.stringify(publicArtifact, null, 2) + "\n");

  const out = join(PRIVATE_DIR, "artifacts", `concreteness-${list}.json`);
  await Bun.write(
    out,
    JSON.stringify(
      {
        schema_version: "1.0.0",
        derived: true,
        publication: "private",
        generated_at: generatedAt,
        generator: "laocoon.concreteness/0.1.0",
        list_name: list,
        distribution,
        messages: own,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ out, list, ...distribution }, null, 2));
}

if (missingBody) console.log(`${missingBody} messages skipped: body not in the local cache`);
