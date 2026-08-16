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

/** Weighted units of published work. Each is a count, and each is arguable. */
export const POINTS = {
  /** Per published RFC. */
  rfc: 1,
  /** Per document a working group adopted — `draft-ietf-*`. */
  adopted_draft: 1,
  /** Currently chairing a working group. */
  chair_current: 5,
  /** Has chaired one. Less, because it is a past responsibility. */
  chair_past: 2,
  /** Area Director, or any IAB or IESG role. */
  area_or_body: 4,
} as const;

/** Where the curve is steepest, in weighted units. */
export const MIDPOINT = 8;
/** How sharply it turns. Lower is gentler. */
export const STEEPNESS = 0.22;

export interface RecordInput {
  rfc_authorships: number;
  wg_document_authorships: string[];
  chair_roles: { current: boolean; group_type: string }[];
  ad_roles: unknown[];
  iab_iesg_roles: unknown[];
}

export interface ContributorScore {
  /** 0-100. Zero is an absence of published work, not a low grade. */
  score: number;
  /** The weighted count the curve was applied to, so the shape can be checked. */
  raw: number;
  rfcs: number;
  adopted_drafts: number;
  chairs_now: boolean;
  chaired_before: boolean;
  area_or_body: boolean;
}

const logistic = (x: number) => 1 / (1 + Math.exp(-STEEPNESS * (x - MIDPOINT)));

export function contributorScore(record: RecordInput): ContributorScore {
  const rfcs = Math.max(0, record.rfc_authorships);
  const adopted = record.wg_document_authorships.filter((d) =>
    d.startsWith("draft-ietf-"),
  ).length;
  const chairsNow = record.chair_roles.some((r) => r.current && r.group_type === "wg");
  const chairedBefore = record.chair_roles.some((r) => !r.current && r.group_type === "wg");
  const areaOrBody = record.ad_roles.length > 0 || record.iab_iesg_roles.length > 0;

  // Chairing counts once at its highest level: a current chair who also
  // chaired before holds one responsibility, not two.
  const chairPoints = chairsNow
    ? POINTS.chair_current
    : chairedBefore
      ? POINTS.chair_past
      : 0;
  const raw =
    rfcs * POINTS.rfc +
    adopted * POINTS.adopted_draft +
    chairPoints +
    (areaOrBody ? POINTS.area_or_body : 0);

  const floor = logistic(0);
  const score = raw <= 0 ? 0 : Math.round((100 * (logistic(raw) - floor)) / (1 - floor));

  return {
    score: Math.max(0, Math.min(100, score)),
    raw,
    rfcs,
    adopted_drafts: adopted,
    chairs_now: chairsNow,
    chaired_before: chairedBefore,
    area_or_body: areaOrBody,
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
