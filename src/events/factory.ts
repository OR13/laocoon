/**
 * Event construction. The only place an Event is allowed to come into existence.
 */
import type {
  CrawlWindowCompleted,
  DatatrackerRecordFetched,
  Event,
  MessageObserved,
  ObservationSuperseded,
  PrivateEvent,
  PrivateSourceRef,
  SenderResolved,
  SourceRef,
} from "../schema/generated.ts";
import { sha256Json } from "../lib/hash.ts";

/** Bumped when schemas/event.yaml changes in a way that alters written events. */
export const EVENT_SCHEMA_VERSION = "1.0.0";

export type EventPayload = MessageObserved | CrawlWindowCompleted | ObservationSuperseded;

type PayloadFor<T extends Event["event_type"]> = T extends "MessageObserved"
  ? MessageObserved
  : T extends "CrawlWindowCompleted"
    ? CrawlWindowCompleted
    : ObservationSuperseded;

/**
 * `event_id` covers `{event_type, payload}` and deliberately excludes
 * `observed_at` and `source`: observing the same fact twice, or observing it
 * through a replacement crawler, must not append a second event.
 */
export function eventId<T extends Event["event_type"]>(
  eventType: T,
  payload: PayloadFor<T>,
): string {
  return sha256Json({ event_type: eventType, payload });
}

export function makeEvent<T extends Event["event_type"]>(
  eventType: T,
  payload: PayloadFor<T>,
  source: SourceRef,
  observedAt: string,
): Event {
  return {
    event_id: eventId(eventType, payload),
    event_type: eventType,
    schema_version: EVENT_SCHEMA_VERSION,
    observed_at: observedAt,
    source,
    payload,
  } as Event;
}

/** Bumped when schemas/private-event.yaml changes the events it writes. */
export const PRIVATE_EVENT_SCHEMA_VERSION = "1.0.0";

type PrivatePayloadFor<T extends PrivateEvent["event_type"]> = T extends "SenderResolved"
  ? SenderResolved
  : DatatrackerRecordFetched;

/**
 * The private log's constructor. Separate from {@link makeEvent} — not to avoid
 * duplication but to create it: two logs with different schemas and different
 * publication rules should not share a code path that could route a record to
 * the wrong one.
 */
export function makePrivateEvent<T extends PrivateEvent["event_type"]>(
  eventType: T,
  payload: PrivatePayloadFor<T>,
  source: PrivateSourceRef,
  observedAt: string,
): PrivateEvent {
  return {
    event_id: sha256Json({ event_type: eventType, payload }),
    event_type: eventType,
    schema_version: PRIVATE_EVENT_SCHEMA_VERSION,
    observed_at: observedAt,
    source,
    payload,
  } as PrivateEvent;
}
