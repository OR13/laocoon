/**
 * The community-conferred seed rule.
 *
 * This is the whole of it. It is a pure function of facts already recorded in
 * the private log, so changing the rule never requires re-crawling and never
 * rewrites history: re-run the projection and the seed changes.
 *
 * The rule is published in `docs/seed-rule.md`; the membership it produces is
 * not published, because membership is a label attached to an identifiable
 * person. Anyone can recompute the membership from the published rule and the
 * same public API, which is what makes it contestable without this repository
 * hosting a list of names.
 *
 * The load-bearing exclusion: **standing a participant conferred on themselves
 * does not seed.** Submitting an individual draft, having a datatracker record,
 * and the `origin` field of an address are all excluded. Every clause below
 * requires an action taken by the community — an appointment, or a working group
 * adopting a document.
 */
import type { DatatrackerRecordFetched } from "../schema/generated.ts";

/** Bump when a clause changes. Recorded on every artifact the seed feeds. */
export const SEED_RULE_VERSION = "1.0.0";

export type SeedClause =
  | "wg_chair_current"
  | "wg_chair_past"
  | "area_director"
  | "iab_or_iesg"
  | "rfc_author"
  | "adopted_wg_document_author";

export interface SeedVerdict {
  seeded: boolean;
  /** Every clause that matched, so a verdict can be explained clause by clause. */
  clauses: SeedClause[];
}

/** A document is adopted when a working group has taken it on: `draft-ietf-*`. */
export function isAdoptedWorkingGroupDocument(documentName: string): boolean {
  return documentName.startsWith("draft-ietf-");
}

export function applySeedRule(record: DatatrackerRecordFetched): SeedVerdict {
  const clauses: SeedClause[] = [];

  // A chair of a working group. Group type is `wg` by construction of the query
  // that found the role; research groups and other group types do not seed,
  // because PROBLEM.md section 4 names working group chairs specifically.
  if (record.chair_roles.some((r) => r.current && r.group_type === "wg")) {
    clauses.push("wg_chair_current");
  }
  if (record.chair_roles.some((r) => !r.current && r.group_type === "wg")) {
    clauses.push("wg_chair_past");
  }

  // Area director, current or past. The role name alone is sufficient.
  if (record.ad_roles.length > 0) clauses.push("area_director");

  // Any role in the IAB or the IESG.
  if (record.iab_iesg_roles.length > 0) clauses.push("iab_or_iesg");

  // Authorship the community acted on: a published RFC, or a document a working
  // group adopted. An individual submission — `draft-<name>-*` — is the author's
  // own act and is deliberately not here.
  if (record.rfc_authorships > 0) clauses.push("rfc_author");
  if (record.wg_document_authorships.some(isAdoptedWorkingGroupDocument)) {
    clauses.push("adopted_wg_document_author");
  }

  return { seeded: clauses.length > 0, clauses };
}
