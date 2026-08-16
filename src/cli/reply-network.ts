#!/usr/bin/env bun
/**
 * Who replies to whom, as one named network.
 *
 *   bun run reply-network
 *
 * **Why this one is a node-link graph when the last two should not have been.**
 * Topic-contains-thread is a hierarchy: there are no topic-to-topic edges, so
 * position encoded nothing and the picture was a blob. Person-replies-to-person
 * is an actual network — adjacency is the data — which is the condition a
 * node-link diagram needs in order to earn its place. It is also the first
 * thing Sack's Conversation Map computes for a mailing list, for the same
 * reason.
 *
 * **On names.** These are `From:` display names off posts to a public IETF
 * list, republished alongside who replied to whom, which is equally public.
 * That is a report of what happened, and it is a different thing from the
 * per-person *scores* PROBLEM.md section 7 keeps local: nodes are sized by
 * message count, which is a count, and never by reputation, which is this
 * system's opinion of a person. The distinction is the whole of section 7 and
 * this artifact stays on the right side of it.
 *
 * No `sha256:` sender hash reaches the output. Nodes are keyed by a slug, so
 * the published file cannot be joined back to the private tables even by
 * someone who has them.
 */
import { parseArgs } from "node:util";
import { join } from "node:path";
import type { Event, MessageObserved, PrivateEvent, ReplyGraph } from "../schema/generated.ts";
import { JsonlEventStore } from "../store/jsonl-store.ts";
import { assertPublishableArtifact } from "../site/publishable.ts";
import { archiveMessageUrl } from "../lib/archive.ts";
import { contributorScore, type ContributorScore } from "../score/contributor.ts";
import { utilityOf } from "../score/utility.ts";
import { JsonlEventStore as PrivateStore } from "../store/jsonl-store.ts";
import { ARTIFACTS_DIR, EVENTS_DIR, PRIVATE_DIR } from "../lib/paths.ts";

const { values } = parseArgs({
  options: { out: { type: "string" } },
});

const graph = (await Bun.file(join(ARTIFACTS_DIR, "reply-graph.json")).json()) as ReplyGraph;

interface SenderRow {
  sender_id: string;
  address: string;
  display_name: string;
  list_name: string;
}
const senders = new Map<string, SenderRow>();
const sendersFile = Bun.file(join(PRIVATE_DIR, "senders.jsonl"));
if (!(await sendersFile.exists())) {
  throw new Error(`no ${PRIVATE_DIR}/senders.jsonl: run \`bun run ingest\` first`);
}
for (const line of (await sendersFile.text()).split("\n")) {
  if (!line.trim()) continue;
  const row = JSON.parse(line) as SenderRow;
  const seen = senders.get(row.sender_id);
  // Prefer the row that actually carries a name.
  if (!seen || (!seen.display_name && row.display_name)) senders.set(row.sender_id, row);
}

const seedDoc = JSON.parse(
  await Bun.file(join(PRIVATE_DIR, "artifacts", "seed.json")).text(),
) as {
  members: { sender_id: string; person_id: number | null }[];
  unseeded: { sender_id: string; person_id: number | null; reason: string }[];
};
const standing = new Set(seedDoc.members.map((m) => m.sender_id));
const personOf = new Map<string, number>();
for (const m of [...seedDoc.members, ...seedDoc.unseeded]) {
  if (m.person_id != null) personOf.set(m.sender_id, m.person_id);
}

// The publication record, from the private Datatracker events. Only the
// resulting score and its counts reach the artifact — the raw record stays
// where it was fetched to.
interface Fetched {
  person_id: number;
  rfc_authorships: number;
  wg_document_authorships: string[];
  chair_roles: { current: boolean; group_type: string }[];
  ad_roles: unknown[];
  iab_iesg_roles: unknown[];
}
const records = new Map<number, Fetched>();
const privateStore = new PrivateStore<PrivateEvent>(
  join(PRIVATE_DIR, "events"),
  "private-event",
);
for await (const event of privateStore.read()) {
  if (event.event_type !== "DatatrackerRecordFetched") continue;
  const payload = event.payload as Fetched;
  records.set(payload.person_id, payload);
}
function scoreOf(senderId: string): ContributorScore | null {
  const personId = personOf.get(senderId);
  if (personId == null) return null;
  const record = records.get(personId);
  return record ? contributorScore(record) : null;
}
const noRecord = new Set(
  seedDoc.unseeded.filter((u) => u.reason === "no_datatracker_record").map((u) => u.sender_id),
);

/**
 * A display label for one account.
 *
 * The `From:` name where the sender set one, and the local part of the address
 * otherwise — which is what the IETF archive itself shows. The domain is
 * dropped: it adds nothing to "who replied to whom" and turns the artifact
 * into a harvestable address list.
 */
