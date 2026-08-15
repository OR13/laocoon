import { describe, expect, test } from "bun:test";
import { concreteness, ACKNOWLEDGEMENT_WORDS } from "../src/classify/concreteness.ts";

/**
 * The cases that matter are the ones where concreteness and novelty disagree.
 * A message can be entirely new text and still point at nothing, which is the
 * blind spot that made novelty useless for this: it measures distance from
 * what the thread already said, so fluent filler scores high on it.
 */
const FILLER = `I think this is a really important area and I'm glad we're discussing it.
The considerations around agent interoperability are significant and touch on many
aspects of the ecosystem. There are tradeoffs to weigh carefully here, and the
community will need to think through the implications for existing deployments as
well as future ones. I'm looking forward to seeing how this develops over the
coming months and to contributing where I can be helpful to the effort.`;

const CONCRETE = `Section 4.2 of draft-ietf-agentproto-core-03 says the token MUST be bound to
the channel, but RFC 9110 allows an intermediary to re-establish it. That breaks
the binding. Have you considered requiring the hash instead?`;

describe("concreteness", () => {
  test("filler is long, wholly original, and points at nothing", () => {
    const c = concreteness(FILLER);
    expect(c.words).toBeGreaterThan(ACKNOWLEDGEMENT_WORDS);
    expect(c.referent_kinds).toBe(0);
    expect(c.referent_density).toBe(0);
    expect(c.questions).toBe(0);
    expect(c.contends).toBe(0);
    expect(c.offers_nothing_checkable).toBe(true);
  });

  test("a citation-dense reply scores on several independent kinds", () => {
    const c = concreteness(CONCRETE);
    expect(c.draft_references).toBe(1);
    expect(c.rfc_references).toBe(1);
    expect(c.section_references).toBe(1);
    expect(c.referent_kinds).toBe(3);
    expect(c.normative_keywords).toBeGreaterThan(0);
    expect(c.questions).toBe(1);
    expect(c.contends).toBeGreaterThan(0);
    expect(c.offers_nothing_checkable).toBe(false);
  });

  test("a short acknowledgement is not accused of offering nothing", () => {
    // Brief agreement is a normal, useful thing to send. The flag has a length
    // floor precisely so it does not fire on it.
    const c = concreteness("+1, agreed. That matches what we saw.");
    expect(c.words).toBeLessThan(ACKNOWLEDGEMENT_WORDS);
    expect(c.referent_kinds).toBe(0);
    expect(c.offers_nothing_checkable).toBe(false);
    expect(c.endorsement_openers).toBeGreaterThan(0);
  });

  test("asking a question is enough to not offer nothing", () => {
    const asked = `${FILLER}\n\nWhich of those two do you think we should prioritise?`;
    expect(concreteness(asked).offers_nothing_checkable).toBe(false);
  });

  test("disagreeing is enough to not offer nothing", () => {
    const argued = `${FILLER}\n\nI disagree with that framing.`;
    expect(concreteness(argued).contends).toBeGreaterThan(0);
    expect(concreteness(argued).offers_nothing_checkable).toBe(false);
  });

  test("density is length-invariant, so verbosity cannot inflate it", () => {
    const once = concreteness(CONCRETE).referent_density;
    const twice = concreteness(`${CONCRETE}\n\n${CONCRETE}`).referent_density;
    expect(Math.abs(once - twice)).toBeLessThan(0.5);
  });

  test("repeating one draft name does not count as many kinds", () => {
    const c = concreteness(
      "draft-ietf-agentproto-core-03 draft-ietf-agentproto-core-03 draft-ietf-agentproto-core-03",
    );
    expect(c.draft_references).toBe(3);
    expect(c.referent_kinds).toBe(1);
  });

  test("empty authored text is zero everywhere, never a division by zero", () => {
    const c = concreteness("");
    expect(c.words).toBe(0);
    expect(c.referent_density).toBe(0);
    expect(c.offers_nothing_checkable).toBe(false);
  });

  test("nothing here reports on the author or how the text was produced", () => {
    // A guard on the shape of the type: the moment a provenance-flavoured
    // field appears, this fails. PROBLEM.md section 2.
    const keys = Object.keys(concreteness(CONCRETE));
    for (const key of keys) {
      expect(key).not.toMatch(/\b(ai|llm|gpt|generated|synthetic|bot|human|author_is)\b/i);
    }
  });
});
