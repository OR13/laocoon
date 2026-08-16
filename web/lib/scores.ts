/**
 * The two Laocoön scores, and the shapes the graph is drawn from.
 *
 * Separate from the graph component because that module imports sigma, which
 * reads `WebGL2RenderingContext` at load. Anything the server renders needs
 * these without dragging a WebGL renderer into the prerender.
 *
 * **Both scores share one vocabulary — low, medium, high — and one palette.**
 * They measure different things, so reading them the same way is a choice: a
 * reader learns the colours once. The palette is a status palette, so it never
 * appears without the word beside it, and the node's *shape* carries what kind
 * of thing it is so colour is never load-bearing twice.
 */

export type Level = "low" | "medium" | "high";

export const LEVELS: Level[] = ["high", "medium", "low"];

export const LEVEL_META: Record<Level, { label: string; token: string }> = {
  high: { label: "High", token: "--level-high" },
  medium: { label: "Medium", token: "--level-medium" },
  low: { label: "Low", token: "--level-low" },
};

/** Contributor-score band boundaries, on the 0-100 curve. */
export const CONTRIBUTOR_BANDS = { high: 70, medium: 35 } as const;

export function contributorLevel(score: number): Level {
  if (score >= CONTRIBUTOR_BANDS.high) return "high";
  if (score >= CONTRIBUTOR_BANDS.medium) return "medium";
  return "low";
}

export const CONTRIBUTOR_HELP: Record<Level, string> = {
  high: "Contributor score 70–100. An extensive published IETF record.",
  medium: "Contributor score 35–69. An established published record.",
  low:
    "Contributor score 0–34, including everyone with no published record at all. " +
    "That is the ordinary state of a new participant and of anyone who contributes " +
    "without filing documents — it is a measure of published output, not of a person.",
};

export const UTILITY_HELP: Record<Level, string> = {
  high:
    "Six messages or more, four or more participants, under 70% from the busiest two, " +
    "and someone with a contributor score of 35 or more took part.",
  medium: "Meets some of the conditions for high, or is too short to say.",
  low:
    "Either a thread of six or more that two or three accounts carried at 80% or above, " +
    "or a short exchange between two accounts with no published record. A prompt to read " +
    "it, not a verdict — two experts working a detail produce the same shape.",
};

export interface NetworkPerson {
  id: string;
  name: string;
  /** Laocoön contributor score, 0-100, from published RFCs, drafts and roles. */
  score: number;
  rfcs: number;
  adopted_drafts: number;
  chairs_now: boolean;
  in_datatracker: boolean;
  messages: number;
  replies_sent: number;
  replies_received: number;
  lists: string[];
  first_seen: string | null;
}

export interface NetworkEdge {
  source: string;
  target: string;
  replies: number;
}

export interface NetworkThread {
  id: string;
  subject: string;
  list_name: string;
  topic_id: string | null;
  topic_label: string | null;
  messages: number;
  participants: string[];
  top_contributor: number;
  /** Share of the thread sent by its two busiest accounts. */
  top_two_share: number;
  /** Laocoön utility score. Three levels, never a number. */
  utility: Level;
  utility_reason: string;
  quiet_for_days: number | null;
  started_at: string | null;
  last_message_at: string | null;
  href: string;
}

/** One day, one list, counted two ways. */
export interface DayRow {
  day: string;
  list_name: string;
  contributor: Record<Level, number>;
  utility: Record<Level, number>;
}

export interface NetworkTopic {
  id: string;
  label: string;
  lists: string[];
  threads: string[];
  messages: number;
  participants: string[];
  /** Utility of the threads in it, so a topic can be read at a glance. */
  utility: Record<Level, number>;
  top_contributor: number;
  started_at: string | null;
  last_message_at: string | null;
}
