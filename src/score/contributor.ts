/**
 * The Laocoön contributor score: 0-100 from a person's published IETF record.
 *
 * **What it is not.** Not a rating of anyone's messages, their judgement, or
 * their worth to a discussion. Every input is a count of something already
 * published under that person's name in the Datatracker. A score of zero means
 * no published IETF record, which is the ordinary state of a new participant
 * and of anyone who contributes without filing documents. Nothing in the
 * pipeline treats a low score as a reason to discount a message.
 *
 * **The curve is a logistic, at the operator's direction.** A linear or
 * saturating sum spends most of its range on the difference between a very
 * prolific author and an extremely prolific one, which is the least
 * interesting comparison on the list. An S-curve spends it in the middle,
 * where the difference between someone with two documents and someone with
 * fifteen actually distinguishes people:
 *
 *     raw    weighted count of published work and roles
 *     score  100 · (L(raw) − L(0)) / (1 − L(0)),  L(x) = 1 / (1 + e^(−k(x−m)))
 *
 * The `− L(0)` term anchors the curve: without it an empty record scores
 * around 12 rather than 0, and "has published nothing" would read as a low
 * grade rather than as an absence.
 */

/**
 * Weighted units of published work and service. Each is a count or a role, and
 * each weight is arguable.
 *
 * **Institutional service is tiered and graduated.** The earlier version scored
 * every IESG or IAB role as one flat unit, so a sitting IETF Chair who was an
 * Area Director for years counted the same as a one-term IAB member, and a
 * single working-group chair outscored both. That inverts the responsibility:
 * the IESG and IAB sit above a working group, so their seats weigh more, and a
 * current seat weighs more than a past one. The role is read from the
 * datatracker's own `role` name in the group-scoped IESG/IAB query, so this is
 * still a count of documented service, not a judgement of stature.
 */
export const POINTS = {
  /** Per published RFC. */
  rfc: 1,
  /** Per document a working group adopted — `draft-ietf-*`, up to `DRAFT_FULL`. */
  adopted_draft: 1,
  /** Currently chairing a working group. */
  chair_current: 5,
  /** Has chaired one. Less, because it is a past responsibility. */
  chair_past: 2,
  /** Chair of the IESG (IETF Chair) or the IAB. The apex documented role. */
  body_chair_current: 12,
  body_chair_past: 5,
  /** Area Director: a seat on the IESG. */
  area_director_current: 8,
  area_director_past: 3,
  /** A member of the IESG or IAB in any other role. */
  body_member_current: 5,
  body_member_past: 2,
} as const;

/** Where the curve is steepest, in weighted units. */
export const MIDPOINT = 8;
/** How sharply it turns. Lower is gentler. */
export const STEEPNESS = 0.22;
/** Adopted drafts up to here count in full. */
export const DRAFT_FULL = 6;
/** Each adopted draft beyond `DRAFT_FULL` counts at this fraction, so a long
 *  bibliography cannot outrun institutional service. */
export const DRAFT_TAPER = 0.4;

/** One role, as the resolver records it: a role name and whether it is held now. */
export interface RoleFact {
  role?: string;
  current?: boolean;
}

export interface RecordInput {
  rfc_authorships: number;
  wg_document_authorships: string[];
  chair_roles: { current: boolean; group_type: string }[];
  /** IESG/IAB roles, already narrowed to those bodies by the resolver. */
  iab_iesg_roles: RoleFact[];
  /** `name=ad` roles across all groups; noisy, kept for the record, not scored. */
  ad_roles: RoleFact[];
}

/** The single highest IESG/IAB role a person holds or held, as a label. */
export type BodyRole =
  | "ietf_or_iab_chair"
  | "area_director"
  | "body_member"
  | "past_body"
  | null;

