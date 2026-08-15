// GENERATED FILE - DO NOT EDIT.
// Source of truth: schemas/*.yaml. Regenerate with `bun run codegen`.

// --- account-reputation.yaml ---
/**
 * Per-account reputation and graph position. **Private, permanently.** This is a ranked participant list, which PROBLEM.md section 7 keeps out of publication; the marker `publication: private` is here so a publishing step can refuse it mechanically rather than by anyone remembering.
 * Scores are personalized PageRank restarted on the community-conferred seed, over account edges that point from a replier to the author they replied to. They measure reception and graph position. They are not a judgement about a person's competence, their good faith, or the provenance of anything they wrote, and nothing downstream may present them as one.
 */
export interface AccountReputation {
  schema_version: string;
  derived: true;
  publication: "private";
  generated_at: string;
  generator: {
    name: string;
    version: string;
  };
  /**
   * Recorded on every artifact the seed feeds, so a series computed under different rules is never silently compared.
   */
  seed_rule_version: string;
  damping: number;
  graph: {
    accounts: number;
    edges: number;
    /**
     * Replies to one's own message. Not evidence of anyone else's engagement, so they are excluded and counted.
     */
    self_reply_edges_dropped: number;
    /**
     * Seed members who actually posted. Propagation restarts only on these; a seed member who never posted contributes nothing.
     */
    seed_accounts_in_graph: number;
  };
  accounts: {
    sender_id: string;
    seeded: boolean;
    /**
     * Seed clauses matched. Empty for an unseeded account.
     */
    clauses: string[];
    ppr_replies: number;
    /**
     * Same propagation over only those replies that quote.
     */
    ppr_quoting: number;
    rank_replies: number;
    rank_quoting: number;
    community: number;
    core_number: number;
    replies_received: number;
    replies_sent: number;
  }[];
  /**
   * Rank correlation between the two weightings. Low agreement means the choice of weighting is doing the work rather than the data, and the result should not be trusted until the phase-3 substance classifier settles it.
   */
  weighting_agreement: {
    spearman: number | null;
    n: number;
  };
}

// --- community-structure.yaml ---
/**
 * The account graph's shape, with no account in it. Community sizes, how much each community talks outside itself, whether it contains anyone holding community-conferred standing, and how well the two edge weightings agree.
 * Marked `aggregate_public`: nothing here identifies a participant, so it is the kind of thing PROBLEM.md section 7 allows to be published. That is a permission, not an instruction — publication still happens only in phase 4 and only by an explicit decision.
 * A community with no seed member and a low external-edge ratio is the pattern section 3 exists to surface: a group that mostly replies to itself and does not connect to the rest of the list. That is a statement about a subgraph. It is not a claim that anyone in it is acting in bad faith, and it is emphatically not a claim about whether anything was machine-generated.
 */
export interface CommunityStructure {
  schema_version: string;
  derived: true;
  publication: "aggregate_public";
  generated_at: string;
  generator: {
    name: string;
    version: string;
  };
  seed_rule_version: string;
  /**
   * Composition of the list's participants against the seed rule. Counts only. "No datatracker record" is a fact about a lookup, never an inference about why, per section 8.
   */
  accounts: {
    total: number;
    seeded: number;
    no_datatracker_record: number;
    /**
     * Has a datatracker record that no clause of the seed rule matched.
     */
    resolved_but_unseeded: number;
  };
  graph: {
    accounts: number;
    edges: number;
    density: number;
    self_reply_edges_dropped: number;
  };
  /**
   * Modularity of the Louvain partition. Near 0 means the partition is barely better than arbitrary and should not be read as structure.
   */
  modularity: number;
  communities: {
    index: number;
    size: number;
    internal_edges: number;
    external_edges: number;
    /**
     * external / (internal + external). Near 0 is a community that mostly replies to itself.
     */
    external_edge_ratio: number;
    contains_seed_member: boolean;
    max_core_number: number;
  }[];
  communities_without_seed_member: {
    count: number;
    accounts: number;
  };
  weighting_agreement: {
    spearman: number | null;
    n: number;
  };
}

