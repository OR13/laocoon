/**
 * Build-time data loading. Runs in Node during static export, never in the
 * browser, so the bundle can never contain anything this module chose not to
 * hand to a component.
 *
 * The publication rules from `src/site/publishable.ts` are reimplemented here
 * rather than imported, because the two builds must not share a code path: a
 * helper reused across that boundary is how private data eventually reaches a
 * published page. Both are small, and the byte-level scan over the exported
 * output is what actually guarantees the result.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ARTIFACTS_DIR, EVENTS_DIR, IS_PRIVATE_BUILD, PRIVATE_DIR } from "./paths";

export const PUBLISHABLE_EVENT_TYPES = [
  "ThreadMeasured",
  "ForecastEvaluated",
  "CrawlWindowCompleted",
] as const;

export interface ThreadMeasure {
  thread_id: string;
  list_name: string;
  subject: string;
  measured_at: string;
  messages_total: number;
  distinct_senders: number;
  max_depth: number;
  reply_pairs: number;
  mean_branching_factor: number;
  messages_in_window: number;
  replies_classified: number;
  substantive_replies: number;
  hollow_replies: number;
  unclear_replies: number;
  unclassified_replies: number;
  substantive_reply_ratio: number | null;
  quoting_reply_ratio: number | null;
  median_novelty: number | null;
  reach: number | null;
  uptake_from_standing: number | null;
  seeded_participants: number;
  new_participants: number;
  new_participant_share: number | null;
  max_core_number: number;
  mean_core_number: number;
  provenance: {
    seed_rule_version: string;
    classifier_model: string;
    prompt_hash: string;
    prompt_version: string;
    generator: string;
  };
}

export interface Forecast {
  origin_at: string;
  horizon_days: number;
  forecaster: string;
  is_baseline: boolean;
  threads_scored: number;
  threads_with_engagement: number;
  spearman: number | null;
  p_value: number | null;
  precision_at_3: number | null;
  actual_metric: string;
}

export interface CrawlWindow {
  list_name: string;
  mode: string;
  started_at: string;
  completed_at: string;
  mailbox_total: number;
  uids_examined: number;
  failures: { uid: number; reason: string }[];
}

async function* jsonlFiles(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* jsonlFiles(path);
    else if (entry.name.endsWith(".jsonl")) yield path;
  }
}

interface RawEvent {
  event_type: string;
  payload: unknown;
}

async function readEvents(dir: string): Promise<RawEvent[]> {
  const out: RawEvent[] = [];
  for await (const path of jsonlFiles(dir)) {
    for (const line of (await readFile(path, "utf8")).split("\n")) {
      if (line.trim()) out.push(JSON.parse(line) as RawEvent);
    }
  }
  return out;
}

export interface DailyRow {
  day: string;
  messages: number;
  replies: number;
  threads_touched: number;
  participants: number;
  participants_with_standing: number;
  new_participants: number;
  substantive_replies: number;
  hollow_replies: number;
  unclear_replies: number;
  unclassified_replies: number;
  substantive_ratio: number | null;
}

export interface ThreadNode {
  id: string;
  subject: string;
  message_count: number;
  distinct_senders: number;
  max_depth: number;
  with_standing: number;
  started_at: string | null;
  last_message_at: string | null;
}

export interface Activity {
  publication: string;
  generated_at: string;
  list_name: string;
  daily: DailyRow[];
  thread_graph: {
    nodes: ThreadNode[];
    edges: { source: string; target: string; shared_participants: number }[];
  };
}

export interface TopicsArtifact {
  publication: string;
  list_name: string;
  embed_model: string;
  sentence_duplicate_at: number;
  novelty_threshold_sweep: { duplicate_at: number; median: number | null }[];
  clustering: {
    chosen_threshold: number;
    phi: number;
    subject_baseline_phi: number;
    beats_subject_baseline: boolean;
  };
  topics: {
    id: string;
    label: string | null;
    threads: string[];
    thread_count: number;
    message_count: number;
    distinct_senders: number;
    subjects: string[];
    started_at: string | null;
  }[];
  thread_novelty: Record<
    string,
    { scored: number; mean: number | null; median: number | null; median_length_adjusted: number | null }
  >;
}

export interface TopicTree {
  publication: string;
  list_name: string;
  horizon_days: number;
  chosen_threshold: number | null;
  holdout_spearman: number | null;
  calibration: {
    subject_baseline_holdout: number | null;
    single_cluster_holdout: number | null;
    max_cluster_share: number;
    trials: {
      threshold: number;
      clusters: number;
      largest_cluster_share: number;
      holdout_spearman: number | null;
      rejected_as_blob: boolean;
    }[];
  };
  topics: {
    id: string;
    parent_id: string;
    label: string | null;
    threads: string[];
    thread_count: number;
    message_count: number;
    distinct_senders: number;
    subjects: string[];
    started_at: string | null;
  }[];
  threads: {
    id: string;
    subject: string;
    gist: string;
    message_count: number;
    distinct_senders: number;
    max_depth: number;
    started_at: string | null;
    last_message_at: string | null;
    median_novelty: number | null;
  }[];
  unassigned_threads: string[];
}

export interface Health {
  publication: string;
  list_name: string;
  thresholds: Record<string, number>;
  axes: Record<string, { p10: number | null; median: number | null; p90: number | null }>;
  state_removed: string;
  threads_scored: number;
  threads: {
    thread_id: string;
    subject: string;
    messages: number;
    distinct_senders: number;
    started_at: string | null;
    last_message_at: string | null;
    reach: number;
    uptake_from_standing: number;
    median_novelty: number | null;
  }[];
}

export interface PublicData {
  measures: ThreadMeasure[];
  forecasts: Forecast[];
  windows: CrawlWindow[];
  structure: CommunityStructure | null;
  activity: Activity | null;
  topics: TopicsArtifact[];
  trees: TopicTree[];
  health: Health[];
}

export interface CommunityStructure {
  publication: string;
  seed_rule_version: string;
  accounts: {
    total: number;
    seeded: number;
    no_datatracker_record: number;
    resolved_but_unseeded: number;
  };
  graph: { accounts: number; edges: number; density: number; self_reply_edges_dropped: number };
  modularity: number;
  communities: {
    index: number;
    size: number;
    internal_edges: number;
    external_edges: number;
    external_edge_ratio: number;
    contains_seed_member: boolean;
    max_core_number: number;
  }[];
  communities_without_seed_member: { count: number; accounts: number };
  weighting_agreement: { spearman: number | null; n: number };
}

/** Only whitelisted event types reach a page. A blacklist would silently start
 *  publishing the next event type someone adds. */
