import { describe, expect, test } from "bun:test";
import {
  bandOf, contributorScore, MIDPOINT, POINTS, type RecordInput,
} from "../src/score/contributor.ts";

const EMPTY: RecordInput = {
  rfc_authorships: 0,
  wg_document_authorships: [],
  chair_roles: [],
  ad_roles: [],
  iab_iesg_roles: [],
};
const of = (p: Partial<RecordInput>) => contributorScore({ ...EMPTY, ...p });

describe("Laocoön contributor score", () => {
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
    expect(both.raw).toBe(POINTS.chair_current);
  });

  test("the curve is an S: steepest in the middle, flat at both ends", () => {
    const at = (rfcs: number) => of({ rfc_authorships: rfcs }).score;
    const lowSlope = at(2) - at(1);
    const midSlope = at(MIDPOINT + 1) - at(MIDPOINT);
    const highSlope = at(40) - at(39);
    expect(midSlope).toBeGreaterThan(lowSlope);
    expect(midSlope).toBeGreaterThan(highSlope);
    expect(highSlope).toBeLessThanOrEqual(1);
  });

  test("an empty record is zero, not the curve's floor", () => {
    // Unanchored, a logistic puts nothing-published at about 12, and "has
    // filed nothing" would read as a low grade rather than as an absence.
    expect(of({}).score).toBe(0);
    expect(of({ rfc_authorships: 1 }).score).toBeGreaterThan(0);
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

  test("bands are ordered and cover the whole range", () => {
    expect(bandOf(0)).toBe("none");
    expect(bandOf(1)).toBe("some");
    expect(bandOf(34)).toBe("some");
    expect(bandOf(35)).toBe("established");
    expect(bandOf(69)).toBe("established");
    expect(bandOf(70)).toBe("extensive");
    expect(bandOf(100)).toBe("extensive");
  });

  test("a sitting IETF chair outranks a prolific working-group author", () => {
    // The case that motivated the tiered roles: a former Area Director and
    // current IETF Chair with four RFCs should not sit below a working-group
    // author with more adopted drafts. The chair's seat on the IESG outweighs
    // the extra bibliography.
    const chair = of({
      rfc_authorships: 4,
      wg_document_authorships: Array.from({ length: 5 }, (_, i) => `draft-ietf-x-${i}-00`),
      chair_roles: [{ current: true, group_type: "wg" }],
      iab_iesg_roles: [{ role: "chair", current: true }],
    });
    const author = of({
      rfc_authorships: 4,
      wg_document_authorships: Array.from({ length: 10 }, (_, i) => `draft-ietf-y-${i}-00`),
      chair_roles: [{ current: true, group_type: "wg" }],
      iab_iesg_roles: [{ role: "ad", current: false }],
    });
    expect(chair.body_role).toBe("ietf_or_iab_chair");
    expect(author.body_role).toBe("past_body");
    expect(chair.score).toBeGreaterThan(author.score);
  });

  test("IESG and IAB seats are tiered, current above past", () => {
    const raw = (facts: { role?: string; current?: boolean }[]) =>
      of({ iab_iesg_roles: facts }).raw;
    expect(raw([{ role: "chair", current: true }])).toBeGreaterThan(
      raw([{ role: "ad", current: true }]),
    );
    expect(raw([{ role: "ad", current: true }])).toBeGreaterThan(
      raw([{ role: "member", current: true }]),
    );
    expect(raw([{ role: "ad", current: true }])).toBeGreaterThan(
      raw([{ role: "ad", current: false }]),
    );
  });

  test("one seat is one seat: the highest role, not the sum", () => {
    // A person who is IESG chair and also an AD and an IAB member holds one
    // standing, scored at the apex, not chair-plus-ad-plus-member.
    const stacked = of({
      iab_iesg_roles: [
        { role: "chair", current: true },
        { role: "ad", current: true },
        { role: "member", current: true },
      ],
    });
    expect(stacked.raw).toBe(POINTS.body_chair_current);
  });

  test("adopted drafts taper, so a long bibliography cannot outrun the apex seat", () => {
    const manyDrafts = of({
      wg_document_authorships: Array.from({ length: 20 }, (_, i) => `draft-ietf-x-${i}-00`),
    });
    const chair = of({ iab_iesg_roles: [{ role: "chair", current: true }] });
    // Untapered, twenty adopted drafts would be twenty raw units and swamp any
    // role; tapered, they do not exceed a sitting IETF/IAB chair.
    expect(manyDrafts.adopted_drafts).toBe(20);
    expect(manyDrafts.raw).toBeLessThan(20);
    expect(chair.score).toBeGreaterThanOrEqual(manyDrafts.score);
  });

  test("nothing here reports on how a message was written", () => {
    const keys = Object.keys(of({ rfc_authorships: 3 }));
    for (const key of keys) {
      expect(key).not.toMatch(/\b(ai|llm|generated|synthetic|bot|quality|slop)\b/i);
    }
  });
});

import { utilityOf, UTILITY_META } from "../src/score/utility.ts";

describe("Laocoön utility score", () => {
  const thread = (p: Partial<Parameters<typeof utilityOf>[0]>) =>
    utilityOf({ messages: 8, participants: 5, top_two_share: 0.5, best_contributor: 60, ...p });

  test("a sustained exchange between several people, with a record present, is high", () => {
    expect(thread({}).utility).toBe("high");
  });

  test("a long thread two accounts carried is low", () => {
    expect(thread({ participants: 2, top_two_share: 1 }).utility).toBe("low");
  });

  test("two experts hammering a detail score the same as two amplifying accounts", () => {
    // The measure is of the shape, and the shape is identical. A low is a
    // prompt to read the thread, never a claim about who wrote it.
    const experts = thread({ participants: 2, top_two_share: 1, best_contributor: 100 });
    const unknowns = thread({ participants: 2, top_two_share: 1, best_contributor: 0 });
    expect(experts.utility).toBe(unknowns.utility);
  });

  test("a short exchange between two accounts with no record is low", () => {
    expect(thread({ messages: 2, participants: 2, best_contributor: 0 }).utility).toBe("low");
  });

  test("a short exchange involving someone with a record is not low", () => {
    expect(thread({ messages: 2, participants: 2, best_contributor: 80 }).utility).toBe("medium");
  });

  test("every condition is reported beside the level", () => {
    const v = thread({ participants: 2, top_two_share: 1 });
    expect(Object.keys(v.conditions).sort()).toEqual([
      "broad", "concentrated", "contributor_engaged", "spread", "substantial",
    ]);
    expect(v.reason.length).toBeGreaterThan(10);
  });

  test("only three levels exist", () => {
    expect(Object.keys(UTILITY_META).sort()).toEqual(["high", "low", "medium"]);
  });
});