function labelFor(id: string): string {
  const row = senders.get(id);
  if (!row) return "unknown sender";
  const name = row.display_name.trim().replace(/^"|"$/g, "");
  if (name) return name;
  const local = row.address.split("@")[0] ?? "";
  // An all-digit local part is an address, not a name, and rendering it as one
  // looks like a rendering fault.
  return local && !/^\d+$/.test(local) ? local : "(no display name)";
}

const slugs = new Map<string, string>();
const used = new Map<string, number>();
function slugFor(id: string): string {
  const existing = slugs.get(id);
  if (existing) return existing;
  const base =
    labelFor(id)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "sender";
  const n = (used.get(base) ?? 0) + 1;
  used.set(base, n);
  const slug = n === 1 ? base : `${base}-${n}`;
  slugs.set(id, slug);
  return slug;
}

// Which lists each account posted on, from the public log.
const store = new JsonlEventStore<Event>(EVENTS_DIR, "event");
const superseded = new Set<string>();
const listsOf = new Map<string, Set<string>>();
const observed: { eventId: string; payload: MessageObserved }[] = [];
for await (const event of store.read()) {
  if (event.event_type === "ObservationSuperseded") {
    superseded.add((event.payload as { superseded_event_id: string }).superseded_event_id);
  } else if (event.event_type === "MessageObserved") {
    observed.push({ eventId: event.event_id, payload: event.payload as MessageObserved });
  }
}
for (const { eventId, payload } of observed) {
  if (superseded.has(eventId)) continue;
  const set = listsOf.get(payload.sender_id) ?? new Set<string>();
  set.add(payload.list_name);
  listsOf.set(payload.sender_id, set);
}

const nodeOf = new Map(graph.nodes.map((n) => [n.message_id, n]));
/** Which list each thread belongs to, for its archive link. */
const listOf = new Map<string, string>();
for (const { eventId, payload } of observed) {
  if (superseded.has(eventId) || !payload.message_id) continue;
  const node = nodeOf.get(payload.message_id);
  if (node) listOf.set(node.thread_id, payload.list_name);
}

const messages = new Map<string, number>();
const firstSeen = new Map<string, string>();
for (const n of graph.nodes) {
  messages.set(n.sender_id, (messages.get(n.sender_id) ?? 0) + 1);
  const at = n.sent_at ?? "";
  if (at && (!firstSeen.has(n.sender_id) || at < firstSeen.get(n.sender_id)!)) {
    firstSeen.set(n.sender_id, at);
  }
}

// Directed: child's sender replied to parent's sender. Self-replies dropped —
// answering your own message is not a relationship between two people.
const pairs = new Map<string, { source: string; target: string; replies: number }>();
let selfReplies = 0;
for (const edge of graph.edges) {
  const child = nodeOf.get(edge.child);
  const parent = nodeOf.get(edge.parent);
  if (!child || !parent) continue;
  if (child.sender_id === parent.sender_id) {
    selfReplies++;
    continue;
  }
  const key = `${child.sender_id}>${parent.sender_id}`;
  const seen = pairs.get(key);
  if (seen) seen.replies += 1;
  else
    pairs.set(key, {
      source: slugFor(child.sender_id),
      target: slugFor(parent.sender_id),
      replies: 1,
    });
}

const repliesSent = new Map<string, number>();
const repliesReceived = new Map<string, number>();
for (const edge of graph.edges) {
  const child = nodeOf.get(edge.child);
  const parent = nodeOf.get(edge.parent);
  if (!child || !parent || child.sender_id === parent.sender_id) continue;
  repliesSent.set(child.sender_id, (repliesSent.get(child.sender_id) ?? 0) + 1);
  repliesReceived.set(parent.sender_id, (repliesReceived.get(parent.sender_id) ?? 0) + 1);
}

const nodes = [...messages.keys()].map((id) => {
  const record = scoreOf(id);
  return {
  id: slugFor(id),
  name: labelFor(id),
  /** 0-100 from published RFCs, adopted drafts and roles. See seed/record-score.ts. */
  score: record?.score ?? 0,
  rfcs: record?.rfcs ?? 0,
  adopted_drafts: record?.adopted_drafts ?? 0,
  chairs_now: record?.chairs_now ?? false,
  /** Whether the IETF has any record of this address at all. */
  in_datatracker: !noRecord.has(id) && record !== null,
  messages: messages.get(id) ?? 0,
  replies_sent: repliesSent.get(id) ?? 0,
  replies_received: repliesReceived.get(id) ?? 0,
  lists: [...(listsOf.get(id) ?? [])].sort(),
  first_seen: firstSeen.get(id) ?? null,
  };
});
nodes.sort((a, b) => b.messages - a.messages || a.id.localeCompare(b.id));

