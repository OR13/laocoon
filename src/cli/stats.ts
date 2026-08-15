#!/usr/bin/env bun
/**
 * What the event log currently holds, and what it does not.
 *
 *   bun run stats
 *
 * Coverage is reported per list from the recorded crawl windows rather than
 * inferred from the messages present, so a list that was crawled and found empty
 * is distinguishable from a list that was never crawled.
 */
import type { CrawlWindowCompleted, MessageObserved } from "../schema/generated.ts";
import { JsonlEventStore } from "../store/jsonl-store.ts";
import { EVENTS_DIR } from "../lib/paths.ts";

const store = new JsonlEventStore(EVENTS_DIR);

const byType: Record<string, number> = {};
const lists = new Map<
  string,
  {
    messages: number;
    withoutMessageId: number;
    withoutThreadingHeaders: number;
    windows: number;
    lastWindow: CrawlWindowCompleted | null;
    failures: number;
    sentFrom: string | null;
    sentTo: string | null;
    senders: Set<string>;
  }
>();

const stateFor = (name: string) => {
  let s = lists.get(name);
  if (!s) {
    s = {
      messages: 0,
      withoutMessageId: 0,
      withoutThreadingHeaders: 0,
      windows: 0,
      lastWindow: null,
      failures: 0,
      sentFrom: null,
      sentTo: null,
      senders: new Set(),
    };
    lists.set(name, s);
  }
  return s;
};

const superseded = new Set<string>();
const events: { id: string; type: string; payload: unknown }[] = [];

for await (const event of store.read()) {
  byType[event.event_type] = (byType[event.event_type] ?? 0) + 1;
  events.push({ id: event.event_id, type: event.event_type, payload: event.payload });
  if (event.event_type === "ObservationSuperseded") {
    superseded.add((event.payload as { superseded_event_id: string }).superseded_event_id);
  }
}

for (const event of events) {
  if (event.type === "MessageObserved") {
    if (superseded.has(event.id)) continue;
    const p = event.payload as MessageObserved;
    const s = stateFor(p.list_name);
    s.messages += 1;
    s.senders.add(p.sender_id);
    if (!p.message_id) s.withoutMessageId += 1;
    if (p.in_reply_to.length === 0 && p.references.length === 0) s.withoutThreadingHeaders += 1;
    if (p.sent_at) {
      if (!s.sentFrom || p.sent_at < s.sentFrom) s.sentFrom = p.sent_at;
      if (!s.sentTo || p.sent_at > s.sentTo) s.sentTo = p.sent_at;
    }
  } else if (event.type === "CrawlWindowCompleted") {
    const p = event.payload as CrawlWindowCompleted;
    const s = stateFor(p.list_name);
    s.windows += 1;
    s.lastWindow = p;
    s.failures += p.failures.length;
  }
}

console.log(`events: ${await store.count()}`);
for (const [type, n] of Object.entries(byType).sort()) console.log(`  ${type}: ${n}`);
console.log();

for (const [name, s] of [...lists].sort()) {
  const w = s.lastWindow;
  const coverage =
    w === null
      ? "never crawled"
      : `${s.messages}/${w.mailbox_total} of the mailbox as of ${w.completed_at}`;
  console.log(`${name}`);
  console.log(`  live observations:            ${s.messages}`);
  console.log(`  distinct sender ids:          ${s.senders.size}`);
  console.log(`  no Message-ID header:         ${s.withoutMessageId}`);
  console.log(`  no threading headers:         ${s.withoutThreadingHeaders}`);
  console.log(`  sent range:                   ${s.sentFrom ?? "-"} .. ${s.sentTo ?? "-"}`);
  console.log(`  crawl windows:                ${s.windows} (${s.failures} failed UIDs)`);
  console.log(`  coverage:                     ${coverage}`);
  if (w && s.messages < w.mailbox_total) {
    console.log(
      `  GAP: ${w.mailbox_total - s.messages} message(s) in the mailbox are not in the log.`,
    );
  }
  console.log();
}
