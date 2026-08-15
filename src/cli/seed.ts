#!/usr/bin/env bun
/**
 * Apply the community-conferred seed rule.
 *
 *   bun run seed
 *
 * Reads the public log (for every account that has posted) and the private log
 * (for identity resolution), applies `src/seed/rule.ts`, and writes
 * `private/artifacts/seed.json`.
 *
 * Nothing here touches the network: the rule is a pure function of facts already
 * recorded. Re-deciding the rule is a re-run, never a re-crawl and never an edit.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  DatatrackerRecordFetched,
  Event,
  MessageObserved,
  PrivateEvent,
  Seed,
  SenderResolved,
} from "../schema/generated.ts";
import { JsonlEventStore } from "../store/jsonl-store.ts";
import { assertValid } from "../store/validate.ts";
import { applySeedRule, SEED_RULE_VERSION } from "../seed/rule.ts";
import { EVENTS_DIR, PRIVATE_DIR } from "../lib/paths.ts";

const publicStore = new JsonlEventStore<Event>(EVENTS_DIR, "event");
const privateStore = new JsonlEventStore<PrivateEvent>(join(PRIVATE_DIR, "events"), "private-event");

/** Every account that has posted, from the public log. */
const accounts = new Set<string>();
const superseded = new Set<string>();
const observations: { eventId: string; senderId: string }[] = [];
for await (const event of publicStore.read()) {
  if (event.event_type === "ObservationSuperseded") {
    superseded.add((event.payload as { superseded_event_id: string }).superseded_event_id);
  } else if (event.event_type === "MessageObserved") {
    observations.push({ eventId: event.event_id, senderId: (event.payload as MessageObserved).sender_id });
  }
}
for (const o of observations) if (!superseded.has(o.eventId)) accounts.add(o.senderId);

/** Identity resolution, last write wins. */
const resolution = new Map<string, SenderResolved>();
const records = new Map<number, DatatrackerRecordFetched>();
for await (const event of privateStore.read()) {
  if (event.event_type === "SenderResolved") {
    const payload = event.payload as unknown as SenderResolved;
    resolution.set(payload.sender_id, payload);
  } else if (event.event_type === "DatatrackerRecordFetched") {
    const payload = event.payload as unknown as DatatrackerRecordFetched;
    records.set(payload.person_id, payload);
  }
}

const members: Seed["members"] = [];
const unseeded: Seed["unseeded"] = [];
const clauseCounts: Record<string, number> = {};
let resolvedToPerson = 0;
let noRecord = 0;
let recordsAvailable = 0;

for (const senderId of [...accounts].sort()) {
  const resolved = resolution.get(senderId);
  if (!resolved) {
    unseeded.push({ sender_id: senderId, person_id: null, reason: "not_resolved" });
    continue;
  }
  if (resolved.person_id === null) {
    noRecord += 1;
    unseeded.push({ sender_id: senderId, person_id: null, reason: "no_datatracker_record" });
    continue;
  }
  resolvedToPerson += 1;

  const record = records.get(resolved.person_id);
  if (!record) {
    unseeded.push({ sender_id: senderId, person_id: resolved.person_id, reason: "record_missing" });
    continue;
  }
  recordsAvailable += 1;

  const verdict = applySeedRule(record);
  if (!verdict.seeded) {
    unseeded.push({
      sender_id: senderId,
      person_id: resolved.person_id,
      reason: "no_clause_matched",
    });
    continue;
  }
  for (const clause of verdict.clauses) clauseCounts[clause] = (clauseCounts[clause] ?? 0) + 1;
  // `seeded` is true exactly when at least one clause matched, so the non-empty
  // tuple the schema requires is guaranteed here.
  const [first, ...rest] = verdict.clauses as [string, ...string[]];
  members.push({
    sender_id: senderId,
    person_id: resolved.person_id,
    clauses: [first, ...rest],
  });
}

const seed: Seed = {
  schema_version: "1.0.0",
  derived: true,
  publication: "private",
  generated_at: new Date().toISOString(),
  seed_rule_version: SEED_RULE_VERSION,
  counts: {
    addresses_seen: accounts.size,
    resolved_to_person: resolvedToPerson,
    no_datatracker_record: noRecord,
    records_available: recordsAvailable,
    seeded: members.length,
    unseeded: unseeded.length,
  },
  clause_counts: clauseCounts,
  members,
  unseeded,
};

await assertValid("seed", seed);
const out = join(PRIVATE_DIR, "artifacts", "seed.json");
await mkdir(join(PRIVATE_DIR, "artifacts"), { recursive: true });
await Bun.write(out, JSON.stringify(seed, null, 2) + "\n");

console.log(JSON.stringify({ out, ...seed.counts, clause_counts: clauseCounts }, null, 2));
console.log(
  `\nseed rule ${SEED_RULE_VERSION} — published in docs/seed-rule.md. ` +
    `Membership stays private; anyone can recompute it from the rule and the public API.`,
);