/**
 * Messages per day, split by the sender's publication-record band.
 *
 * The trend this replaces plotted "participants" against "participants with
 * standing", which framed the list as two classes of person. Banding a
 * continuous score says the same thing about who is carrying the traffic
 * without sorting anyone into the anointed and the rest.
 */

/**
 * Threads, joined to the people in them.
 *
 * Person-replies-to-person answers "who talks to whom" and cannot answer "what
 * about". A thread node connected to each of its participants makes the second
 * question a shape in the same picture, and it is still a real network: an
 * edge means this account posted in this thread.
 */
/**
 * Which topic each thread was clustered into, if any.
 *
 * The operator needs topics to reason about the space: a thread is a
 * conversation and a topic is a subject, and "what is this list arguing about"
 * is a question about subjects.
 */
const topicOfThread = new Map<string, { id: string; label: string }>();
for (const list of graph.coverage.lists) {
  const path = join(ARTIFACTS_DIR, `topic-tree-${list}.json`);
  if (!(await Bun.file(path).exists())) continue;
  const tree = (await Bun.file(path).json()) as {
    topics: { id: string; label: string | null; subjects: string[]; threads: string[] }[];
  };
  for (const topic of tree.topics) {
    const label = topic.label ?? topic.subjects[0] ?? topic.id;
    for (const id of topic.threads) topicOfThread.set(id, { id: topic.id, label });
  }
}

/**
 * The shape of an exchange.
 *
 * Not "health" — the operator was right that the word is wrong, because it
 * implies a verdict on a discussion this system is in no position to give.
 * These are three counts of who did the talking, and each says something the
 * operator named:
 *
 *   participants   whether the list could follow along, or two people talked
 *   top_two_share  what fraction of the messages the two busiest sent. A long
 *                  thread where two accounts sent nearly all of it is the
 *                  amplification shape, whoever or whatever is doing it.
 *   quiet_for_days whether it resolved, stalled, or is still running. An
 *                  ending is not a verdict either; a thread can go quiet
 *                  because it was settled or because everyone gave up.
 */
const NOW = Date.parse(
  graph.nodes.reduce((latest, n) => ((n.sent_at ?? "") > latest ? n.sent_at! : latest), ""),
);

const threadRows = graph.threads
  .map((t) => {
    const members = graph.nodes.filter((n) => n.thread_id === t.thread_id);
    const senders = [...new Set(members.map((n) => n.sender_id))];
    const scores = senders.map((id) => scoreOf(id)?.score ?? 0);
    const perSender = new Map<string, number>();
    for (const n of members) perSender.set(n.sender_id, (perSender.get(n.sender_id) ?? 0) + 1);
    const topTwo = [...perSender.values()].sort((a, b) => b - a).slice(0, 2);
    const last = t.last_message_at ? Date.parse(t.last_message_at) : null;
    const topic = topicOfThread.get(t.thread_id) ?? null;
    return {
      id: t.thread_id,
      subject: t.subject,
      list_name: listOf.get(t.thread_id) ?? members[0]?.list_name ?? "",
      topic_id: topic?.id ?? null,
      topic_label: topic?.label ?? null,
      messages: members.length,
      participants: senders.map(slugFor),
      /** Highest contributor score among the people in it. A fact, not a verdict. */
      top_contributor: scores.length ? Math.max(...scores) : 0,
      /** Share of the thread sent by its two busiest accounts. */
      top_two_share: members.length
        ? Number((topTwo.reduce((a, b) => a + b, 0) / members.length).toFixed(3))
        : 0,
      quiet_for_days:
        last !== null && Number.isFinite(NOW) ? Math.round((NOW - last) / 86_400_000) : null,
      ...(() => {
        const verdict = utilityOf({
          messages: members.length,
          participants: senders.length,
          top_two_share: members.length
            ? topTwo.reduce((a, b) => a + b, 0) / members.length
            : 0,
          best_contributor: scores.length ? Math.max(...scores) : 0,
        });
        return { utility: verdict.utility, utility_reason: verdict.reason };
      })(),
      started_at: t.started_at ?? null,
      last_message_at: t.last_message_at ?? null,
      href: archiveMessageUrl(t.thread_id, listOf.get(t.thread_id) ?? ""),
    };
  })
  .sort((a, b) => b.messages - a.messages);

