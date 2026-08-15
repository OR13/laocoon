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
import type { Event, MessageObserved } from "../schema/generated.ts";
import { JsonlEventStore } from "../store/jsonl-store.ts";
import { newText } from "../ingest/parse.ts";
import { concreteness, type Concreteness } from "../classify/concreteness.ts";
import { BodyCache } from "../ingest/body-cache.ts";
import { EVENTS_DIR, PRIVATE_DIR } from "../lib/paths.ts";

const { values } = parseArgs({
  options: { lists: { type: "string", default: "agentproto,agent2agent" } },
});
const lists = values.lists!.split(",").map((s) => s.trim());

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
  list_name: string;
  sender_id: string;
  /** First parent reference, when the message declared one. */
  in_reply_to: string | null;
  sent_at: string | null;
}

const rows: Row[] = [];
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
  rows.push({
    message_id: payload.message_id,
    list_name: payload.list_name,
    sender_id: payload.sender_id,
    in_reply_to: payload.in_reply_to?.[0] ?? null,
    sent_at: payload.sent_at ?? null,
    ...concreteness(newText(body)),
  });
}

const generatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

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
    referent_kinds_histogram: [0, 1, 2, 3, 4, 5].map((k) => ({
      kinds: k,
      messages: own.filter((r) => r.referent_kinds === k).length,
    })),
  };

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