export interface ContributorScore {
  /** 0-100. Zero is an absence of published work, not a low grade. */
  score: number;
  /** The weighted count the curve was applied to, so the shape can be checked. */
  raw: number;
  rfcs: number;
  adopted_drafts: number;
  chairs_now: boolean;
  chaired_before: boolean;
  /** Highest IESG/IAB seat held, or null. Supersedes the old `area_or_body`. */
  body_role: BodyRole;
  /** Kept for callers that only asked "any IESG/IAB service at all". */
  area_or_body: boolean;
}

const logistic = (x: number) => 1 / (1 + Math.exp(-STEEPNESS * (x - MIDPOINT)));

/** The highest IESG/IAB seat, current outranking past, chair outranking the rest. */
function highestBodyRole(facts: RoleFact[]): { role: BodyRole; points: number } {
  const has = (role: string, current: boolean) =>
    facts.some((f) => (f.current ?? false) === current && f.role === role);
  if (has("chair", true)) return { role: "ietf_or_iab_chair", points: POINTS.body_chair_current };
  if (has("ad", true)) return { role: "area_director", points: POINTS.area_director_current };
  if (has("member", true)) return { role: "body_member", points: POINTS.body_member_current };
  if (has("chair", false)) return { role: "past_body", points: POINTS.body_chair_past };
  if (has("ad", false)) return { role: "past_body", points: POINTS.area_director_past };
  if (has("member", false)) return { role: "past_body", points: POINTS.body_member_past };
  // A body fact with no recognised role name still evidences service.
  if (facts.length > 0) return { role: "past_body", points: POINTS.body_member_past };
  return { role: null, points: 0 };
}

export function contributorScore(record: RecordInput): ContributorScore {
  const rfcs = Math.max(0, record.rfc_authorships);
  const adopted = record.wg_document_authorships.filter((d) =>
    d.startsWith("draft-ietf-"),
  ).length;
  const chairsNow = record.chair_roles.some((r) => r.current && r.group_type === "wg");
  const chairedBefore = record.chair_roles.some((r) => !r.current && r.group_type === "wg");

  // Chairing a working group counts once at its highest level: a current chair
  // who also chaired before holds one responsibility, not two.
  const chairPoints = chairsNow
    ? POINTS.chair_current
    : chairedBefore
      ? POINTS.chair_past
      : 0;

  // One IESG/IAB seat is one seat: score the highest role held, not the sum.
  const body = highestBodyRole(record.iab_iesg_roles);

  // Adopted drafts taper past the point where more of them stops meaning more
  // service, so a long bibliography cannot outweigh a seat on the IESG.
  const adoptedPoints =
    adopted <= DRAFT_FULL
      ? adopted * POINTS.adopted_draft
      : DRAFT_FULL * POINTS.adopted_draft +
        (adopted - DRAFT_FULL) * POINTS.adopted_draft * DRAFT_TAPER;

  const raw = rfcs * POINTS.rfc + adoptedPoints + chairPoints + body.points;

  const floor = logistic(0);
  const score = raw <= 0 ? 0 : Math.round((100 * (logistic(raw) - floor)) / (1 - floor));

  return {
    score: Math.max(0, Math.min(100, score)),
    raw,
    rfcs,
    adopted_drafts: adopted,
    chairs_now: chairsNow,
    chaired_before: chairedBefore,
    body_role: body.role,
    area_or_body: body.role !== null,
  };
}

/**
 * Bands, for colouring and for grouping a trend.
 *
 * Named for a quantity of published work, never for a kind of person. Round
 * numbers on the scale rather than quantiles of this corpus: derived from the
 * crawl, the boundaries would move every time it grew.
 */
export const BANDS = [
  { min: 70, id: "extensive", label: "Extensive record" },
  { min: 35, id: "established", label: "Established record" },
  { min: 1, id: "some", label: "Some published work" },
  { min: 0, id: "none", label: "No published record" },
] as const;

export type BandId = (typeof BANDS)[number]["id"];

export function bandOf(score: number): BandId {
  return (BANDS.find((b) => score >= b.min) ?? BANDS[BANDS.length - 1]!).id;
}
