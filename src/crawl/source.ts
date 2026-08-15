/**
 * The crawling seam.
 *
 * IMAP is today's source and is expected to become the bottleneck. Ingestion
 * talks only to this interface, so a replacement source — a bulk archive dump, a
 * different protocol — is a new implementation and nothing else.
 */
import type { SourceRef } from "../schema/generated.ts";

export interface MailboxSnapshot {
  /** UIDs are only comparable across runs while this value is unchanged. */
  uidValidity: number;
  /** Messages the source reports present. */
  exists: number;
}

export interface RawMessage {
  uid: number;
  /** Full RFC 5322 bytes, exactly as the source returned them. */
  source: Uint8Array;
}

export interface MessageSource {
  readonly ref: SourceRef;
  connect(): Promise<void>;
  close(): Promise<void>;

  /** Open a list read-only and report its current state. */
  snapshot(listName: string): Promise<MailboxSnapshot>;

  /**
   * UIDs to examine. `afterUid` is exclusive; null means every UID in the list.
   * Returned ascending.
   */
  uids(listName: string, afterUid: number | null): Promise<number[]>;

  /**
   * Fetch messages by UID. Implementations should batch: one request per batch
   * is the difference between being a good citizen of shared infrastructure and
   * being a load generator. UIDs that vanish between listing and fetching are
   * simply absent from the result.
   */
  fetch(listName: string, uids: readonly number[]): AsyncIterable<RawMessage>;
}