export async function loadPublic(): Promise<PublicData> {
  const events = await readEvents(EVENTS_DIR);
  const latest = new Map<string, ThreadMeasure>();
  const forecasts: Forecast[] = [];
  const windows: CrawlWindow[] = [];

  for (const event of events) {
    if (event.event_type === "ThreadMeasured") {
      const m = event.payload as ThreadMeasure;
      const seen = latest.get(m.thread_id);
      // `>=` so a horizon recomputed with better classification coverage wins.
      if (!seen || m.measured_at >= seen.measured_at) latest.set(m.thread_id, m);
    } else if (event.event_type === "ForecastEvaluated") {
      forecasts.push(event.payload as Forecast);
    } else if (event.event_type === "CrawlWindowCompleted") {
      windows.push(event.payload as CrawlWindow);
    }
  }

  let structure: CommunityStructure | null = null;
  try {
    const raw = JSON.parse(
      await readFile(join(ARTIFACTS_DIR, "community-structure.json"), "utf8"),
    ) as CommunityStructure;
    if (raw.publication !== "aggregate_public") {
      throw new Error(
        `refusing community-structure.json: publication is ${JSON.stringify(raw.publication)}`,
      );
    }
    structure = raw;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("refusing")) throw error;
  }

  let activity: Activity | null = null;
  try {
    const raw = JSON.parse(
      await readFile(join(ARTIFACTS_DIR, "activity.json"), "utf8"),
    ) as Activity;
    if (raw.publication !== "aggregate_public") {
      throw new Error(`refusing activity.json: publication is ${JSON.stringify(raw.publication)}`);
    }
    activity = raw;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("refusing")) throw error;
  }

  const topics: TopicsArtifact[] = [];
  for (const list of ["agentproto", "agent2agent"]) {
    try {
      const raw = JSON.parse(
        await readFile(join(ARTIFACTS_DIR, `topics-${list}.json`), "utf8"),
      ) as TopicsArtifact;
      if (raw.publication !== "aggregate_public") {
        throw new Error(`refusing topics-${list}.json: publication is ${raw.publication}`);
      }
      topics.push(raw);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("refusing")) throw error;
    }
  }

  const trees: TopicTree[] = [];
  for (const list of ["agentproto", "agent2agent"]) {
    try {
      const raw = JSON.parse(
        await readFile(join(ARTIFACTS_DIR, `topic-tree-${list}.json`), "utf8"),
      ) as TopicTree;
      if (raw.publication !== "aggregate_public") {
        throw new Error(`refusing topic-tree-${list}.json: publication is ${raw.publication}`);
      }
      trees.push(raw);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("refusing")) throw error;
    }
  }

  const health: Health[] = [];
  for (const list of ["agentproto", "agent2agent"]) {
    try {
      const raw = JSON.parse(
        await readFile(join(ARTIFACTS_DIR, `health-${list}.json`), "utf8"),
      ) as Health;
      if (raw.publication !== "aggregate_public") {
        throw new Error(`refusing health-${list}.json: publication is ${raw.publication}`);
      }
      health.push(raw);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("refusing")) throw error;
    }
  }

  return {
    health,
    trees,
    topics,
    activity,
    measures: [...latest.values()].sort(
      (a, b) => b.messages_total - a.messages_total || a.thread_id.localeCompare(b.thread_id),
    ),
    forecasts: forecasts.sort(
      (a, b) => a.origin_at.localeCompare(b.origin_at) || a.forecaster.localeCompare(b.forecaster),
    ),
    windows: windows.sort((a, b) => a.completed_at.localeCompare(b.completed_at)),
    structure,
  };
}

