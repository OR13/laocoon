// GENERATED FILE - DO NOT EDIT.
// Source of truth: schemas/*.yaml. Regenerate with `bun run codegen`.

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
  event_type: "MessageObserved" | "CrawlWindowCompleted" | "ObservationSuperseded";
  /**
   * Version of this schema the event was written against.
   */
  schema_version: string;
  /**
   * When the observation was made, not when the observed thing happened. Deliberately excluded from `event_id`.
   */
  observed_at: string;
  source: SourceRef;
  payload: MessageObserved | CrawlWindowCompleted | ObservationSuperseded;
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
  kind: "imap" | "fixture";
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
  reason: "content_changed" | "uid_validity_changed";
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