// --- event.yaml ---
/**
 * An immutable observed fact in the LAOCOON event log. Events are append-only and are never edited; a correction is a new compensating event. Everything else in the system (graphs, measures, the site) is a regenerable projection of this log.
 * `event_id` is the SHA-256 of the canonical JSON of `{event_type, payload}` and therefore excludes `observed_at`. Re-observing an unchanged fact produces the same `event_id`, so a re-crawl appends nothing. This is what keeps the log a stream of deltas rather than a daily snapshot.
 */
export type Event = {
  [k: string]: unknown;
} & {
  /**
   * SHA-256 over canonical JSON of {event_type, payload}. Idempotency key.
   */
  event_id: string;
  event_type:
    "MessageObserved" | "CrawlWindowCompleted" | "ObservationSuperseded" | "ThreadMeasured" | "ForecastEvaluated";
  /**
   * Version of this schema the event was written against.
   */
  schema_version: string;
  /**
   * When the observation was made, not when the observed thing happened. Deliberately excluded from `event_id`.
   */
  observed_at: string;
  source: SourceRef;
  payload: MessageObserved | CrawlWindowCompleted | ObservationSuperseded | ThreadMeasured | ForecastEvaluated;
};
/**
 * RFC 5322 msg-id with surrounding angle brackets and whitespace stripped. Case is preserved: msg-id comparison is case-sensitive in the local part.
 */
export type MessageId = string;
/**
 * SHA-256 of the lowercased, trimmed RFC 5322 addr-spec of the sender. The plaintext address is never written to the public log; the address-to-id map lives in the gitignored `private/` directory.
 * The hash is unsalted on purpose: a participant can hash their own address and confirm exactly which rows describe them, which is required by the contestability commitment in PROBLEM.md section 8. It is not a bulk harvesting surface, which a plaintext column would be.
 */
export type SenderId = string;
/**
 * Lowercase hex SHA-256, prefixed with its algorithm.
 */
export type ContentHash = string;

/**
 * Where an observation came from. The crawler sits behind an interface; this records which implementation actually produced the fact.
 */
export interface SourceRef {
  kind: "imap" | "projection" | "fixture";
  /**
   * Implementation-specific source identity, e.g. "imap.ietf.org".
   */
  name: string;
  /**
   * Mailbox path the observation was read from, when applicable.
   */
  mailbox?: string;
}
/**
 * Structural facts about one message as seen in one mailbox. Message bodies are NOT stored here: only a digest and shape counts. The corpus is already published by the IETF; re-publishing it in this repository would add nothing and could not be undone, because the log is immutable.
 */
export interface MessageObserved {
  /**
   * Bare list name, e.g. "agentproto".
   */
  list_name: string;
  /**
   * IMAP UID, unique and stable only within a given uid_validity.
   */
  uid: number;
  /**
   * IMAP UIDVALIDITY of the mailbox at observation time.
   */
  uid_validity: number;
  /**
   * Null when the message carried no parseable Message-ID header.
   */
  message_id: MessageId | null;
  /**
   * All msg-ids parsed from In-Reply-To, in header order.
   */
  in_reply_to: MessageId[];
  /**
   * All msg-ids parsed from References, in header order (root first).
   */
  references: MessageId[];
  subject: string;
  /**
   * Date header parsed to ISO 8601 UTC; null when unparseable.
   */
  sent_at: string | null;
  /**
   * The Date header verbatim, so an unparseable date is auditable.
   */
  sent_at_raw: string;
  sender_id: SenderId;
  body: BodyShape;
}
/**
 * Mechanical shape of the plain-text body. Every field here is countable without judging the text. Whether a reply is substantive is a separate, model-derived record introduced in phase 3, never a field on this event.
 */
export interface BodyShape {
  sha256: ContentHash;
  chars: number;
  lines: number;
  /**
   * Lines matching the RFC 3676 quote prefix ">".
   */
  quoted_lines: number;
  /**
   * lines - quoted_lines - signature/attribution lines removed. New text written by this sender, counted rather than judged.
   */
  unquoted_lines: number;
}
/**
 * What one crawl actually covered. Emitted on every run, successful or not, so a gap in coverage is a visible fact instead of a silent absence. Every published figure must be able to cite the windows it rests on.
 */
