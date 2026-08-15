# Closed, low-novelty exchanges

PROBLEM.md §3 asks for *mutually-reinforcing clusters that do not connect to the
rest of the group*. This is that, as **three independent conditions** rather than
a score.

| condition | measured as | threshold |
| --- | --- | --- |
| **closed** | share of the community's reply edges that leave it | ≤ 0.25 |
| **no outside uptake** | share of replies to its messages that come from outside | ≤ 0.20 |
| **low novelty** | median fraction of a reply's sentences that are new to the thread | ≤ 0.60 |

A flag fires **only when all three cross**, and all three values are always shown
beside it. That is deliberately not a composite: §7 rules a single number out,
because it invites an argument about weights that cannot be won. A conjunction
can be disagreed with one column at a time — move a threshold and see what
changes.

## This is not provenance detection, and cannot become it

Every input is graph position or semantic overlap with earlier text. A group of
humans talking only to each other and repeating themselves scores identically.
That is the correct behaviour: the measure is of the exchange, not of who or
what produced it. **A fired flag licenses reading the thread. It licenses
nothing else**, and in particular it is not evidence that anything was
machine-generated.

## What it found

**agent2agent — 2 of 8 communities flagged.**

| members | messages | closure | outside uptake | novelty | flagged |
| ---: | ---: | ---: | ---: | ---: | :--- |
| 4 | 5 | 0.00 | 0.00 | 0.48 | **yes** |
| 8 | 9 | 0.12 | 0.12 | 0.50 | **yes** |
| 35 | 453 | 0.32 | 0.11 | 0.82 | no — novelty |
| 36 | 237 | 0.53 | 0.23 | 0.39 | no — open |

**agentproto — 0 flagged**, and the near miss is the interesting one: a
five-account community with closure 0.00 and outside uptake 0.00 — completely
self-contained — but median novelty **0.97**. Closed and *productive*. The
novelty condition is what separates a self-contained technical discussion from a
loop, and here it did exactly that.

## Read this result cautiously

Both flagged communities are **tiny**: 5 and 9 messages out of 1,233. This is not
recursive banter at volume; it is two small side conversations. The detector
demonstrably discriminates — the 36-member community is repetitive but open and
correctly unflagged, the 35-member is closed-ish but novel and correctly
unflagged — but nothing it has found so far is large enough to matter to a chair.

The thresholds are three constants chosen by inspection, not calibrated. Unlike
the topic threshold there is no held-out objective for them, because there is no
ground truth about what a loop is. They should be treated as a starting point
that the next corpus will move.
