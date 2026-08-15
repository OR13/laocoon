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
 *    single pair of messages, so the earlier messages are in the prompt and
 *    `responds_to_a_specific_point` has to quote from them.
 * 3. **Observable properties, not quality.** Every question asks what the text
 *    *does*, not how good it is. "Does it name something specific" has an
 *    answer a second reader would agree with; "is this a good contribution"
 *    does not.
 * 4. **Reasons are quoted, not summarised.** Each true flag must point at the
 *    span that made it true, so a verdict can be checked against the message
 *    rather than taken on trust.
 *
 * **Version 3.0.0 asks four things, not six.** Two of the original six —
 * `restates_without_adding` and `interchangeable` — fired on zero messages out
 * of 43, twice, under two phrasings, on both lists. They are the two whose
 * "true" is unflattering, and no rewording got the model to report them.
 *
 * They are now computed instead, in `distinctiveness.ts`, as the difference
 * between a message's similarity to its own thread and to the rest of the
 * list. That measure says 17.1% of agent2agent messages sit no closer to their
 * own thread than to any other, against 8.6% on agentproto — a real
 * distribution, and a real difference between the lists, for the property the
 * model scored at zero. **Do not add them back to this prompt.**
 *
 * **Version 2.0.0 failed its own probe, and 2.1.0 was the first response.** On 39
 * agentproto replies three of the six flags were degenerate:
 * `responds_to_a_specific_point` fired on every message, and
 * `restates_without_adding` and `interchangeable` fired on none — the two
 * flags whose "true" is unflattering. Asked a yes/no question about whether a
 * message is filler, the model gives the charitable answer, which is the same
 * failure that made substantive/hollow useless.
 *
 * Demanding evidence rather than a verdict fixed one of the three:
 * `responds_to_a_specific_point` went from 1.000 to 0.814 once it had to quote
 * the words the reply takes up, because a model that cannot find the quote has
 * answered the question. It did nothing for the other two, where the evidence
 * had to be read backwards — asked to name what a reply could not be separated
 * from, a model will always find some noun in the thread. That asymmetry is
 * why the remaining four are all positively phrased.
 *
 * That probe was also run against the wrong corpus. `artifacts/reply-graph.json`
 * covered agentproto alone — which is why the old classifier's 164 verdicts are
 * 82 replies times two models, and why neither has ever seen the 1,233-message
 * list the operator is actually worried about.
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

export const VALUE_PROMPT_VERSION = "3.0.0";

export const VALUE_PROMPT = `You are reading one reply on an IETF technical standards mailing list, in the context of the thread it belongs to.

Report observable properties of the REPLY. Do not rate its quality, and do not speculate about who or what wrote it — not the author's identity, not their experience, not whether any tool was involved in producing it. Authorship is not observable from the text and is not being asked about. Judge the text only.

Answer each of these independently. Several may be true; all may be false.

For each one, find the evidence before you answer. Where a property asks you to quote or name something, the answer is false when you cannot find it — do not give the benefit of the doubt, and do not answer from the general impression the message leaves.

1. names_something_specific — does the reply identify a particular artifact, mechanism, message, error case or scenario, as opposed to a category or a topic area? "the token binding in section 4.2" and "what happens when the intermediary retries" are specific. "security considerations", "interoperability concerns", "the ecosystem" are not.

2. makes_a_checkable_claim — does the reply assert something that could turn out to be wrong? A statement about how a protocol behaves, what a document says, or what would happen in a case. Opinions about direction, importance or priorities are not checkable claims.

3. responds_to_a_specific_point — quote the exact words FROM THE THREAD OR PARENT that this reply takes up and addresses. Not the subject line, not the general topic: a particular thing somebody said. If you cannot find one, the answer is false.

4. proposes_an_action — does the reply say what should be done next: text to change, a question to resolve, an experiment to run, a decision to make?

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

Respond with JSON only, no other text. In "quote", put the evidence the property asked you for, at most 12 words; use null where the property is false.
{"names_something_specific": {"value": true|false, "quote": "<...>"|null},
 "makes_a_checkable_claim": {"value": true|false, "quote": "<...>"|null},
 "responds_to_a_specific_point": {"value": true|false, "quote": "<...>"|null},
 "proposes_an_action": {"value": true|false, "quote": "<...>"|null}}`;

export const VALUE_PROMPT_HASH = sha256(VALUE_PROMPT);

/** The six flags, in the order the prompt asks for them. */
export const VALUE_PROPERTIES = [
  "names_something_specific",
  "makes_a_checkable_claim",
  "responds_to_a_specific_point",
  "proposes_an_action",
] as const;

export type ValueProperty = (typeof VALUE_PROPERTIES)[number];

export interface ValueVerdict {
  properties: Record<ValueProperty, { value: boolean; quote: string | null }>;
}

/** Characters of the reply and parent shown to the model. */
export const MAX_EXCERPT_CHARS = 4000;
/** Characters of earlier-thread context, for the quote-from-the-thread flag. */
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
