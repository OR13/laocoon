/**
 * The storage seam.
 *
 * Git-committed JSONL is today's event store and is expected to be replaced.
 * Nothing above this interface may assume files, directories, or git — an
 * implementation backed by a database or an object store must be droppable in
 * without touching ingestion or the projections.
 */
import type { Event } from "../schema/generated.ts";

export interface AppendResult {
  /** Events written. */
  appended: number;
  /** Events already present, identified by `event_id`. Re-observation is a no-op. */
  duplicates: number;
}

export interface EventStore {
  /** Append events, skipping any whose `event_id` is already stored. */
  append(events: readonly Event[]): Promise<AppendResult>;

  /** Every event, in append order. */
  read(): AsyncIterable<Event>;

  /** Whether an `event_id` is already stored. */
  has(eventId: string): Promise<boolean>;

  /** Total events stored. */
  count(): Promise<number>;
}
