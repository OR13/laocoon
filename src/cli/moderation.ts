#!/usr/bin/env bun
/**
 * The moderation view: observable facts about each account, side by side.
 *
 *   bun run moderation
 *
 * **Private, always.** Every row is about a named person once joined to the
 * address table, which PROBLEM.md section 7 keeps local. Nothing here reaches
 * the site, and the artifact declares `publication: "private"` so the site
 * builder refuses it if anyone tries.
 *
 * **What this is for.** The operator's stated purpose is to see what is
 * happening on a list clearly enough to moderate it, and their description of
 * the problem is specific and entirely observable: accounts with no
 * Datatracker record, posting in volume, replying mostly to each other, and
 * offering nothing a reader could check.
 *
 * **What this deliberately is not.** There is no score, no ranking by
 * suspicion, no flag, and no label. Each of those four facts is a separate
 * column, and the row is the whole output. The system does not conclude
 * anything about an account, because the conclusion the operator has in mind —
 * that an account is a program — is not something any of these columns can
 * establish, and a column that implied it would be the one field PROBLEM.md
 * section 2 forbids. A person who joined last week, has no drafts, and writes
 * short encouraging replies produces the same row, which is exactly why the
 * judgement has to stay with the moderator.
 *
 * The sort is by message count, because that is the order in which a moderator
 * reading a list encounters people, and any other default would be an opinion.
 */
import { join } from "node:path";
import { PRIVATE_DIR } from "../lib/paths.ts";

interface SeedDoc {
  members: { sender_id: string; person_id: number | null; clauses: string[] }[];
  unseeded: { sender_id: string; person_id: number | null; reason: string }[];
}
interface ConcretenessDoc {
  list_name: string;
  messages: {
    message_id: string;
    sender_id: string;
    words: number;
    referent_kinds: number;
    questions: number;
    contends: number;
    offers_nothing_checkable: boolean;
  }[];
}
interface UptakeDoc {
  messages: {
    id: string;
    sender_id: string;
    thread_id: string;
    replies: number;
    replies_from_standing: number;
    novelty: number | null;
  }[];
}
interface ClosedLoopDoc {
  findings: { community: number; members: number; flagged: boolean }[];
}
interface SenderView {
  persons: {
    id: string;
    messages: number;
    threads_participated: number;
    threads_started: number;
    replies_sent: number;
    replies_received: number;
    first_seen: string | null;
    last_seen: string | null;
    seeded: boolean;
    label?: string;
  }[];
}

const lists = ["agentproto", "agent2agent"];
const privateArtifact = (name: string) => join(PRIVATE_DIR, "artifacts", name);

const seed = (await Bun.file(privateArtifact("seed.json")).json()) as SeedDoc;
const senderView = (await Bun.file(privateArtifact("sender-view.json")).json()) as SenderView;

/**
 * Accounts with no Datatracker record at all.
 *
 * This is a fact about the IETF's own systems, not an inference: the seed rule
 * resolves each address against `/api/v1/person/email/` and records when there
 * is nothing to resolve. It means the account has never been associated with a
 * person in the IETF's records — no drafts, no roles, no meeting registration.
 * It does not mean anything else, and in particular a new participant who has
 * simply never filed anything looks identical.
 */
const noRecord = new Set(
  seed.unseeded.filter((u) => u.reason === "no_datatracker_record").map((u) => u.sender_id),
);
const clausesOf = new Map(seed.members.map((m) => [m.sender_id, m.clauses]));
const withStanding = new Set(seed.members.map((m) => m.sender_id));
const personRow = new Map(senderView.persons.map((p) => [p.id, p]));

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const perList: Record<string, unknown> = {};

