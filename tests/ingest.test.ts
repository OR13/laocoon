import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlEventStore } from "../src/store/jsonl-store.ts";
import { ingestList } from "../src/ingest/ingest.ts";
import { replay } from "../src/events/replay.ts";
import { senderId } from "../src/lib/hash.ts";
import { BodyCache } from "../src/ingest/body-cache.ts";
import { PrivateSenderMap } from "../src/identity/private-map.ts";
import type { Event, MessageObserved, ObservationSuperseded } from "../src/schema/generated.ts";
import { FixtureSource, rfc822 } from "./fixture-source.ts";

const dirs: string[] = [];
async function tempStore(): Promise<JsonlEventStore> {
  const dir = await mkdtemp(join(tmpdir(), "laocoon-ingest-"));
  dirs.push(dir);
  return new JsonlEventStore(dir);
}
/** Body cache and private sender map redirected into a temp dir, so a test run
 *  never touches the real `.cache/` or `private/`. */
let sandbox: { bodies: BodyCache; senders: PrivateSenderMap };

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "laocoon-sandbox-"));
  dirs.push(dir);
  sandbox = {
    bodies: new BodyCache(join(dir, "bodies")),
    senders: new PrivateSenderMap(join(dir, "senders.jsonl")),
  };
});

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const clock = (iso: string) => () => new Date(iso);

async function collect(store: JsonlEventStore): Promise<Event[]> {
  const out: Event[] = [];
  for await (const e of store.read()) out.push(e);
  return out;
}

