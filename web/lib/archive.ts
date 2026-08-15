/**
 * Deep links into the IETF mail archive.
 *
 * The hash is `base64url(sha1(message_id + list_name))` with the angle brackets
 * stripped and the padding removed. That is not documented anywhere I could
 * find — one source claimed base32 — so it was recovered by taking a known
 * archived message, reading its Message-ID, and reproducing its URL token.
 * There is a test pinning that exact case, because the whole scheme is a guess
 * until something checks it.
 *
 * The archive itself is Cloudflare-blocked to automated fetches (PROBLEM.md
 * §5), so these links are for a human to click. Nothing in the pipeline
 * dereferences them.
 *
 * Duplicated from src/lib/archive.ts: the web app and the pipeline are separate
 * TypeScript projects. The test that pins the algorithm lives with the source.
 */
import { createHash } from "node:crypto";

export const ARCHIVE_HOST = "https://mailarchive.ietf.org";

/** The archive's stable token for a message on a list. */
export function archiveToken(messageId: string, listName: string): string {
  const bare = messageId.trim().replace(/^<+/, "").replace(/>+$/, "");
  return createHash("sha1")
    .update(bare + listName, "utf8")
    .digest("base64url")
    .replace(/=+$/, "");
}

/** Permalink to one message. */
export function archiveMessageUrl(messageId: string, listName: string): string {
  return `${ARCHIVE_HOST}/arch/msg/${encodeURIComponent(listName)}/${archiveToken(messageId, listName)}/`;
}

/** The archive's browse view for a whole list. */
export function archiveListUrl(listName: string): string {
  return `${ARCHIVE_HOST}/arch/browse/${encodeURIComponent(listName)}/`;
}
