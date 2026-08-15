/**
 * Replay the log into the small amount of state ingestion needs.
 *
 * There is no separate watermark file. The log is the state: deriving the
 * watermark by replay means there is nothing that can disagree with the log, and
 * nothing to repair when a run is interrupted.
 */
import type { Event, MessageObserved, ObservationSuperseded } from "../schema/generated.ts";
import type { EventStore } from "../store/event-store.ts";

export interface Observation {
  eventId: string;
  uid: number;
  uidValidity: number;
}

export interface ListState {
  listName: string;
  /** UIDVALIDITY of the most recent observation. UIDs are only comparable within it. */
  uidValidity: number | null;
  /** Highest UID observed at the current uidValidity, or null. */
  watermark: number | null;
  /** Latest live observation per UID, at the current uidValidity. */
  observations: Map<number, Observation>;
  supersededEventIds: Set<string>;
}

export interface ReplaySummary {
  events: number;
  byType: Record<string, number>;
  lists: Map<string, ListState>;
  observedFrom: string | null;
  observedTo: string | null;
}

export async function replay(store: EventStore): Promise<ReplaySummary> {
  const lists = new Map<string, ListState>();
  const byType: Record<string, number> = {};
  let events = 0;
  let observedFrom: string | null = null;
  let observedTo: string | null = null;

  const stateFor = (name: string): ListState => {
    let state = lists.get(name);
    if (!state) {
      state = {
        listName: name,
        uidValidity: null,
        watermark: null,
        observations: new Map(),
        supersededEventIds: new Set(),
      };
      lists.set(name, state);
    }
    return state;
  };

  for await (const event of store.read()) {
    events += 1;
    byType[event.event_type] = (byType[event.event_type] ?? 0) + 1;
    if (observedFrom === null || event.observed_at < observedFrom) observedFrom = event.observed_at;
    if (observedTo === null || event.observed_at > observedTo) observedTo = event.observed_at;

    if (event.event_type === "MessageObserved") {
      const p = event.payload as MessageObserved;
      const state = stateFor(p.list_name);
      // A UIDVALIDITY change invalidates every UID recorded under the old one.
      if (state.uidValidity !== null && state.uidValidity !== p.uid_validity) {
        state.observations.clear();
        state.watermark = null;
      }
      state.uidValidity = p.uid_validity;
      state.observations.set(p.uid, {
        eventId: event.event_id,
        uid: p.uid,
        uidValidity: p.uid_validity,
      });
      if (state.watermark === null || p.uid > state.watermark) state.watermark = p.uid;
    } else if (event.event_type === "ObservationSuperseded") {
      const p = event.payload as ObservationSuperseded;
      stateFor(p.list_name).supersededEventIds.add(p.superseded_event_id);
    }
  }

  return { events, byType, lists, observedFrom, observedTo };
}

/** Live MessageObserved events: those no later event supersedes. */
export function isLive(event: Event, superseded: ReadonlySet<string>): boolean {
  return event.event_type === "MessageObserved" && !superseded.has(event.event_id);
}
