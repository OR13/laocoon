import { describe, expect, test } from "bun:test";
import type { DatatrackerRecordFetched, RoleFact } from "../src/schema/generated.ts";
import { applySeedRule, isAdoptedWorkingGroupDocument } from "../src/seed/rule.ts";

function record(overrides: Partial<DatatrackerRecordFetched> = {}): DatatrackerRecordFetched {
  return {
    person_id: 1,
    fetched_at: "2026-08-15T00:00:00.000Z",
    chair_roles: [],
    ad_roles: [],
    iab_iesg_roles: [],
    rfc_authorships: 0,
    wg_document_authorships: [],
    endpoints: [],
    ...overrides,
  };
}

const role = (o: Partial<RoleFact> = {}): RoleFact => ({
  role: "chair",
  group_ref: "/api/v1/group/group/1/",
  group_type: "wg",
  current: true,
  ...o,
});

describe("applySeedRule", () => {
  test("a person with no community-conferred standing is not seeded", () => {
    expect(applySeedRule(record())).toEqual({ seeded: false, clauses: [] });
  });

  test("a sitting working group chair is seeded", () => {
    const verdict = applySeedRule(record({ chair_roles: [role({ current: true })] }));
    expect(verdict.seeded).toBe(true);
    expect(verdict.clauses).toEqual(["wg_chair_current"]);
  });

  test("a past working group chair is seeded", () => {
    expect(applySeedRule(record({ chair_roles: [role({ current: false })] })).clauses).toEqual([
      "wg_chair_past",
    ]);
  });

  test("chairing something that is not a working group does not seed", () => {
    // PROBLEM.md section 4 names working group chairs. A research group chair,
    // or any other group type, is outside the rule as written.
    const verdict = applySeedRule(record({ chair_roles: [role({ group_type: "rg" })] }));
    expect(verdict).toEqual({ seeded: false, clauses: [] });
  });

  test("an area director is seeded", () => {
    expect(
      applySeedRule(record({ ad_roles: [role({ role: "ad", group_type: "" })] })).clauses,
    ).toEqual(["area_director"]);
  });

  test("an IAB or IESG role is seeded", () => {
    expect(
      applySeedRule(record({ iab_iesg_roles: [role({ group_type: "iab_or_iesg" })] })).clauses,
    ).toEqual(["iab_or_iesg"]);
  });

  test("an RFC author is seeded", () => {
    expect(applySeedRule(record({ rfc_authorships: 1 })).clauses).toEqual(["rfc_author"]);
  });

  test("an author of an adopted working group document is seeded", () => {
    expect(
      applySeedRule(record({ wg_document_authorships: ["draft-ietf-oauth-something"] })).clauses,
    ).toEqual(["adopted_wg_document_author"]);
  });

  test("an individual submission does NOT seed — that standing is self-conferred", () => {
    // The whole defensibility of the seed rests on this one. Anyone can post a
    // draft-<name>-* document; nobody can appoint themselves a chair.
    const verdict = applySeedRule(
      record({ wg_document_authorships: ["draft-someone-a-proposal", "draft-someone-another"] }),
    );
    expect(verdict).toEqual({ seeded: false, clauses: [] });
  });

  test("every matching clause is reported, not just the first", () => {
    const verdict = applySeedRule(
      record({
        chair_roles: [role({ current: true }), role({ current: false })],
        rfc_authorships: 3,
        wg_document_authorships: ["draft-ietf-x-y"],
      }),
    );
    expect(verdict.clauses).toEqual([
      "wg_chair_current",
      "wg_chair_past",
      "rfc_author",
      "adopted_wg_document_author",
    ]);
  });
});

describe("isAdoptedWorkingGroupDocument", () => {
  test("adopted documents carry the ietf stream in their name", () => {
    expect(isAdoptedWorkingGroupDocument("draft-ietf-wimse-arch")).toBe(true);
  });

  test("individual submissions do not", () => {
    expect(isAdoptedWorkingGroupDocument("draft-steele-something")).toBe(false);
    expect(isAdoptedWorkingGroupDocument("draft-irtf-cfrg-thing")).toBe(false);
  });
});
