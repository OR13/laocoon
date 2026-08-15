import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlEventStore } from "../src/store/jsonl-store.ts";
import { EventValidationError } from "../src/store/validate.ts";
import { eventId, makeEvent } from "../src/events/factory.ts";
import type { Event, MessageObserved, SourceRef } from "../src/schema/generated.ts";

const SOURCE: SourceRef = { kind: "fixture", name: "test" };

const dirs: string[] = [];
async function tempStore(): Promise<JsonlEventStore> {
  const dir = await mkdtemp(join(tmpdir(), "laocoon-store-"));
  dirs.push(dir);
  return new JsonlEventStore(dir);
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function observation(uid: number, overrides: Partial<MessageObserved> = {}): MessageObserved {
  return {
    list_name: "testlist",
    uid,
    uid_validity: 1,
    message_id: `m${uid}@example.org`,
    in_reply_to: [],
    references: [],
    subject: `subject ${uid}`,
    sent_at: "2026-08-01T00:00:00.000Z",
    sent_at_raw: "Sat, 1 Aug 2026 00:00:00 +0000",
    sender_id: "sha256:" + "0".repeat(64),
    body: { sha256: "sha256:" + "1".repeat(64), chars: 10, lines: 1, quoted_lines: 0, unquoted_lines: 1 },
    ...overrides,
  };
}

function event(uid: number, observedAt: string, overrides: Partial<MessageObserved> = {}): Event {
  return makeEvent("MessageObserved", observation(uid, overrides), SOURCE, observedAt);
}

describe("event identity", () => {
  test("the id covers the payload and excludes when it was observed", () => {
    const a = event(1, "2026-08-01T10:00:00.000Z");
    const b = event(1, "2026-09-30T23:59:59.000Z");
    expect(a.event_id).toBe(b.event_id);
  });

  test("the id changes when any observed fact changes", () => {
    const a = eventId("MessageObserved", observation(1));
    const b = eventId("MessageObserved", observation(1, { subject: "different" }));
    expect(a).not.toBe(b);
  });

  test("field insertion order does not change the id", () => {
    const base = observation(1);
    const reordered = Object.fromEntries(
      Object.entries(base).reverse(),
    ) as unknown as MessageObserved;
    expect(eventId("MessageObserved", reordered)).toBe(eventId("MessageObserved", base));
  });
});

describe("JsonlEventStore", () => {
  test("appends, reads back in order, and counts", async () => {
    const store = await tempStore();
    const result = await store.append([
      event(1, "2026-08-01T10:00:00.000Z"),
      event(2, "2026-08-01T10:00:01.000Z"),
    ]);
    expect(result).toEqual({ appended: 2, duplicates: 0 });

    const read: Event[] = [];
    for await (const e of store.read()) read.push(e);
    expect(read.map((e) => (e.payload as MessageObserved).uid)).toEqual([1, 2]);
    expect(await store.count()).toBe(2);
  });

  test("re-observing the same fact appends nothing", async () => {
    const store = await tempStore();
    await store.append([event(1, "2026-08-01T10:00:00.000Z")]);
    const second = await store.append([event(1, "2026-08-02T10:00:00.000Z")]);
    expect(second).toEqual({ appended: 0, duplicates: 1 });
    expect(await store.count()).toBe(1);
  });

  test("deduplicates within a single batch", async () => {
    const store = await tempStore();
    const result = await store.append([
      event(1, "2026-08-01T10:00:00.000Z"),
      event(1, "2026-08-01T10:00:00.000Z"),
    ]);
    expect(result).toEqual({ appended: 1, duplicates: 1 });
  });

  test("dedupe survives a fresh store over the same directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "laocoon-store-"));
    dirs.push(dir);
    await new JsonlEventStore(dir).append([event(1, "2026-08-01T10:00:00.000Z")]);
    const reopened = await new JsonlEventStore(dir).append([event(1, "2026-08-05T10:00:00.000Z")]);
    expect(reopened).toEqual({ appended: 0, duplicates: 1 });
  });

  test("partitions by observation date and reads partitions chronologically", async () => {
    const store = await tempStore();
    await store.append([
      event(2, "2026-09-02T00:00:00.000Z"),
      event(1, "2026-08-31T23:00:00.000Z"),
    ]);
    const read: Event[] = [];
    for await (const e of store.read()) read.push(e);
    expect(read.map((e) => (e.payload as MessageObserved).uid)).toEqual([1, 2]);
  });

  test("rejects an event that does not match the schema", async () => {
    const store = await tempStore();
    const bad = event(1, "2026-08-01T10:00:00.000Z");
    (bad.payload as MessageObserved & { surprise?: string }).surprise = "extra field";
    await expect(store.append([bad])).rejects.toBeInstanceOf(EventValidationError);
  });

  test("rejects a sender_id that is not a sha256", async () => {
    const store = await tempStore();
    const bad = event(1, "2026-08-01T10:00:00.000Z", { sender_id: "someone@example.org" });
    await expect(store.append([bad])).rejects.toBeInstanceOf(EventValidationError);
  });
});