export interface CrawlWindowCompleted {
  list_name: string;
  /**
   * incremental walks UIDs above the watermark; full re-examines the whole mailbox and can emit ObservationSuperseded.
   */
  mode: "incremental" | "full";
  started_at: string;
  completed_at: string;
  uid_validity: number;
  /**
   * Messages the server reported present in the mailbox.
   */
  mailbox_total: number;
  /**
   * Highest UID already ingested before this run; null on first run.
   */
  watermark_before: number | null;
  watermark_after: number | null;
  uid_min_seen?: number | null;
  uid_max_seen?: number | null;
  uids_examined: number;
  messages_new: number;
  messages_unchanged: number;
  messages_superseded: number;
  /**
   * UIDs the crawl could not turn into an observation, and why.
   */
  failures: {
    uid: number;
    reason: string;
  }[];
}
/**
 * A previously recorded observation no longer matches the source. The earlier event stays in the log untouched; this event is the correction. Projections must ignore any MessageObserved that a later event supersedes.
 */
export interface ObservationSuperseded {
  list_name: string;
  uid: number;
  uid_validity: number;
  superseded_event_id: ContentHash;
  superseding_event_id: ContentHash;
  /**
   * `observation_differs` means the payload we would record now is not the one we recorded before. Ingestion cannot tell whether that is because the source changed or because our own parser was corrected, so it does not claim to: the git history of the parser disambiguates. Asserting "content_changed" would be a guess dressed as a fact.
   */
  reason: "observation_differs" | "uid_validity_changed";
}
/**
 * The published measure vector for one thread, as of one data horizon.
 * This is the only place a substance figure becomes public. The per-message verdicts it aggregates live in the private log, because a per-message quality label joined to the sender_id in this log would be a per-person quality score — forbidden by PROBLEM.md section 7. A per-thread ratio names nobody, and section 7 lists it as published.
 * It is an event rather than a projection for one reason: the temporal holdout in section 6 scores at time T and checks at T+7d, which requires the figure computed at T to still exist at T+7d. A regenerated projection would silently become the figure computed later. `measured_at` is therefore the **data horizon** — the point in time the inputs were cut off at — not the wall clock, so recomputing the same horizon produces the same event id and appends nothing.
 * Measures are a vector. There is no composite score here and there must not be one: PROBLEM.md section 7 rules it out, because a single number invites an argument about weights that cannot be won.
 */
export interface ThreadMeasured {
  thread_id: string;
  list_name: string;
  /**
   * Subject of the thread root, so a published measure is legible. Already public — it is in the IETF archive and in this repository's event log — and it names a discussion rather than a person.
   */
  subject: string;
  /**
   * Data horizon. Only messages sent at or before this are counted.
   */
  measured_at: string;
  /**
   * Recency window for the `*_in_window` fields.
   */
  window_days: number;
  /**
   * An account counts as a new participant if its first message on the list falls within this many days before `measured_at`.
   */
  new_participant_window_days: number;
  messages_total: number;
  /**
   * A count. Which accounts took part is per-person and stays private.
   */
  distinct_senders: number;
  max_depth: number;
  reply_pairs: number;
  mean_branching_factor: number;
  messages_in_window: number;
  distinct_senders_in_window: number;
  /**
   * Replies with a verdict from the reference model.
   */
  replies_classified: number;
  substantive_replies: number;
  hollow_replies: number;
  /**
   * The model declined to judge. Distinct from a pipeline error.
   */
  unclear_replies: number;
  /**
   * Replies with no verdict at all — not yet run, or the body was not cached. Reported so a partial classification cannot be mistaken for a thread of hollow replies.
   */
  unclassified_replies: number;
  /**
   * substantive / (substantive + hollow). Null when nothing was classified, never 0 — an unmeasured thread and a hollow thread are different facts.
   */
  substantive_reply_ratio: number | null;
  /**
   * Share of replies quoting at least one line. Mechanical, no model.
   */
  quoting_reply_ratio: number | null;
  /**
   * Count of participants holding community-conferred standing under the published seed rule. A count, never a list.
   */
  seeded_participants: number;
  new_participants: number;
  /**
   * Described, never ranked, per PROBLEM.md section 8. On a list only weeks old this is near 1 for every thread and carries no information; it is published anyway rather than hidden, so the limitation is visible.
   */
  new_participant_share: number | null;
  max_core_number: number;
  mean_core_number: number;
  /**
   * Without these a historical series silently stops being comparable the first time a model or a prompt changes.
   */
  provenance: {
    seed_rule_version: string;
    /**
     * The reference model whose verdicts the ratio is computed from.
     */
    classifier_model: string;
    prompt_hash: string;
    prompt_version: string;
    generator: string;
  };
}
/**
 * The system scoring itself. PROBLEM.md section 6 converts validation into forecasting: rank threads at time T, then check at T+7d whether the engagement actually materialised. That is objectively scorable with no human input and no hand labelling.
 * Every run records a baseline alongside the forecaster being tested. A correlation is meaningless without the trivial predictor to compare it to — if reputation-weighted engagement does not beat recent reply count, that is the finding, and it must be visible rather than absent.
 */
