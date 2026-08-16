/**
 * Publication record score: what the IETF's own records say a person has done.
 *
 * **What this is not.** It is not a rating of anyone's messages, their
 * judgement, or their worth to a discussion. Every term is a count of
 * something already published under that person's name in the Datatracker.
 * A score of zero means "no published IETF record", which is the ordinary
 * state of a new participant and of anyone who contributes without filing
 * documents. Nothing in the pipeline treats a low score as a reason to
 * discount a message.
 *
 * **Why a score at all**, when PROBLEM.md section 7 refuses composites. The
 * measures section 7 protects are judgements this system forms about a
 * person's contributions — those are still refused, and still local. This is
 * a summary of a public record, requested by the operator to replace a binary
 * "holds standing / does not" that read as a caste mark. A continuous score
 * over published output is the fairer of the two: it says what someone has
 * filed rather than which side of a line they fall on, and a newcomer with one
 * RFC is no longer in the same bucket as an account with none.
 *
 * **The weights are constants, stated here, and each can be argued with on its
 * own.** They are fixed reference points rather than corpus percentiles: if
 * they were derived from this corpus the scale would shift every time the
 * crawl grew, and two runs would not be comparable. Saturating so that the
 * 83-RFC author and the 25-RFC author are close together — the difference
 * between 0 and 3 RFCs says far more than the difference between 60 and 83.
 */

/** RFC authorships at which the RFC term is full. */
export const RFC_SATURATION = 25;
/** Adopted working-group drafts at which the draft term is full. */
export const DRAFT_SATURATION = 5;

export const WEIGHTS = {
  /** Published RFCs. The largest single term, at the operator's direction. */
  rfcs: 40,
  /** Documents a working group adopted — `draft-ietf-*`. */
  adopted_drafts: 20,
  /** Currently chairing a working group. */
  chair_current: 25,
  /** Has chaired one. Half, because it is a past responsibility. */
  chair_past: 12,
  /** Area Director, or any IAB or IESG role, current or past. */
  area_or_body: 15,
} as const;

export interface RecordInput {
  rfc_authorships: number;
  /** Every document authored; adopted ones are counted here. */
  wg_document_authorships: string[];
  chair_roles: { current: boolean; group_type: string }[];
  ad_roles: unknown[];
  iab_iesg_roles: unknown[];
}

export interface RecordScore {
  /** 0-100. Zero is the ordinary state of a participant who has filed nothing. */
  score: number;
  rfcs: number;
  adopted_drafts: number;
  chairs_now: boolean;
  chaired_before: boolean;
  area_or_body: boolean;
  /** Each term's contribution, so the total can be taken apart on screen. */
  parts: { rfcs: number; adopted_drafts: number; role: number };
}

/** Saturating, so a long tail does not flatten everyone else against zero. */
function saturate(value: number, at: number): number {
  if (value <= 0) return 0;
  return Math.min(1, Math.log1p(value) / Math.log1p(at));
}

export function recordScore(record: RecordInput): RecordScore {
  const rfcs = Math.max(0, record.rfc_authorships);
  const adopted = record.wg_document_authorships.filter((d) =>
    d.startsWith("draft-ietf-"),
  ).length;
  const chairsNow = record.chair_roles.some((r) => r.current && r.group_type === "wg");
  const chairedBefore = record.chair_roles.some((r) => !r.current && r.group_type === "wg");
  const areaOrBody = record.ad_roles.length > 0 || record.iab_iesg_roles.length > 0;

  const rfcPoints = WEIGHTS.rfcs * saturate(rfcs, RFC_SATURATION);
  const draftPoints = WEIGHTS.adopted_drafts * saturate(adopted, DRAFT_SATURATION);
  // Chairing counts once at its highest level rather than accumulating: a
  // current chair who also chaired before has one chair responsibility, not two.
  const chairPoints = chairsNow
    ? WEIGHTS.chair_current
    : chairedBefore
      ? WEIGHTS.chair_past
      : 0;
  const rolePoints = chairPoints + (areaOrBody ? WEIGHTS.area_or_body : 0);

  return {
    score: Math.round(rfcPoints + draftPoints + rolePoints),
    rfcs,
    adopted_drafts: adopted,
    chairs_now: chairsNow,
    chaired_before: chairedBefore,
    area_or_body: areaOrBody,
    parts: {
      rfcs: Math.round(rfcPoints),
      adopted_drafts: Math.round(draftPoints),
      role: rolePoints,
    },
  };
}

/**
 * Bands, for colouring and for grouping a trend line.
 *
 * Named for what they describe — a quantity of published work — and never for
 * a kind of person. The boundaries are round numbers on the 0-100 scale rather
 * than quantiles of this corpus, for the same reason the weights are fixed.
 */
export const BANDS = [
  { min: 60, id: "extensive", label: "Extensive record" },
  { min: 30, id: "established", label: "Established record" },
  { min: 1, id: "some", label: "Some published work" },
  { min: 0, id: "none", label: "No published record" },
] as const;

export type BandId = (typeof BANDS)[number]["id"];

export function bandOf(score: number): BandId {
  return (BANDS.find((b) => score >= b.min) ?? BANDS[BANDS.length - 1]!).id;
}
