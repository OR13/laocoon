/**
 * The four-tier graph: topic → thread → message → person.
 *
 * Level of detail is the design, not an optimisation. Rendering every message
 * of a 1,233-message corpus at once is unreadable whatever draws it — the
 * constraint is the reader, not the GPU. WebGL raises the ceiling; expanding on
 * demand is what makes the picture mean something:
 *
 *   topics          which subjects moved, and who carried them
 *   + threads       expand one topic to its discussions
 *   + messages      expand one thread to its reply tree
 *   people          always available, linked to whatever is expanded
 *
 * Nothing here is a provenance signal. Novelty is the fraction of a reply's
 * sentences that nothing earlier in the thread said — a human restating the
 * thread scores exactly as low as anything else, which is the correct
 * behaviour: the measure is of the contribution, not of its author.
 */

export type Tier = "topic" | "thread" | "message" | "person";

/** Subject without the list tag or reply prefixes — a node label, not a header. */
export function cleanSubject(subject: string): string {
  return (
    subject
      .replace(/^\s*(\[[^\]]+\]\s*)+/g, "")
      .replace(/^((Re|RE|Fwd|FWD|AW)\s*:\s*)+/g, "")
      .trim() || subject
  ).slice(0, 46);
}

export interface GraphNode {
  key: string;
  tier: Tier;
  label: string;
  /** Messages, for size. */
  weight: number;
  /** 0..1 for the sequential ramp; null when the tier has no such measure. */
  intensity: number | null;
  /** Community-conferred standing, or a steward of this list. */
  standing?: "steward" | "seed" | "none";
  /** Topic this node belongs to. Drives spatial clustering in the layout. */
  cluster: string;
  /** Which list this belongs to. Carried as its own channel so the two are
   *  always distinguishable, however else a node is encoded. */
  list?: string;
  gist?: string;
  href?: string;
  reach?: number;
  uptakeFromStanding?: number;
  ref: string;
}

export interface GraphEdge {
  key: string;
  source: string;
  target: string;
  kind: "contains" | "posted" | "reply";
  weight: number;
}

export interface GraphView {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: { messages: number } | null;
}

export interface TopicRow {
  id: string;
  label: string | null;
  threads: string[];
  thread_count: number;
  message_count: number;
  distinct_senders: number;
  subjects: string[];
  started_at: string | null;
  median_novelty: number | null;
}

export interface GraphSource {
  topics: (TopicRow & { list_name?: string })[];
  threads: {
    id: string;
    topic_id: string | null;
    subject: string;
    list_name?: string;
    gist?: string;
    href?: string;
    message_count: number;
    distinct_senders: number;
    last_message_at: string | null;
    median_novelty: number | null;
    reach?: number;
    uptakeFromStanding?: number;
  }[];
  persons: {
    id: string;
    label: string;
    messages: number;
    reputation: number | null;
    seeded: boolean;
    steward: boolean;
  }[];
  participation: { person: string; thread: string; messages: number }[];
  replies: { source: string; target: string; replies: number }[];
}

/** Rank within a list, as a 0..1 position. Robust to the long tails that make a
 *  linear ramp collapse most of a corpus into one shade. */
export function rankScale(values: (number | null)[]): (v: number | null) => number | null {
  const present = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (present.length === 0) return () => null;
  return (v) => {
    if (v === null) return null;
    let low = 0;
    let high = present.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (present[mid]! < v) low = mid + 1;
      else high = mid;
    }
    return present.length > 1 ? low / (present.length - 1) : 1;
  };
}

/**
 * Build the visible graph for the current expansion state.
 *
 * `expandedTopics` and `expandedThreads` drive the level of detail. People are
 * included only when something they posted in is visible, so the picture never
 * fills with accounts whose threads are collapsed.
 */
