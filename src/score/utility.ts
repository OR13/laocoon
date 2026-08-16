/**
 * The Laocoön utility score: low, medium or high, for one thread.
 *
 * The operator described what they wanted and then said the word they had been
 * using for it — "healthy" — was wrong. They were right. Health implies a
 * verdict on a discussion, and none of these inputs can support one. What they
 * actually named was three things a reader can check:
 *
 *   - are real people communicating in a style the list can follow along
 *   - are the threads resolving
 *   - is it two or more accounts amplifying each other
 *
 * All three are counts of who did the talking, so that is what this is.
 *
 * **Three levels, not a number.** A continuous score here would invite an
 * argument about weights that cannot be won, which is what PROBLEM.md section
 * 7 warns against. A level built from a conjunction of thresholds can be
 * disagreed with one condition at a time, and every input is reported beside
 * the level so it can be.
 *
 * **It is not a provenance signal and cannot become one.** Two experts working
 * through a detail produce exactly the shape two amplifying accounts produce,
 * and this reports the shape. A `low` is a prompt to go and read the thread,
 * never a claim about who or what wrote it.
 */

/** Below this a thread is too short for the shape to mean anything. */
export const SUBSTANTIAL_MESSAGES = 6;
/** At or above this share from two accounts, the exchange is theirs. */
export const CONCENTRATED_AT = 0.8;
/** Below this share, the load is spread. */
export const SPREAD_BELOW = 0.7;
/** Participants a thread needs before the list could be said to follow along. */
export const BROAD_PARTICIPANTS = 4;
/** A contributor score at which somebody with a published record took part. */
export const ENGAGED_CONTRIBUTOR = 35;

export type Utility = "low" | "medium" | "high";

export interface UtilityInput {
  messages: number;
  participants: number;
  /** Share of the thread's messages sent by its two busiest accounts. */
  top_two_share: number;
  /** Highest Laocoön contributor score among the participants. */
  best_contributor: number;
}

export interface UtilityVerdict {
  utility: Utility;
  /** Every condition, so the level can be argued with one line at a time. */
  conditions: {
    substantial: boolean;
    broad: boolean;
    spread: boolean;
    concentrated: boolean;
    contributor_engaged: boolean;
  };
  reason: string;
}

export function utilityOf(input: UtilityInput): UtilityVerdict {
  const substantial = input.messages >= SUBSTANTIAL_MESSAGES;
  const broad = input.participants >= BROAD_PARTICIPANTS;
  const spread = input.top_two_share < SPREAD_BELOW;
  const concentrated = input.top_two_share >= CONCENTRATED_AT;
  const contributorEngaged = input.best_contributor >= ENGAGED_CONTRIBUTOR;
  const conditions = { substantial, broad, spread, concentrated, contributor_engaged: contributorEngaged };

  if (substantial && broad && spread && contributorEngaged) {
    return {
      utility: "high",
      conditions,
      reason: "A sustained exchange between several people, including someone with a record.",
    };
  }
  if (substantial && concentrated && input.participants <= 3) {
    return {
      utility: "low",
      conditions,
      reason: "A long exchange that two accounts carried between them.",
    };
  }
  if (!substantial && input.participants <= 2 && input.best_contributor === 0) {
    return {
      utility: "low",
      conditions,
      reason: "A short exchange between two accounts with no published record.",
    };
  }
  return {
    utility: "medium",
    conditions,
    reason: substantial
      ? "A sustained exchange that meets some of the conditions for high."
      : "Too short to say more.",
  };
}

export const UTILITY_META: Record<Utility, { label: string; help: string }> = {
  high: {
    label: "High",
    help:
      `Six messages or more, four or more participants, under ${Math.round(SPREAD_BELOW * 100)}% ` +
      `from the busiest two, and someone with a contributor score of ${ENGAGED_CONTRIBUTOR} or more took part.`,
  },
  medium: { label: "Medium", help: "Meets some of the conditions for high, or is too short to say." },
  low: {
    label: "Low",
    help:
      `Either a thread of six or more that two or three accounts carried at ${Math.round(CONCENTRATED_AT * 100)}% ` +
      "or above, or a short exchange between two accounts with no published record. A prompt to read it, not a verdict.",
  },
};
