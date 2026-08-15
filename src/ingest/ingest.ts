/**
 * Ingestion: turn what a {@link MessageSource} can see into events.
 *
 * The contract this upholds:
 *   * append-only — an observation is never edited, and a re-crawl of unchanged
 *     material appends nothing at all, because `event_id` is content-derived;
 *   * corrections are events — content that changed under a stable UID produces
 *     an `ObservationSuperseded` alongside the new observation, not an overwrite;
 *   * coverage is recorded — every run emits `CrawlWindowCompleted`, including
 *     the runs that failed partway, so gaps are visible rather than inferred.
 */
import { simpleParser, type ParsedMail } from "mailparser";
import type {
  CrawlWindowCompleted,
  Event,
  MessageObserved,
  ObservationSuperseded,
} from "../schema/generated.ts";
import type { MessageSource } from "../crawl/source.ts";
import type { EventStore } from "../store/event-store.ts";
import { eventId, makeEvent } from "../events/factory.ts";
import { replay, type ListState } from "../events/replay.ts";
import { sha256, senderId } from "../lib/hash.ts";
import { bodyShape, extractAddress, normalizeMessageId, parseMessageIdList, parseSentAt } from "./parse.ts";
import { BodyCache } from "./body-cache.ts";
import { PrivateSenderMap } from "../identity/private-map.ts";

export type CrawlMode = "incremental" | "full";

export interface IngestOptions {
  listName: string;
  mode?: CrawlMode;
  /** Stop after this many UIDs. The IMAP source is ~1s per command, so a first
   *  crawl of a large list is a budgeted operation, not a free one. */
  maxMessages?: number;
  /** Injectable for tests. */
  now?: () => Date;
  /** Injectable so a test never writes into the real cache. */
  bodies?: BodyCache;
  /** Injectable so a test never writes into the real private map. */
  senders?: PrivateSenderMap;
}

export interface IngestReport {
  listName: string;
  mode: CrawlMode;
  uidValidity: number;
  mailboxTotal: number;
  watermarkBefore: number | null;
  watermarkAfter: number | null;
  uidsExamined: number;
  messagesNew: number;
  messagesUnchanged: number;
  messagesSuperseded: number;
  failures: { uid: number; reason: string }[];
  eventsAppended: number;
  eventsDuplicate: number;
  sendersRecorded: number;
  truncated: boolean;
}

