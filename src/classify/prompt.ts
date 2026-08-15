/**
 * The substance prompt.
 *
 * It is in its own module, hashed, and versioned, because it is the most
 * consequential text in the project. Every classification records the hash, so a
 * series computed under two prompts is never silently compared.
 *
 * Two things this prompt deliberately does not ask, and must never be edited to
 * ask:
 *
 *   1. **Anything about provenance.** Not whether a message was written by a
 *      model, not whether it "sounds generated", not how confident the reader
 *      should be about its authorship. The prompt says so explicitly, because a
 *      model asked to judge engagement will otherwise volunteer a guess about
 *      authorship, and that guess would then be sitting in the log.
 *   2. **Anything about the author.** The judgement is a relation between two
 *      texts. Neither sender is named in the prompt, and neither is identified.
 */
import { sha256 } from "../lib/hash.ts";

export const PROMPT_VERSION = "1.0.0";

/** The template. `{{parent}}` and `{{reply}}` are the only substitutions. */
export const SUBSTANCE_PROMPT = `You are judging whether a reply on a technical standards mailing list engages with the message it is answering.

Judge only the relationship between the two texts below.

Do not speculate about who wrote either message, how it was produced, or whether any tool was involved. That is not what is being asked, it is not something the text can tell you, and any such judgement is invalid here. Judge engagement only.

Choose exactly one verdict:

- "substantive": the reply addresses something specific in the parent — it answers a question, agrees or disagrees with a stated claim, refines a proposal, supplies a concrete counter-example, or raises a consideration that bears directly on what the parent said.
- "hollow": the reply restates, endorses, or summarises the parent without addressing anything specific in it; or is purely procedural, social, or administrative.
- "unclear": the excerpt is too short, too damaged, or too fragmentary to judge.

Length is not the criterion. A short reply that answers the question is substantive; a long reply that restates the parent in different words is hollow.

PARENT MESSAGE:
"""
{{parent}}
"""

REPLY:
"""
{{reply}}
"""

Respond with JSON only, no other text:
{"verdict": "substantive" | "hollow" | "unclear", "reason": "<at most 12 words>"}`;

/** SHA-256 of the template itself, so all messages under one template share it. */
export const PROMPT_HASH = sha256(SUBSTANCE_PROMPT);

/** Characters of each message shown to the model. */
export const MAX_EXCERPT_CHARS = 6000;

export function renderPrompt(parentBody: string, replyBody: string): string {
  return SUBSTANCE_PROMPT.replace("{{parent}}", excerpt(parentBody)).replace(
    "{{reply}}",
    excerpt(replyBody),
  );
}

/**
 * Trim to the head of the message. The head is where a reply says what it is
 * responding to; trimming the tail loses signatures and trailing quotes first.
 */
export function excerpt(body: string, max = MAX_EXCERPT_CHARS): string {
  const trimmed = body.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max) + "\n[... truncated ...]";
}
