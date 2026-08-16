/**
 * Bands of published record, and the shapes the network is drawn from.
 *
 * Separate from `components/reply-network.tsx` because that module imports
 * sigma, which reads `WebGL2RenderingContext` at load. Anything the server
 * renders — the page, the legend, the trend — needs these constants without
 * dragging a WebGL renderer into the prerender.
 *
 * Named for a quantity of work, never for a kind of person: the binary these
 * replaced sorted a mailing list into two classes and read as a caste mark.
 * Sequential, because what is encoded is a magnitude, with a neutral for the
 * zero that is an absence rather than a low value.
 */

export type Band = "none" | "some" | "established" | "extensive";

export const BAND_META: Record<Band, { label: string; token: string; help: string }> = {
  extensive: { label: "60–100", token: "--seq-700", help: "Extensive published record." },
  established: { label: "30–59", token: "--seq-400", help: "Established published record." },
  some: { label: "1–29", token: "--seq-250", help: "Some published work." },
  none: {
    label: "0",
    token: "--eng-none",
    help:
      "Nothing published under this address in the Datatracker. That is the ordinary " +
      "state of a new participant and of anyone who contributes without filing documents.",
  },
};

export const BAND_ORDER: Band[] = ["extensive", "established", "some", "none"];

export interface NetworkPerson {
  id: string;
  name: string;
  /** 0-100 from published RFCs, adopted drafts and IETF roles. */
  score: number;
  band: Band;
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
  messages: number;
  participants: string[];
  top_record: number;
  started_at: string | null;
  last_message_at: string | null;
  href: string;
}

/** What the filter chips offer. Each is one lookup, not a judgement. */
export const FILTERS = [
  { id: "all", label: "Everyone", test: () => true },
  { id: "datatracker", label: "In the Datatracker", test: (p: NetworkPerson) => p.in_datatracker },
  { id: "rfc", label: "Has an RFC", test: (p: NetworkPerson) => p.rfcs >= 1 },
  { id: "rfcs", label: "3 or more RFCs", test: (p: NetworkPerson) => p.rfcs >= 3 },
] as const;

export type FilterId = (typeof FILTERS)[number]["id"];
