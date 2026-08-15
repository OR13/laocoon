/**
 * Concreteness: what a message points at that a reader could go and check.
 *
 * **Why this exists.** The substantive/hollow classifier returned `substantive`
 * for 162 of 164 replies. It had no discriminating power, and the reason is
 * that it was asking the wrong question. So was novelty, from the other
 * direction: novelty is embedding distance from what the thread already said,
 * so *fluent filler scores high on it* — new words, new framings, nothing
 * checkable. Neither measure could see the thing the operator describes,
 * because neither was looking at whether a message commits to anything.
 *
 * A contribution to a standards discussion earns its place by referring to
 * something outside itself: a draft, a section, a registry, an error case, a
 * line of the message it is answering. That is mechanically countable, and
 * counting it needs no model, no judgement about the author, and no guess
 * about how the text was produced.
 *
 * **This is not a provenance signal and cannot be turned into one.** A human
 * writing "+1, agreed, this looks good to me" scores zero here, and should:
 * the measure is of what the message offers the discussion, not of who or what
 * wrote it. A generated message full of correct section references scores
 * high, and should, for the same reason.
 *
 * Every count is over **authored text only** — `newText()` has already removed
 * quoted material, signatures and the list footer — so a reply does not
 * inherit the concreteness of the message it quotes. That distinction is the
 * whole point: quoting a draft name is not the same as engaging with it.
 */

/** A reference to an Internet-Draft, with or without a version suffix. */
const DRAFT = /\bdraft-[a-z0-9]+(?:-[a-z0-9]+)+\b/gi;
/** RFC 9110, RFC-9110, rfc9110. */
const RFC = /\bRFC[\s-]?(\d{3,5})\b/gi;
/**
 * A pointer into a document: "Section 4.2", "§3", "Appendix B", "clause 5".
 * These are the citations that say a reader actually opened the thing.
 */
const SECTION = /(?:\bsection\b|\bappendix\b|\bclause\b|§)\s*[A-Z]?\d+(?:\.\d+)*/gi;
/** Any absolute link. */
const URL = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
/**
 * IANA registries and the fields inside them — the vocabulary of an argument
 * about interoperability rather than about intentions.
 */
const REGISTRY = /\b(?:IANA|registry|media type|URN|OID|well-known)\b/gi;
/**
 * Fenced code, ABNF, JSON, or an indented block that looks like a wire format.
 * A worked example is the strongest form of "here is what I actually mean".
 */
const CODE_FENCE = /```|~~~/g;
const ABNF = /^\s*[A-Za-z][A-Za-z0-9-]*\s*=\s*\S/gm;
const JSONISH = /^\s*[{[]\s*$|^\s*"[A-Za-z_][\w-]*"\s*:/gm;
/** A question that names something, as opposed to "thoughts?". */
const QUESTION = /\?/g;
/**
 * Normative keywords. Their presence says the author is making or contesting a
 * requirement rather than commenting on one.
 */
const NORMATIVE = /\b(?:MUST|MUST NOT|SHALL|SHOULD|SHOULD NOT|MAY|REQUIRED|OPTIONAL)\b/g;
/**
 * Disagreement and correction. A discussion where nobody ever contradicts
 * anybody is not a technical discussion, and the operator's description of the
 * problem is precisely a stream of agreement.
 */
const CONTENDS =
  /\b(?:disagree|I don't think|I do not think|that's not|that is not|incorrect|wrong|counter-?example|however|but the|problem with|breaks|fails|doesn't work|does not work|objection|concern(?:ed)? (?:is|that|about))\b/gi;
/**
 * Pure endorsement. Not evidence of anything on its own — plenty of useful
 * messages open with agreement — but a message that is *only* this is the
 * shape the operator is describing.
 */
const ENDORSEMENT =
  /^\s*(?:\+1|\+\s?1|agreed?|agree|this|same|\\o\/|lgtm|sgtm|thanks?|thank you|great|excellent|nice|well said|good point|makes sense|exactly|indeed|absolutely|strongly agree|I support this|looking forward)\b/gim;

function count(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

export interface Concreteness {
  /** Words of authored text. Zero means nothing survived quote-stripping. */
  words: number;
  draft_references: number;
  rfc_references: number;
  section_references: number;
  urls: number;
  registry_terms: number;
  code_blocks: number;
  normative_keywords: number;
  questions: number;
  contends: number;
  endorsement_openers: number;
  /**
   * Distinct *kinds* of checkable referent present (0..5): drafts, RFCs,
   * sections, URLs, code. A count of kinds rather than of hits, because one
   * message repeating the same draft name eight times is not eight times as
   * concrete — and a single number of hits would let one verbose citation
   * outrank a message that names a draft, a section and a failure mode.
   */
  referent_kinds: number;
  /**
   * Referents per hundred words. Length-invariant, for the same reason novelty
   * had to become a fraction: an absolute count measures how much someone
   * wrote at least as much as what they said.
   */
  referent_density: number;
  /**
   * True when the message offers nothing checkable, contests nothing, and asks
   * nothing — while still being long enough that the absence is meaningful.
   *
   * Deliberately a conjunction of three independent conditions and a length
   * floor, not a score. Each can be disagreed with on its own, and a short
   * "yes, that works" is excluded because a brief acknowledgement is a normal
   * and useful thing to send.
   */
  offers_nothing_checkable: boolean;
}

/** Words below which a message is an acknowledgement, not a contribution. */
export const ACKNOWLEDGEMENT_WORDS = 40;

/**
 * Measure one message's authored text.
 *
 * `text` must already be the authored portion — see `newText()` in
 * `src/ingest/parse.ts`. Passing a full body would count the quoted parent's
 * citations as this message's own.
 */
export function concreteness(text: string): Concreteness {
  const words = text.split(/\s+/).filter(Boolean).length;
  const drafts = count(text, DRAFT);
  const rfcs = count(text, RFC);
  const sections = count(text, SECTION);
  const urls = count(text, URL);
  const code = count(text, CODE_FENCE) + count(text, ABNF) + count(text, JSONISH);
  const questions = count(text, QUESTION);
  const contends = count(text, CONTENDS);

  const kinds = [drafts, rfcs, sections, urls, code].filter((n) => n > 0).length;
  const hits = drafts + rfcs + sections + urls + code;

  return {
    words,
    draft_references: drafts,
    rfc_references: rfcs,
    section_references: sections,
    urls,
    registry_terms: count(text, REGISTRY),
    code_blocks: code,
    normative_keywords: count(text, NORMATIVE),
    questions,
    contends,
    endorsement_openers: count(text, ENDORSEMENT),
    referent_kinds: kinds,
    referent_density: words ? Number(((hits * 100) / words).toFixed(3)) : 0,
    offers_nothing_checkable:
      words >= ACKNOWLEDGEMENT_WORDS && kinds === 0 && contends === 0 && questions === 0,
  };
}
