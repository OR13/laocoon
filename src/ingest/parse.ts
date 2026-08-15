/**
 * Header and body normalisation. Pure functions: no network, no clock, no
 * filesystem, so the rules below are directly testable and can be argued with.
 *
 * Nothing here judges a message. Every output is a count or a normalised
 * identifier. Whether a reply is substantive is a phase-3 question answered by a
 * model against the cached body, and it never becomes a field on an observation.
 */

/** A msg-id token inside angle brackets. */
const MSG_ID_TOKEN = /<([^<>]+)>/g;

/**
 * Mailman appends a footer after a rule of underscores.
 *
 * The leading whitespace is not optional decoration: on this corpus the rule
 * arrives as `" _______…"` with a leading space on 71 of 106 messages, and an
 * anchored `^_{20,}$` matched none of them. A quoted rule (`"> ____"`) is
 * deliberately not matched — that is the footer of a message being quoted, and
 * truncating there would discard the quoting message's own text.
 */
const LIST_FOOTER_RULE = /^[ \t]*_{20,}[ \t]*$/;

/** RFC 3676 signature separator. */
const SIGNATURE_SEPARATOR = /^[ \t]*--\s?$/;

/**
 * The header some mobile clients write above quoted text, e.g.
 * `-------- Original message --------From: … Date: …`. It arrives as one long
 * line rather than as a quote block, so nothing downstream would recognise it,
 * and it would otherwise be counted as text the sender wrote.
 */
const ORIGINAL_MESSAGE_HEADER = /^[ \t]*-{4,}\s*Original [Mm]essage\s*-{4,}/;

/** A quoted line, allowing the leading whitespace some clients insert. */
const QUOTED_LINE = /^\s*>/;

/**
 * The attribution line a client writes above a quote ("On <date>, X wrote:").
 * It is boilerplate, not text the sender composed, so it is excluded from the
 * new-text count. Matched conservatively: the line must end in "wrote:".
 */
const ATTRIBUTION_LINE = /wrote:\s*$/;

/**
 * Strip angle brackets and whitespace from a msg-id.
 *
 * Case is preserved. RFC 5322 msg-id comparison is case-sensitive in the local
 * part, and lowercasing here would silently merge two distinct messages.
 */
export function normalizeMessageId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^<+/, "").replace(/>+$/, "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * All msg-ids in a header value, in header order, deduplicated.
 *
 * In-Reply-To is specified to hold one msg-id but real clients put several
 * there; References holds many. Both are parsed the same way. A value with no
 * angle brackets is treated as a single bare msg-id, which is what the
 * non-conforming clients that produce them mean.
 */
export function parseMessageIdList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (candidate: string | null): void => {
    if (candidate && !seen.has(candidate)) {
      seen.add(candidate);
      out.push(candidate);
    }
  };

  const matches = [...raw.matchAll(MSG_ID_TOKEN)];
  if (matches.length > 0) {
    for (const m of matches) push(normalizeMessageId(m[1]));
    return out;
  }
  for (const token of raw.split(/\s+/)) push(normalizeMessageId(token));
  return out;
}

export interface BodyShapeCounts {
  chars: number;
  lines: number;
  quoted_lines: number;
  unquoted_lines: number;
}

/**
 * Mechanical shape of a plain-text body.
 *
 * Rules, in order of application:
 *   1. everything from the mailman footer rule onward is discarded — it is added
 *      by the list, not written by the sender;
 *   2. everything from an RFC 3676 signature separator, or a mobile client's
 *      "-------- Original message --------" header, onward is discarded;
 *   3. `quoted_lines` counts lines beginning with `>`;
 *   4. `unquoted_lines` counts the remaining lines that are non-blank and are
 *      not a client-generated attribution line. It is a count of lines of new
 *      text, not an opinion about them.
 *
 * `chars` and `lines` describe the body after step 1 and 2, so two messages
 * differing only in signature are not reported as different lengths.
 */
export function bodyShape(text: string): BodyShapeCounts {
  const all = text.replace(/\r\n/g, "\n").split("\n");

  let end = all.length;
  for (let i = 0; i < all.length; i += 1) {
    const line = all[i]!;
    if (
      LIST_FOOTER_RULE.test(line) ||
      SIGNATURE_SEPARATOR.test(line) ||
      ORIGINAL_MESSAGE_HEADER.test(line)
    ) {
      end = i;
      break;
    }
  }
  const lines = all.slice(0, end);
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();

  let quoted = 0;
  let unquoted = 0;
  for (const line of lines) {
    if (QUOTED_LINE.test(line)) {
      quoted += 1;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (ATTRIBUTION_LINE.test(trimmed)) continue;
    unquoted += 1;
  }

  return {
    chars: lines.join("\n").length,
    lines: lines.length,
    quoted_lines: quoted,
    unquoted_lines: unquoted,
  };
}

/**
 * Parse a Date header to an ISO 8601 UTC string, or null when it cannot be
 * parsed. The raw header is always kept alongside so an unparseable date stays
 * auditable instead of becoming a silent gap.
 */
export function parseSentAt(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const parsed = new Date(raw.trim());
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/** Lowercased addr-spec from a From header value, or null. */
export function extractAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const angled = raw.match(/<([^<>@\s]+@[^<>@\s]+)>/);
  if (angled?.[1]) return angled[1].trim().toLowerCase();
  const bare = raw.match(/([^\s<>(),;:"]+@[^\s<>(),;:"]+)/);
  return bare?.[1] ? bare[1].trim().toLowerCase() : null;
}