export async function ingestList(
  source: MessageSource,
  store: EventStore,
  options: IngestOptions,
): Promise<IngestReport> {
  const { listName } = options;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();

  const state = (await replay(store)).lists.get(listName) ?? emptyState(listName);

  await source.connect();
  const snapshot = await source.snapshot(listName);

  // A UIDVALIDITY change means every UID we hold is meaningless. The only honest
  // response is to re-examine the whole mailbox.
  const validityChanged =
    state.uidValidity !== null && state.uidValidity !== snapshot.uidValidity;
  const mode: CrawlMode = validityChanged ? "full" : (options.mode ?? "incremental");

  const after = mode === "full" ? null : state.watermark;
  let uids = await source.uids(listName, after);
  const truncated = options.maxMessages !== undefined && uids.length > options.maxMessages;
  if (truncated) uids = uids.slice(0, options.maxMessages);

  const bodies = options.bodies ?? new BodyCache();
  const senders = options.senders ?? new PrivateSenderMap();
  const pending: Event[] = [];
  const failures: { uid: number; reason: string }[] = [];
  const fetched = new Set<number>();

  let messagesNew = 0;
  let messagesUnchanged = 0;
  let messagesSuperseded = 0;
  let watermarkAfter = validityChanged ? null : state.watermark;

  for await (const raw of source.fetch(listName, uids)) {
    fetched.add(raw.uid);
    let parsed: ParsedMail;
    try {
      parsed = await simpleParser(Buffer.from(raw.source));
    } catch (error) {
      failures.push({ uid: raw.uid, reason: `parse failed: ${describe(error)}` });
      continue;
    }

    let payload: MessageObserved;
    let bodyText: string;
    try {
      const built = buildObservation(listName, raw.uid, snapshot.uidValidity, parsed);
      payload = built.payload;
      bodyText = built.bodyText;
    } catch (error) {
      failures.push({ uid: raw.uid, reason: `normalisation failed: ${describe(error)}` });
      continue;
    }

    const id = eventId("MessageObserved", payload);
    const prior = state.observations.get(raw.uid);

    if (prior && prior.eventId === id) {
      messagesUnchanged += 1;
    } else {
      if (prior) {
        const correction: ObservationSuperseded = {
          list_name: listName,
          uid: raw.uid,
          uid_validity: prior.uidValidity,
          superseded_event_id: prior.eventId,
          superseding_event_id: id,
          reason: prior.uidValidity === snapshot.uidValidity ? "content_changed" : "uid_validity_changed",
        };
        pending.push(makeEvent("ObservationSuperseded", correction, source.ref, now().toISOString()));
        messagesSuperseded += 1;
      }
      pending.push(makeEvent("MessageObserved", payload, source.ref, now().toISOString()));
      messagesNew += 1;
    }

    await bodies.put(payload.body.sha256, bodyText);
    const address = parsed.from?.value?.[0]?.address ?? extractAddress(parsed.from?.text);
    if (address) {
      await senders.record({
        sender_id: payload.sender_id,
        address,
        display_name: parsed.from?.value?.[0]?.name ?? "",
        list_name: listName,
        first_observed_at: startedAt,
      });
    }

    if (watermarkAfter === null || raw.uid > watermarkAfter) watermarkAfter = raw.uid;
  }

  for (const uid of uids) {
    if (!fetched.has(uid)) failures.push({ uid, reason: "uid listed but not returned by source" });
  }

  const window: CrawlWindowCompleted = {
    list_name: listName,
    mode,
    started_at: startedAt,
    completed_at: now().toISOString(),
    uid_validity: snapshot.uidValidity,
    mailbox_total: snapshot.exists,
    watermark_before: validityChanged ? null : state.watermark,
    watermark_after: watermarkAfter,
    uid_min_seen: uids.length > 0 ? uids[0]! : null,
    uid_max_seen: uids.length > 0 ? uids[uids.length - 1]! : null,
    uids_examined: uids.length,
    messages_new: messagesNew,
    messages_unchanged: messagesUnchanged,
    messages_superseded: messagesSuperseded,
    failures,
  };
  pending.push(makeEvent("CrawlWindowCompleted", window, source.ref, now().toISOString()));

  const appended = await store.append(pending);
  const sendersRecorded = await senders.flush();

  return {
    listName,
    mode,
    uidValidity: snapshot.uidValidity,
    mailboxTotal: snapshot.exists,
    watermarkBefore: window.watermark_before,
    watermarkAfter,
    uidsExamined: uids.length,
    messagesNew,
    messagesUnchanged,
    messagesSuperseded,
    failures,
    eventsAppended: appended.appended,
    eventsDuplicate: appended.duplicates,
    sendersRecorded,
    truncated,
  };
}

export function buildObservation(
  listName: string,
  uid: number,
  uidValidity: number,
  parsed: ParsedMail,
): { payload: MessageObserved; bodyText: string } {
  const headers = rawHeaders(parsed);
  const bodyText = parsed.text ?? "";
  const shape = bodyShape(bodyText);
  const address = parsed.from?.value?.[0]?.address ?? extractAddress(headers.get("from"));

  const payload: MessageObserved = {
    list_name: listName,
    uid,
    uid_validity: uidValidity,
    message_id: normalizeMessageId(parsed.messageId ?? headers.get("message-id") ?? null),
    in_reply_to: parseMessageIdList(headers.get("in-reply-to")),
    references: parseMessageIdList(headers.get("references")),
    subject: parsed.subject ?? "",
    sent_at: parsed.date ? parsed.date.toISOString() : parseSentAt(headers.get("date")),
    sent_at_raw: headers.get("date") ?? "",
    // A message with no usable From address still has to be recorded, or the
    // corpus silently shrinks. It gets the hash of the empty address, which is
    // a stable identity meaning "unattributed".
    sender_id: senderId(address ?? ""),
    body: {
      sha256: sha256(bodyText),
      chars: shape.chars,
      lines: shape.lines,
      quoted_lines: shape.quoted_lines,
      unquoted_lines: shape.unquoted_lines,
    },
  };
  return { payload, bodyText };
}

/** First raw value per header name, unfolded. */
function rawHeaders(parsed: ParsedMail): Map<string, string> {
  const out = new Map<string, string>();
  for (const { key, line } of parsed.headerLines ?? []) {
    if (out.has(key)) continue;
    const colon = line.indexOf(":");
    const value = colon === -1 ? "" : line.slice(colon + 1);
    out.set(key, value.replace(/\r?\n\s+/g, " ").trim());
  }
  return out;
}

function emptyState(listName: string): ListState {
  return {
    listName,
    uidValidity: null,
    watermark: null,
    observations: new Map(),
    supersededEventIds: new Set(),
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