export function buildView(
  source: GraphSource,
  options: {
    expandedTopics: Set<string>;
    expandedThreads: Set<string>;
    showPeople: boolean;
    showUnassigned?: boolean;
    threadIds?: Set<string>;
    maxMessages?: number;
  },
): GraphView {
  const { expandedTopics, expandedThreads, showPeople } = options;
  const showUnassigned = options.showUnassigned ?? false;
  const inWindow = options.threadIds;

  const threads = source.threads.filter((t) => !inWindow || inWindow.has(t.id));
  const liveThreadIds = new Set(threads.map((t) => t.id));

  const topicNovelty = rankScale(source.topics.map((t) => t.median_novelty));
  const threadNovelty = rankScale(threads.map((t) => t.median_novelty));
  const personRep = rankScale(source.persons.map((p) => p.reputation));

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const topic of source.topics) {
    const own = topic.threads.filter((id) => liveThreadIds.has(id));
    if (own.length === 0) continue;
    nodes.push({
      key: `topic:${topic.id}`,
      tier: "topic",
      label: topic.label ?? cleanSubject(topic.subjects[0] ?? topic.id),
      weight: topic.message_count,
      intensity: topicNovelty(topic.median_novelty),
      cluster: topic.id,
      list: topic.list_name,
      ref: topic.id,
    });
    if (!expandedTopics.has(topic.id)) continue;
    for (const id of own) {
      const thread = threads.find((t) => t.id === id);
      if (!thread) continue;
      edges.push({
        key: `c:${topic.id}:${id}`,
        source: `topic:${topic.id}`,
        target: `thread:${id}`,
        kind: "contains",
        weight: 1,
      });
    }
  }

  // A thread with no topic belongs with nothing, and there are 62 of them on
  // agent2agent. Rendering them unconditionally buried the topics they were
  // supposed to sit beside, so they are opt-in.
  const visibleThreads = threads.filter((t) =>
    t.topic_id ? expandedTopics.has(t.topic_id) : showUnassigned,
  );
  for (const thread of visibleThreads) {
    nodes.push({
      key: `thread:${thread.id}`,
      tier: "thread",
      label: cleanSubject(thread.subject),
      weight: thread.message_count,
      intensity: threadNovelty(thread.median_novelty),
      cluster: thread.topic_id ?? "unassigned",
      list: thread.list_name,
      gist: thread.gist,
      href: thread.href,
      reach: thread.reach,
      uptakeFromStanding: thread.uptakeFromStanding,
      ref: thread.id,
    });
  }

  const visibleThreadIds = new Set(visibleThreads.map((t) => t.id));
  const topicOfThread = new Map(source.threads.map((t) => [t.id, t.topic_id ?? "unassigned"]));
  const byPerson = new Map<string, Map<string, number>>();
  for (const p of source.participation) {
    if (!visibleThreadIds.has(p.thread)) continue;
    const counts = byPerson.get(p.person) ?? new Map<string, number>();
    const key = topicOfThread.get(p.thread) ?? "unassigned";
    counts.set(key, (counts.get(key) ?? 0) + p.messages);
    byPerson.set(p.person, counts);
  }
  const dominantCluster = new Map(
    [...byPerson].map(([id, counts]) => [
      id,
      [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0],
    ]),
  );
  const personIds = new Set<string>();
  if (showPeople) {
    for (const p of source.participation) {
      if (!visibleThreadIds.has(p.thread)) continue;
      personIds.add(p.person);
      edges.push({
        key: `p:${p.person}:${p.thread}`,
        source: `person:${p.person}`,
        target: `thread:${p.thread}`,
        kind: "posted",
        weight: p.messages,
      });
    }
    for (const person of source.persons) {
      if (!personIds.has(person.id)) continue;
      nodes.push({
        key: `person:${person.id}`,
        tier: "person",
        label: person.label,
        weight: person.messages,
        intensity: personRep(person.reputation),
        standing: person.steward ? "steward" : person.seeded ? "seed" : "none",
        // People sit with the topic they posted in most, so the layout groups
        // them with the conversation they belong to rather than in a rim.
        cluster: dominantCluster.get(person.id) ?? "people",
        ref: person.id,
      });
    }
    for (const r of source.replies) {
      if (!personIds.has(r.source) || !personIds.has(r.target)) continue;
      edges.push({
        key: `r:${r.source}:${r.target}`,
        source: `person:${r.source}`,
        target: `person:${r.target}`,
        kind: "reply",
        weight: r.replies,
      });
    }
  }

  void expandedThreads;
  return { nodes, edges, truncated: null };
}