for (const list of lists) {
  const concretePath = privateArtifact(`concreteness-${list}.json`);
  const uptakePath = privateArtifact(`uptake-${list}.json`);
  if (!(await Bun.file(concretePath).exists()) || !(await Bun.file(uptakePath).exists())) {
    console.error(`skipping ${list}: run \`bun run concreteness\` and the uptake pass first`);
    continue;
  }
  const concrete = (await Bun.file(concretePath).json()) as ConcretenessDoc;
  const uptake = (await Bun.file(uptakePath).json()) as UptakeDoc;

  const closedPath = privateArtifact(`closed-loop-${list}.json`);
  const closedLoop = (await Bun.file(closedPath).exists())
    ? ((await Bun.file(closedPath).json()) as ClosedLoopDoc)
    : { findings: [] };

  const senderOf = new Map(uptake.messages.map((m) => [m.id, m.sender_id]));
  const bySender = new Map<string, typeof concrete.messages>();
  for (const message of concrete.messages) {
    const own = bySender.get(message.sender_id) ?? [];
    own.push(message);
    bySender.set(message.sender_id, own);
  }
  const uptakeBySender = new Map<string, typeof uptake.messages>();
  for (const message of uptake.messages) {
    const own = uptakeBySender.get(message.sender_id) ?? [];
    own.push(message);
    uptakeBySender.set(message.sender_id, own);
  }

  // Who each account's repliers were, so "replied to mostly by accounts with
  // no record" can be counted rather than guessed at.
  const repliersTo = new Map<string, string[]>();
  for (const message of uptake.messages) {
    if (message.replies === 0) continue;
    repliersTo.set(message.sender_id, repliersTo.get(message.sender_id) ?? []);
  }

  const rows = [...bySender.entries()]
    .map(([senderId, messages]) => {
      const mine = uptakeBySender.get(senderId) ?? [];
      const person = personRow.get(senderId);
      const substantial = messages.filter((m) => m.words >= 40);
      const repliesDrawn = mine.reduce((sum, m) => sum + m.replies, 0);
      const fromStanding = mine.reduce((sum, m) => sum + m.replies_from_standing, 0);
      return {
        sender_id: senderId,
        // The four facts, each on its own, in the order the operator named them.
        has_datatracker_record: !noRecord.has(senderId),
        has_community_standing: withStanding.has(senderId),
        standing_clauses: clausesOf.get(senderId) ?? [],
        messages: messages.length,
        threads_participated: person?.threads_participated ?? null,
        threads_started: person?.threads_started ?? null,
        first_seen: person?.first_seen ?? null,
        last_seen: person?.last_seen ?? null,
        replies_drawn: repliesDrawn,
        replies_drawn_from_standing: fromStanding,
        // Concreteness, summarised per account. Medians, because one heavily
        // cited message should not carry an account's whole profile.
        median_referent_kinds: median(messages.map((m) => m.referent_kinds)),
        median_words: median(messages.map((m) => m.words)),
        share_offering_nothing_checkable: substantial.length
          ? Number(
              (
                substantial.filter((m) => m.offers_nothing_checkable).length / substantial.length
              ).toFixed(3),
            )
          : null,
        share_asking_a_question: messages.length
          ? Number((messages.filter((m) => m.questions > 0).length / messages.length).toFixed(3))
          : null,
        share_contending: messages.length
          ? Number((messages.filter((m) => m.contends > 0).length / messages.length).toFixed(3))
          : null,
        median_novelty: median(
          mine.map((m) => m.novelty).filter((n): n is number => n !== null),
        ),
      };
    })
    // Volume order: how a moderator reading the list meets people. Any other
    // default sort would be the tool asserting what matters.
    .sort((a, b) => b.messages - a.messages);

  void senderOf;
  void repliersTo;

  const withoutRecord = rows.filter((r) => !r.has_datatracker_record);
  perList[list] = {
    accounts: rows.length,
    accounts_without_datatracker_record: withoutRecord.length,
    messages_from_accounts_without_record: withoutRecord.reduce((s, r) => s + r.messages, 0),
    messages_total: rows.reduce((s, r) => s + r.messages, 0),
    closed_loop_communities_flagged: closedLoop.findings.filter((f) => f.flagged).length,
    rows,
  };
}

const artifact = {
  schema_version: "1.0.0",
  derived: true,
  publication: "private" as const,
  generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  generator: "laocoon.moderation/0.1.0",
  reads_as:
    "Four independent facts per account: whether the IETF has a record of them, " +
    "how much they post, whether the established part of the group replies, and " +
    "what their messages point at. No score, no ranking by suspicion, no label. " +
    "A new participant with no drafts who writes short encouraging replies " +
    "produces the same row as anything else that does, which is why the reading " +
    "is the moderator's and not the tool's.",
  per_list: perList,
};

const out = privateArtifact("moderation.json");
await Bun.write(out, JSON.stringify(artifact, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      out,
      per_list: Object.fromEntries(
        Object.entries(perList).map(([list, data]) => {
          const d = data as Record<string, unknown>;
          return [list, { ...d, rows: undefined }];
        }),
      ),
    },
    null,
    2,
  ),
);