export interface ForecastEvaluated {
  /**
   * T. Only data at or before this was used to produce the ranking.
   */
  origin_at: string;
  horizon_days: number;
  /**
   * Name of the ranking rule, defined in docs/holdout.md.
   */
  forecaster: string;
  /**
   * True for the trivial predictor the others are judged against.
   */
  is_baseline: boolean;
  threads_scored: number;
  /**
   * Threads that actually received a reply in the horizon.
   */
  threads_with_engagement: number;
  /**
   * Rank correlation between predicted and actual. Null when there were too few threads to compute one.
   */
  spearman: number | null;
  p_value: number | null;
  /**
   * Share of the three top-ranked threads that saw engagement.
   */
  precision_at_3: number | null;
  /**
   * What was measured at T+horizon, e.g. "replies_in_horizon".
   */
  actual_metric: string;
  generator: string;
}

// --- private-event.yaml ---
/**
 * An immutable observed fact that must never be published. Same append-only discipline as the public log, different destination: `private/events/`, which is gitignored.
 * These events exist because identity resolution de-pseudonymises. A record saying "sender_id X is datatracker person 105857" turns the public log's hashes into named individuals, and PROBLEM.md section 7 keeps any label attached to a named individual out of publication. Nothing derived from this log may be published except as an aggregate that names nobody.
 * The community-conferred seed is computed from these facts. The seed *rule* is published (docs/seed-rule.md); the seed *membership* is not, and does not have to be — anyone can recompute it from the published rule and the same public datatracker API, which is what makes it contestable.
 */
export type PrivateEvent = {
  [k: string]: unknown;
} & {
  /**
   * SHA-256 over canonical JSON of {event_type, payload}. Idempotency key.
   */
  event_id: string;
  event_type: "SenderResolved" | "DatatrackerRecordFetched" | "MessageClassified";
  schema_version: string;
  observed_at: string;
  source: PrivateSourceRef;
  payload: SenderResolved | DatatrackerRecordFetched | MessageClassified;
};

export interface PrivateSourceRef {
  kind: "datatracker" | "ollama" | "fixture";
  name: string;
  mailbox?: string;
}
/**
 * An address seen on a list, mapped to a datatracker person — or explicitly mapped to nothing. "No datatracker record" is recorded as a fact, never as an inference about why, per PROBLEM.md section 8.
 */
export interface SenderResolved {
  /**
   * The hash that appears in the public log. The join key.
   */
  sender_id: string;
  /**
   * Plaintext, and the reason this log is gitignored.
   */
  address: string;
  person_id: number | null;
  resolution: "matched" | "no_record";
  /**
   * The datatracker `origin` field for the address, verbatim — it states how the address entered the system, e.g. "author: draft-foo-bar". It is recorded because it is informative, and deliberately NOT used by the seed rule: an individual submission is self-conferred standing.
   */
  origin: string;
}
/**
 * What the datatracker said about one person at one moment. Facts only; the seed rule is applied later, as a projection, so re-deciding the rule never requires re-crawling and never rewrites history.
 */
export interface DatatrackerRecordFetched {
  person_id: number;
  fetched_at: string;
  /**
   * Current and historic chair roles, with the group's type resolved.
   */
  chair_roles: RoleFact[];
  ad_roles: RoleFact[];
  iab_iesg_roles: RoleFact[];
  /**
   * Count of documents of type rfc this person is an author of.
   */
  rfc_authorships: number;
  /**
   * Names of documents whose group is a working group AND whose name starts with "draft-ietf-", capped at 10. Names are kept rather than a bare count so the adopted-document test is applied to the actual name instead of trusting the group filter as a proxy for adoption.
   */
  wg_document_authorships: string[];
  /**
   * The API paths this record was assembled from, for audit.
   */
  endpoints: string[];
}
/**
 * One role, recorded as the query that found it rather than as a resolved group object. The datatracker can filter roles by group type and acronym directly, so the group's type is known by construction and no extra per-group request is made.
 */
