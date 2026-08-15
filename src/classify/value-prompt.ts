/**
 * The contribution prompt: what a reply offers the discussion it is in.
 *
 * **This replaces the substantive/hollow prompt, which had no discriminating
 * power.** Over 164 replies it returned `substantive` 162 times, `hollow` once
 * and `unclear` once. A binary that never says one of its two words is not
 * measuring anything, and the cause was the question: "does this engage with
 * the parent" is answerable with yes for almost any on-topic reply.
 *
 * Four changes follow from that failure.
 *
 * 1. **Independent properties, not one verdict.** Six booleans, each of which
 *    can be false on its own. A message that names something specific but
 *    proposes nothing is a different thing from one that does neither, and a
 *    single label cannot say so. It also means the *distribution* of each flag
 *    is checkable after a run — if one is always true, that one is broken, and
 *    it fails alone rather than taking the measure down with it.
 * 2. **The thread, not just the parent.** The property the operator describes —
 *    an exchange that circles without going anywhere — is invisible from a
 *    single pair of messages. `interchangeable` asks whether the reply could be
 *    moved to a different thread on this list without looking out of place,
 *    which is a question about the reply's relationship to its context and is
 *    the sharpest available handle on generic filler.
 * 3. **Observable properties, not quality.** Every question asks what the text
 *    *does*, not how good it is. "Does it name something specific" has an
 *    answer a second reader would agree with; "is this a good contribution"
 *    does not.
 * 4. **Reasons are quoted, not summarised.** Each true flag must point at the
 *    span that made it true, so a verdict can be checked against the message
 *    rather than taken on trust.
 *
 * **Nothing here concerns provenance, and the prompt says so.** Not whether a
 * message was written by a model, not whether it "reads as generated", not a
 * confidence about authorship. A model asked about contribution will otherwise
 * volunteer a guess about who wrote it, and that guess would then be in the
 * log for all time. A person writing interchangeable filler and a program
 * writing it score identically, which is correct: the measure is of what the
 * message gives the discussion.
 */
import { sha256 } from "../lib/hash.ts";

export const VALUE_PROMPT_VERSION = "2.0.0";

export const VALUE_PROMPT = `You are reading one reply on an IETF technical standards mailing list, in the context of the thread it belongs to.

Report observable properties of the REPLY. Do not rate its quality, and do not speculate about who or what wrote it — not the author's identity, not their experience, not whether any tool was involved in producing it. Authorship is not observable from the text and is not being asked about. Judge the text only.

Answer each of these independently. Several may be true; all may be false.

1. names_something_specific — does the reply identify a particular artifact, mechanism, message, error case or scenario, as opposed to a category or a topic area? "the token binding in section 4.2" and "what happens when the intermediary retries" are specific. "security considerations", "interoperability concerns", "the ecosystem" are not.

2. makes_a_checkable_claim — does the reply assert something that could turn out to be wrong? A statement about how a protocol behaves, what a document says, or what would happen in a case. Opinions about direction, importance or priorities are not checkable claims.

3. responds_to_a_specific_point — does the reply take up a particular thing said in the thread and address it, rather than replying to the thread's general subject?

4. proposes_an_action — does the reply say what should be done next: text to change, a question to resolve, an experiment to run, a decision to make?

5. restates_without_adding — is the substance of the reply already present in the thread, restated in different words?

6. interchangeable — could this reply be moved into a different thread on this list, on a different subject, without looking out of place? Judge the reply's own text: if it would still read as a sensible contribution somewhere else, it is interchangeable. A reply that only makes sense here is not.

THREAD SUBJECT: {{subject}}

WHAT THE THREAD HAS ALREADY SAID (earlier messages, oldest first):
"""
{{context}}
"""

THE MESSAGE BEING REPLIED TO:
"""
{{parent}}
"""

THE REPLY TO REPORT ON:
"""
{{reply}}
"""

Respond with JSON only, no other text. For each property that is true, quote at most 10 words from the reply that make it true; use null when it is false.
{"names_something_specific": {"value": true|false, "quote": "<...>"|null},
 "makes_a_checkable_claim": {"value": true|false, "quote": "<...>"|null},
 "responds_to_a_specific_point": {"value": true|false, "quote": "<...>"|null},
 "proposes_an_action": {"value": true|false, "quote": "<...>"|null},
 "restates_without_adding": {"value": true|false, "quote": "<...>"|null},
 "interchangeable": {"value": true|false, "quote": "<...>"|null}}`;

export const VALUE_PROMPT_HASH = sha256(VALUE_PROMPT);

/** The six flags, in the order the prompt asks for them. */
export const VALUE_PROPERTIES = [
  "names_something_specific",
  "makes_a_checkable_claim",
  "responds_to_a_specific_point",
  "proposes_an_action",
  "restates_without_adding",
  "interchangeable",
] as const;

export type ValueProperty = (typeof VALUE_PROPERTIES)[number];

export interface ValueVerdict {
  properties: Record<ValueProperty, { value: boolean; quote: string | null }>;
}

/** Characters of the reply and parent shown to the model. */
export const MAX_EXCERPT_CHARS = 4000;
/** Characters of earlier-thread context. Enough to judge `interchangeable`. */
export const MAX_CONTEXT_CHARS = 3000;

export function excerpt(body: string, max = MAX_EXCERPT_CHARS): string {
  const trimmed = body.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}\n[... truncated ...]`;
}

export function renderValuePrompt(input: {
  subject: string;
  /** Earlier messages in the thread, oldest first. Authored text only. */
  context: string[];
  parent: string;
  reply: string;
}): string {
  // Context is trimmed from the *front*: the messages nearest the reply are
  // the ones it is most likely to be restating.
  const joined = input.context.join("\n---\n");
  const context =
    joined.length <= MAX_CONTEXT_CHARS
      ? joined
      : `[... earlier messages truncated ...]\n${joined.slice(-MAX_CONTEXT_CHARS)}`;
  return VALUE_PROMPT.replace("{{subject}}", input.subject.slice(0, 200))
    .replace("{{context}}", context || "(this is the first reply in the thread)")
    .replace("{{parent}}", excerpt(input.parent))
    .replace("{{reply}}", excerpt(input.reply));
}

/**
 * Parse a model response into the six flags.
 *
 * Returns null rather than guessing when the shape is wrong: a missing flag is
 * a failed classification, and coercing it to `false` would quietly bias every
 * distribution towards absence.
 */
export function parseValueVerdict(text: string): ValueVerdict | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const properties = {} as ValueVerdict["properties"];
  for (const key of VALUE_PROPERTIES) {
    const entry = record[key];
    if (typeof entry === "boolean") {
      // Tolerated: some responses drop the wrapper object and give the bare
      // boolean. The flag is what matters; the quote is corroboration.
      properties[key] = { value: entry, quote: null };
      continue;
    }
    if (typeof entry !== "object" || entry === null) return null;
    const value = (entry as { value?: unknown }).value;
    if (typeof value !== "boolean") return null;
    const quote = (entry as { quote?: unknown }).quote;
    properties[key] = { value, quote: typeof quote === "string" ? quote : null };
  }
  return { properties };
}