// --------------------------------------------------------------- private --

export interface Person {
  id: string;
  full: string;
  address: string;
  label: string;
  messages: number;
  threads_participated: number;
  threads_started: number;
  replies_sent: number;
  replies_received: number;
  first_seen: string | null;
  last_seen: string | null;
  seeded: boolean;
  clauses: string[];
  unseeded_reason: string | null;
  ppr_replies: number | null;
  ppr_quoting: number | null;
  rank_replies: number | null;
  community: number | null;
  core_number: number | null;
  top_threads: { thread_id: string; messages: number }[];
}

export interface Thread {
  id: string;
  subject: string;
  label: string;
  message_count: number;
  distinct_senders: number;
  max_depth: number;
  reply_pairs: number;
  mean_branching_factor: number;
  started_at: string | null;
  last_message_at: string | null;
  substantive_reply_ratio: number | null;
  seeded_participants: number | null;
}

export interface PrivateData {
  generated_at: string;
  self_reply_edges_dropped: number;
  persons: Person[];
  threads: Thread[];
  participation: { person: string; thread: string; messages: number; replies: number }[];
  replies: { source: string; target: string; replies: number; quoting: number }[];
}

/** Surname with a leading initial. The full name is one click away. */
export function shortLabel(name: string): string {
  const cleaned = name.replace(/\s*\((IETF|ietf)\)\s*/g, " ").replace(/["']/g, "").trim();
  if (!cleaned) return "";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 20);
  return `${parts[0]![0]}. ${parts[parts.length - 1]}`.slice(0, 22);
}

/** Subject with the list tag and reply prefixes stripped, for a node label. */
export function shortSubject(subject: string): string {
  const cleaned = subject
    .replace(/^\s*(\[[^\]]+\]\s*)+/g, "")
    .replace(/^((Re|RE|Fwd|FWD|AW)\s*:\s*)+/g, "")
    .trim();
  return (cleaned || subject).slice(0, 46);
}

/**
 * The named view. Throws unless this is the private build — a public build must
 * not be able to reach this data even by mistake.
 */
export async function loadPrivate(): Promise<PrivateData> {
  if (!IS_PRIVATE_BUILD) {
    throw new Error("loadPrivate() called outside a private build");
  }
  const raw = JSON.parse(
    await readFile(join(PRIVATE_DIR, "artifacts", "sender-view.json"), "utf8"),
  );
  if (raw.publication !== "private") {
    throw new Error("sender-view.json is not marked private");
  }

  const names = new Map<string, { name: string; address: string }>();
  try {
    const book = await readFile(join(PRIVATE_DIR, "senders.jsonl"), "utf8");
    for (const line of book.split("\n")) {
      if (!line.trim()) continue;
      const r = JSON.parse(line) as { sender_id: string; address: string; display_name: string };
      const seen = names.get(r.sender_id);
      if (!seen || (!seen.name && r.display_name)) {
        names.set(r.sender_id, { name: r.display_name, address: r.address });
      }
    }
  } catch {
    // The address book is a convenience; hashes still identify rows without it.
  }

  return {
    generated_at: raw.generated_at,
    self_reply_edges_dropped: raw.self_reply_edges_dropped,
    persons: (raw.persons as Omit<Person, "full" | "address" | "label">[]).map((p) => {
      const rec = names.get(p.id);
      const full = rec?.name || rec?.address || p.id.slice(7, 19);
      return {
        ...p,
        full,
        address: rec?.address ?? "",
        label: shortLabel(rec?.name || rec?.address?.split("@")[0] || full),
      };
    }),
    threads: (raw.threads as Omit<Thread, "label">[]).map((t) => ({
      ...t,
      label: shortSubject(t.subject),
    })),
    participation: raw.participation,
    replies: raw.replies,
  };
}