export interface RoleFact {
  role: string;
  /**
   * The group or grouphistory resource URI the role points at.
   */
  group_ref: string;
  /**
   * Known from the filter that matched: "wg" for the WG-chair query, "iab_or_iesg" for the IAB/IESG query, "" when the query did not constrain the group type (the AD query).
   */
  group_type: string;
  /**
   * true from the role endpoint, false from rolehistory.
   */
  current: boolean;
}
/**
 * One model's verdict on whether one reply engages with the message it answers. Private, and necessarily so: a per-message quality label joined to the sender_id in the public log yields a per-person quality score in one line, which PROBLEM.md section 7 forbids publishing. What gets published is the per-thread ratio, carried by a `ThreadMeasured` event in the public log.
 * The verdict concerns the relationship between two texts and nothing else. There is no field here, and no question in the prompt, about who wrote either message or how. Recording a provenance judgement would be outside what this project is allowed to do, not merely unused.
 * `body_sha256` ties the verdict to the exact text judged, so a re-observed message whose body changed does not silently keep an obsolete label.
 */
export interface MessageClassified {
  message_id: string;
  list_name: string;
  /**
   * The message this reply was judged against.
   */
  parent_message_id: string;
  /**
   * Ollama model tag, e.g. "gemma4:12b". Without it the series silently stops being comparable across a model upgrade.
   */
  model: string;
  /**
   * SHA-256 of the prompt template, not of the filled prompt, so every message classified under one template shares one hash.
   */
  prompt_hash: string;
  prompt_version: string;
  /**
   * `unclear` is the model declining to judge; `error` is the pipeline failing to get an answer. They are different facts and are never collapsed.
   */
  verdict: "substantive" | "hollow" | "unclear" | "error";
  /**
   * The model's short justification, kept for review. Private.
   */
  reason: string;
  body_sha256: string;
  parent_body_sha256: string;
  classified_at: string;
  duration_ms: number;
}

// --- reply-graph.yaml ---
/**
 * A projection of the event log: the directed reply graph for one or more lists, plus the coverage it was built from and the diagnostics that say how complete it is. This artifact is derived and regenerable. It is never authoritative and is never committed; delete it and re-run the projection.
 * Edges come only from In-Reply-To and References. Subject-line threading is deliberately absent: it invents edges the corpus does not contain. Messages with no threading headers are reported as a count, not repaired.
 */