describe("ingestList", () => {
  test("turns messages into observations and records the window", async () => {
    const store = await tempStore();
    const source = new FixtureSource([
      { uid: 1, raw: rfc822({ messageId: "a@x" }) },
      { uid: 2, raw: rfc822({ messageId: "b@x", inReplyTo: "a@x" }) },
    ]);

    const report = await ingestList(source, store, {
      listName: "testlist", ...sandbox,
      now: clock("2026-08-15T12:00:00.000Z"),
    });

    expect(report.messagesNew).toBe(2);
    expect(report.messagesUnchanged).toBe(0);
    expect(report.watermarkAfter).toBe(2);
    expect(report.failures).toEqual([]);
    // two observations plus one crawl window
    expect(report.eventsAppended).toBe(3);

    const events = await collect(store);
    const window = events.find((e) => e.event_type === "CrawlWindowCompleted");
    expect(window?.payload).toMatchObject({
      list_name: "testlist",
      mode: "incremental",
      mailbox_total: 2,
      watermark_before: null,
      watermark_after: 2,
      uids_examined: 2,
    });
  });

  test("stores a sender hash, never the address", async () => {
    const store = await tempStore();
    const source = new FixtureSource([
      { uid: 1, raw: rfc822({ messageId: "a@x", from: "Someone <Someone@Example.ORG>" }) },
    ]);
    await ingestList(source, store, { listName: "testlist", ...sandbox, now: clock("2026-08-15T12:00:00.000Z") });

    const events = await collect(store);
    const observed = events.find((e) => e.event_type === "MessageObserved")!;
    expect((observed.payload as MessageObserved).sender_id).toBe(senderId("someone@example.org"));
    expect(JSON.stringify(events)).not.toContain("example.org");
  });

  test("a second crawl of unchanged material appends only the window", async () => {
    const store = await tempStore();
    const messages = [{ uid: 1, raw: rfc822({ messageId: "a@x" }) }];

    await ingestList(new FixtureSource(messages), store, {
      listName: "testlist", ...sandbox,
      now: clock("2026-08-15T12:00:00.000Z"),
    });
    const second = await ingestList(new FixtureSource(messages), store, {
      listName: "testlist", ...sandbox,
      mode: "full",
      now: clock("2026-08-16T12:00:00.000Z"),
    });

    expect(second.messagesUnchanged).toBe(1);
    expect(second.messagesNew).toBe(0);
    expect(second.eventsAppended).toBe(1); // the crawl window only
  });

  test("incremental mode only looks above the watermark", async () => {
    const store = await tempStore();
    await ingestList(new FixtureSource([{ uid: 1, raw: rfc822({ messageId: "a@x" }) }]), store, {
      listName: "testlist", ...sandbox,
      now: clock("2026-08-15T12:00:00.000Z"),
    });

    const second = await ingestList(
      new FixtureSource([
        { uid: 1, raw: rfc822({ messageId: "a@x" }) },
        { uid: 2, raw: rfc822({ messageId: "b@x" }) },
      ]),
      store,
      { listName: "testlist", ...sandbox, now: clock("2026-08-16T12:00:00.000Z") },
    );

    expect(second.uidsExamined).toBe(1);
    expect(second.watermarkBefore).toBe(1);
    expect(second.messagesNew).toBe(1);
  });

  test("changed content is a compensating event, never an edit", async () => {
    const store = await tempStore();
    await ingestList(new FixtureSource([{ uid: 1, raw: rfc822({ messageId: "a@x" }) }]), store, {
      listName: "testlist", ...sandbox,
      now: clock("2026-08-15T12:00:00.000Z"),
    });
    const before = await collect(store);
    const original = before.find((e) => e.event_type === "MessageObserved")!;

    const second = await ingestList(
      new FixtureSource([
        { uid: 1, raw: rfc822({ messageId: "a@x", subject: "edited in the archive" }) },
      ]),
      store,
      { listName: "testlist", ...sandbox, mode: "full", now: clock("2026-08-16T12:00:00.000Z") },
    );

    expect(second.messagesSuperseded).toBe(1);
    const after = await collect(store);
    // The original event is still there, byte for byte.
    expect(after.find((e) => e.event_id === original.event_id)).toEqual(original);

    const correction = after.find((e) => e.event_type === "ObservationSuperseded")!;
    const payload = correction.payload as ObservationSuperseded;
    expect(payload.superseded_event_id).toBe(original.event_id);
    expect(payload.reason).toBe("content_changed");

    // Replay hides the superseded observation without deleting it.
    const state = await replay(store);
    expect(state.lists.get("testlist")!.supersededEventIds.has(original.event_id)).toBe(true);
    expect(state.lists.get("testlist")!.observations.get(1)!.eventId).toBe(
      payload.superseding_event_id,
    );
  });

  test("--max truncates and says so", async () => {
    const store = await tempStore();
    const source = new FixtureSource([
      { uid: 1, raw: rfc822({ messageId: "a@x" }) },
      { uid: 2, raw: rfc822({ messageId: "b@x" }) },
      { uid: 3, raw: rfc822({ messageId: "c@x" }) },
    ]);
    const report = await ingestList(source, store, {
      listName: "testlist", ...sandbox,
      maxMessages: 2,
      now: clock("2026-08-15T12:00:00.000Z"),
    });
    expect(report.truncated).toBe(true);
    expect(report.uidsExamined).toBe(2);
    expect(report.mailboxTotal).toBe(3);
  });

  test("a message the source cannot return is a recorded failure, not a silent gap", async () => {
    const store = await tempStore();
    const source = new FixtureSource([{ uid: 1, raw: rfc822({ messageId: "a@x" }) }]);
    // Ask for a UID the source lists but then declines to return.
    source.uids = async () => [1, 99];

    const report = await ingestList(source, store, {
      listName: "testlist", ...sandbox,
      now: clock("2026-08-15T12:00:00.000Z"),
    });
    expect(report.failures).toEqual([
      { uid: 99, reason: "uid listed but not returned by source" },
    ]);
  });

  test("a UIDVALIDITY change forces a full re-examination", async () => {
    const store = await tempStore();
    const messages = [{ uid: 1, raw: rfc822({ messageId: "a@x" }) }];
    await ingestList(new FixtureSource(messages, 1), store, {
      listName: "testlist", ...sandbox,
      now: clock("2026-08-15T12:00:00.000Z"),
    });

    const second = await ingestList(new FixtureSource(messages, 2), store, {
      listName: "testlist", ...sandbox,
      now: clock("2026-08-16T12:00:00.000Z"),
    });

    expect(second.mode).toBe("full");
    expect(second.watermarkBefore).toBeNull();
    expect(second.messagesNew).toBe(1); // uid_validity is part of the observation
  });
});
