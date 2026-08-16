import { describe, expect, test } from "bun:test";
import {
  bandOf, recordScore, RFC_SATURATION, WEIGHTS, type RecordInput,
} from "../src/seed/record-score.ts";

const EMPTY: RecordInput = {
  rfc_authorships: 0,
  wg_document_authorships: [],
  chair_roles: [],
  ad_roles: [],
  iab_iesg_roles: [],
};
const of = (p: Partial<RecordInput>) => recordScore({ ...EMPTY, ...p });

describe("record score", () => {
  test("no published record scores zero, and that is a normal state", () => {
    const r = of({});
    expect(r.score).toBe(0);
    expect(bandOf(r.score)).toBe("none");
  });

  test("one RFC lifts a person out of the zero band", () => {
    // The point of a continuous score over the binary it replaced: a newcomer
    // with one RFC is no longer in the same bucket as an account with none.
    expect(of({ rfc_authorships: 1 }).score).toBeGreaterThan(0);
    expect(bandOf(of({ rfc_authorships: 1 }).score)).toBe("some");
  });

  test("the RFC term saturates, so a long tail does not flatten everyone", () => {
    const at = of({ rfc_authorships: RFC_SATURATION }).parts.rfcs;
    const far = of({ rfc_authorships: 83 }).parts.rfcs;
    expect(at).toBe(WEIGHTS.rfcs);
    expect(far).toBe(WEIGHTS.rfcs);
    // The first few RFCs are worth much more than the sixtieth.
    expect(of({ rfc_authorships: 3 }).parts.rfcs).toBeGreaterThan(
      (of({ rfc_authorships: 83 }).parts.rfcs - of({ rfc_authorships: 25 }).parts.rfcs) * 3,
    );
  });

  test("only adopted working-group drafts count", () => {
    const individual = of({ wg_document_authorships: ["draft-someone-a-thing-00"] });
    const adopted = of({ wg_document_authorships: ["draft-ietf-wg-a-thing-00"] });
    expect(individual.adopted_drafts).toBe(0);
    expect(individual.score).toBe(0);
    expect(adopted.adopted_drafts).toBe(1);
    expect(adopted.score).toBeGreaterThan(0);
  });

  test("chairing counts once at its highest level, not twice", () => {
    const both = of({
      chair_roles: [
        { current: true, group_type: "wg" },
        { current: false, group_type: "wg" },
      ],
    });
    expect(both.parts.role).toBe(WEIGHTS.chair_current);
  });

  test("a research group chair is not a working group chair", () => {
    expect(of({ chair_roles: [{ current: true, group_type: "rg" }] }).score).toBe(0);
  });

  test("the score never exceeds 100", () => {
    const everything = of({
      rfc_authorships: 500,
      wg_document_authorships: Array.from({ length: 40 }, (_, i) => `draft-ietf-x-${i}-00`),
      chair_roles: [{ current: true, group_type: "wg" }],
      ad_roles: [{}],
      iab_iesg_roles: [{}],
    });
    expect(everything.score).toBe(100);
  });

  test("parts sum to the score, so the total can be taken apart on screen", () => {
    const r = of({
      rfc_authorships: 12,
      wg_document_authorships: ["draft-ietf-a-b-00", "draft-ietf-c-d-00"],
      chair_roles: [{ current: false, group_type: "wg" }],
    });
    const sum = r.parts.rfcs + r.parts.adopted_drafts + r.parts.role;
    expect(Math.abs(sum - r.score)).toBeLessThanOrEqual(1);
  });

  test("bands are ordered and cover the whole range", () => {
    expect(bandOf(0)).toBe("none");
    expect(bandOf(1)).toBe("some");
    expect(bandOf(29)).toBe("some");
    expect(bandOf(30)).toBe("established");
    expect(bandOf(59)).toBe("established");
    expect(bandOf(60)).toBe("extensive");
    expect(bandOf(100)).toBe("extensive");
  });

  test("nothing here reports on how a message was written", () => {
    const keys = Object.keys(of({ rfc_authorships: 3 }));
    for (const key of keys) {
      expect(key).not.toMatch(/\b(ai|llm|generated|synthetic|bot|quality|slop)\b/i);
    }
  });
});