export interface ReplyGraph {
  schema_version: string;
  /**
   * Present so no consumer can mistake this file for a source of truth.
   */
  derived: true;
  /**
   * This artifact must not be published. Its nodes carry `sender_id`, from which anyone could compute per-account reply counts and centrality — a ranked participant list, which PROBLEM.md section 7 keeps private. It is the substrate the publishable thread-level measures are derived from, not a publishable object itself. A publishing step must refuse any artifact whose `publication` is `private`.
   */
  publication: "private";
  generated_at: string;
  generator: {
    name: string;
    version: string;
  };
  /**
   * The crawl coverage this graph rests on, carried into the artifact so that any figure derived from it can state what it did and did not see.
   */
  coverage: {
    lists: string[];
    event_count: number;
    message_event_count: number;
    observed_from?: string | null;
    observed_to?: string | null;
    sent_from?: string | null;
    sent_to?: string | null;
    /**
     * Every CrawlWindowCompleted the projection replayed.
     */
    windows: {
      list_name: string;
      mode: string;
      started_at: string;
      completed_at: string;
      mailbox_total: number;
      uids_examined: number;
      failure_count: number;
    }[];
  };
  nodes: {
    message_id: string;
    list_name: string;
    uid: number;
    sender_id: string;
    sent_at: string | null;
    subject: string;
    /**
     * message_id of the root of this message's weakly connected component.
     */
    thread_id: string;
    /**
     * Reply distance from the thread root. 0 for a root.
     */
    depth: number;
    /**
     * Number of direct replies this message received.
     */
    in_degree: number;
    /**
     * 1 if this message replies to a message present in the corpus, else 0.
     */
    out_degree: number;
    body: {
      chars: number;
      quoted_lines: number;
      unquoted_lines: number;
    };
  }[];
  /**
   * child -> parent. One edge per message that has a resolvable parent.
   */
  edges: {
    child: string;
    parent: string;
    /**
     * Which header the edge was read from. in_reply_to is the direct claim; references is the fallback when In-Reply-To is absent or dangling.
     */
    via: "in_reply_to" | "references";
  }[];
  threads: {
    thread_id: string;
    list_name: string;
    /**
     * Subject of the thread root message.
     */
    subject: string;
    message_count: number;
    /**
     * Count only. Which senders participated is per-person data and stays out of any artifact intended for publication.
     */
    distinct_senders: number;
    max_depth: number;
    /**
     * reply_pairs divided by the number of messages in this thread that received at least one reply. 0 for a thread with no replies. A high value is a thread that fanned out; a value near 1 is a chain.
     */
    mean_branching_factor: number;
    started_at: string | null;
    last_message_at: string | null;
    /**
     * Number of resolved child->parent edges inside this thread.
     */
    reply_pairs: number;
  }[];
  /**
   * Everything the graph could not do, stated as counts. A projection that hides its gaps is worse than no projection.
   */
  diagnostics: {
    messages_total: number;
    messages_superseded_skipped: number;
    /**
     * Cannot be a node target; still counted as a message.
     */
    messages_without_message_id: number;
    /**
     * Neither In-Reply-To nor References. Cannot be attached to a parent.
     */
    messages_without_threading_headers: number;
    /**
     * Distinct message_ids seen more than once across the corpus.
     */
    duplicate_message_ids: number;
    /**
     * Messages whose threading headers name a parent that is not in the crawled corpus. Usually a cross-list reply or a message sent before the crawl window.
     */
    dangling_parent_refs: number;
    edges_from_in_reply_to: number;
    edges_from_references: number;
    /**
     * Messages with no resolvable parent.
     */
    roots: number;
    thread_count: number;
    /**
     * Threads of size 1 — a message that neither replied nor was replied to.
     */
    isolated_messages: number;
  };
}

// --- seed.yaml ---
/**
 * The community-conferred seed set: the accounts reputation propagation starts from. A projection of the private log through the rule in `src/seed/rule.ts`, which is published as prose in `docs/seed-rule.md`.
 * Private. Membership is a label attached to an identifiable person, and section 7 of PROBLEM.md keeps those out of publication. It does not need to be published to be contestable: the rule is public and the datatracker is public, so anyone can recompute this file and disagree with it.
 * This is also the seam between the two runtimes. The rule lives in TypeScript and is applied here; the Python side consumes this artifact and never re-implements the rule, so the two cannot drift.
 */
export interface Seed {
  schema_version: string;
  derived: true;
  publication: "private";
  generated_at: string;
  /**
   * Version of the rule that produced this membership. Changing the rule changes this, and every artifact downstream records it.
   */
  seed_rule_version: string;
  /**
   * The funnel from list participants to seed members. `no_datatracker_record` is reported as a fact and never as an inference about why, per section 8.
   */
  counts: {
    addresses_seen: number;
    resolved_to_person: number;
    no_datatracker_record: number;
    /**
     * Resolved people whose datatracker record has been fetched.
     */
    records_available: number;
    seeded: number;
    unseeded: number;
  };
  /**
   * How many members each clause of the rule accounted for.
   */
  clause_counts?: {
    [k: string]: number;
  };
  members: {
    sender_id: string;
    person_id: number;
    /**
     * Every clause of the rule that matched, so a verdict is explainable clause by clause rather than as a bare boolean.
     *
     * @minItems 1
     */
    clauses: [string, ...string[]];
  }[];
  /**
   * Accounts the rule did not seed, and why not — whether they were never resolved, have no datatracker record, or have one that no clause matched. Recorded so "not seeded" is never silently the same as "not looked at".
   */
  unseeded: {
    sender_id: string;
    person_id?: number | null;
    reason: "not_resolved" | "no_datatracker_record" | "record_missing" | "no_clause_matched";
  }[];
}

