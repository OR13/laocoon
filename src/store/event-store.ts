/**
 * The storage seam.
 *
 * Git-committed JSONL is today's event store and is expected to be replaced.
 * Nothing above this interface may assume files, directories, or git — an
 * implementation backed by a database or an object store must be droppable in
 * without touching ingestion or the projections.
 *
 * Generic in the event type because there are two logs with different contents:
 * the public one at `events/` and the private one at `private/events/`. They
 * share this interface and share nothing else.
 */
import type { Event } from "../schema/generated.ts";

/** The shape every event has, whichever log it belongs to. */
export interface AnyEvent {
  event_id: string;
  event_type: string;
  observed_at: string;
  payload: unknown;
}

export interface AppendResult {
  /** Events written. */
  appended: number;
  /** Events already present, identified by `event_id`. Re-observation is a no-op. */
  duplicates: number;
}

export interface EventStore<E extends AnyEvent = Event> {
  /** Append events, skipping any whose `event_id` is already stored. */
  append(events: readonly E[]): Promise<AppendResult>;

  /** Every event, in append order. */
  read(): AsyncIterable<E>;

  /** Whether an `event_id` is already stored. */
  has(eventId: string): Promise<boolean>;

  /** Total events stored. */
  count(): Promise<number>;
}
