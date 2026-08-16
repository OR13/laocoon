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
import type { Event, MessageObserved, ReplyGraph } from "../schema/generated.ts";
import { JsonlEventStore } from "../store/jsonl-store.ts";
import { assertPublishableArtifact } from "../site/publishable.ts";
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
  members: { sender_id: string }[];
  unseeded: { sender_id: string; reason: string }[];
};
const standing = new Set(seedDoc.members.map((m) => m.sender_id));
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

const nodes = [...messages.keys()].map((id) => ({
  id: slugFor(id),
  name: labelFor(id),
  // The three states the picture is about, each from one lookup and no model.
  standing: standing.has(id)
    ? ("standing" as const)
    : noRecord.has(id)
      ? ("no_record" as const)
      : ("record" as const),
  messages: messages.get(id) ?? 0,
  replies_sent: repliesSent.get(id) ?? 0,
  replies_received: repliesReceived.get(id) ?? 0,
  lists: [...(listsOf.get(id) ?? [])].sort(),
  first_seen: firstSeen.get(id) ?? null,
}));
nodes.sort((a, b) => b.messages - a.messages || a.id.localeCompare(b.id));

const artifact = {
  schema_version: "1.0.0",
  derived: true,
  publication: "aggregate_public" as const,
  generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  generator: "laocoon.reply_network/0.1.0",
  lists: graph.coverage.lists,
  reads_as:
    "Who replied to whom, from the From: headers and threading headers of posts " +
    "to public IETF lists. Nodes are sized by messages sent, which is a count. " +
    "No per-person score appears here: reputation is this system's opinion of a " +
    "person and stays local.",
  self_replies_dropped: selfReplies,
  nodes,
  edges: [...pairs.values()].sort((a, b) => b.replies - a.replies),
};

const out = values.out ?? join(ARTIFACTS_DIR, "reply-network.json");
assertPublishableArtifact(out, artifact);
await Bun.write(out, JSON.stringify(artifact, null, 2) + "\n");

const counts = { standing: 0, record: 0, no_record: 0 };
for (const n of nodes) counts[n.standing]++;
console.log(
  JSON.stringify(
    { out, people: nodes.length, edges: artifact.edges.length, selfReplies, counts },
    null,
    2,
  ),
);