/** Topics, rolled up from the threads in them. Their own tier and own pages. */
const topicRows = [...topicOfThread.values()]
  .filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i)
  .map((topic) => {
    const own = threadRows.filter((t) => t.topic_id === topic.id);
    const participants = [...new Set(own.flatMap((t) => t.participants))];
    const utility = { high: 0, medium: 0, low: 0 } as Record<string, number>;
    for (const t of own) utility[t.utility] = (utility[t.utility] ?? 0) + 1;
    const dates = own.map((t) => t.last_message_at).filter(Boolean) as string[];
    const starts = own.map((t) => t.started_at).filter(Boolean) as string[];
    return {
      id: topic.id,
      label: topic.label,
      lists: [...new Set(own.map((t) => t.list_name))].sort(),
      threads: own.map((t) => t.id),
      messages: own.reduce((n, t) => n + t.messages, 0),
      participants,
      utility,
      top_contributor: own.reduce((m, t) => Math.max(m, t.top_contributor), 0),
      started_at: starts.length ? starts.sort()[0]! : null,
      last_message_at: dates.length ? dates.sort().at(-1)! : null,
    };
  })
  .filter((t) => t.threads.length > 0)
  .sort((a, b) => b.messages - a.messages);

/**
 * One row per day per list, broken down two ways.
 *
 * Per list because the two are a factor of twelve apart in volume and pooling
 * them hid that agentproto and agent2agent behave differently. Two breakdowns
 * because the operator asked for both scores over time: who is sending, and
 * what the threads they are sending into are like.
 */
type Levels = { high: number; medium: number; low: number };
type DayRow = { day: string; list_name: string; contributor: Levels; utility: Levels };
const emptyLevels = (): Levels => ({ high: 0, medium: 0, low: 0 });
const levelOfScore = (score: number): keyof Levels =>
  score >= 70 ? "high" : score >= 35 ? "medium" : "low";
const daily = new Map<string, DayRow>();
const levelOfSender = new Map<string, keyof Levels>();
for (const id of messages.keys()) levelOfSender.set(id, levelOfScore(scoreOf(id)?.score ?? 0));
const utilityOfThread = new Map(threadRows.map((t) => [t.id, t.utility]));
for (const n of graph.nodes) {
  if (!n.sent_at) continue;
  const day = n.sent_at.slice(0, 10);
  const list = listOf.get(n.thread_id) ?? "";
  const key = `${day} ${list}`;
  const row =
    daily.get(key) ?? { day, list_name: list, contributor: emptyLevels(), utility: emptyLevels() };
  row.contributor[levelOfSender.get(n.sender_id) ?? "low"] += 1;
  row.utility[(utilityOfThread.get(n.thread_id) ?? "low") as keyof Levels] += 1;
  daily.set(key, row);
}
// Days with no traffic are emitted as zeroes: a gap in a trend line has to
// read as "nothing happened", not as "not measured".
const days: DayRow[] = [];
const allDays = [...new Set([...daily.values()].map((r) => r.day))].sort();
const lists = [...new Set([...daily.values()].map((r) => r.list_name))].sort();
if (allDays.length > 0) {
  const cursor = new Date(`${allDays[0]!}T00:00:00Z`);
  const last = new Date(`${allDays[allDays.length - 1]!}T00:00:00Z`);
  while (cursor <= last) {
    const day = cursor.toISOString().slice(0, 10);
    for (const list of lists) {
      days.push(
        daily.get(`${day} ${list}`) ?? {
          day,
          list_name: list,
          contributor: emptyLevels(),
          utility: emptyLevels(),
        },
      );
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}

const artifact = {
  schema_version: "1.0.0",
  derived: true,
  publication: "aggregate_public" as const,
  generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  generator: "laocoon.reply_network/0.1.0",
  lists: graph.coverage.lists,
  reads_as:
    "Who replied to whom, from the From: headers and threading headers of posts " +
    "to public IETF lists. The Laocoon contributor score summarises a person's " +
    "published IETF record — RFCs, adopted drafts, roles — and is not a rating " +
    "of their messages. The Laocoon utility score describes the shape of a " +
    "thread from three counts of who did the talking. The graph-position " +
    "reputation this system computes is a different thing and stays local.",
  self_replies_dropped: selfReplies,
  daily: days,
  topics: topicRows,
  threads: threadRows,
  nodes,
  edges: [...pairs.values()].sort((a, b) => b.replies - a.replies),
};

const out = values.out ?? join(ARTIFACTS_DIR, "reply-network.json");
assertPublishableArtifact(out, artifact);
await Bun.write(out, JSON.stringify(artifact, null, 2) + "\n");

const counts: Record<string, number> = {};
for (const n of nodes) {
  const level = levelOfScore(n.score);
  counts[level] = (counts[level] ?? 0) + 1;
}
console.log(
  JSON.stringify(
    { out, people: nodes.length, edges: artifact.edges.length, selfReplies, counts },
    null,
    2,
  ),
);
