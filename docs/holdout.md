# The temporal holdout

**How this system is validated, and how it reports its own accuracy.**

PROBLEM.md §6 rules out hand labelling anywhere. That leaves one honest way to
know whether the measures mean anything: make them predict something, then check.

Rank the threads using only data available at time *T*. At *T+7d*, count what
actually happened. The comparison is objectively scorable, needs no human input,
and cannot be influenced by the thing being measured.

## The forecasters

Each is a **single column of the published measure vector**, chosen before
looking at any answer. None is a fitted blend: with 24 threads on one list, any
weighting learned from this corpus would be fitted to noise, and the resulting
accuracy figure would be a lie.

| Name | Score for a thread at *T* | Role |
| --- | --- | --- |
| `recent_replies` | replies received in *(T−7d, T]* | **baseline** — raw volume, no model, no seed |
| `recent_substantive_replies` | of those, the ones the classifier called substantive | does substance add signal over volume? |
| `recent_seeded_participants` | distinct participants in the window holding community-conferred standing | does *who* engaged add signal over *how much*? |

The baseline is the point. A correlation reported on its own is not a result: the
question is never "does this predict anything" but "does this predict better than
counting messages". If the two model-dependent forecasters do not beat
`recent_replies`, that is the finding, and it appears in the output rather than
being quietly left out.

## What is scored

- **Actual engagement**: replies a thread received in *(T, T+7d]*.
- **Spearman rank correlation** between predicted and actual, with its p-value.
  Reported as `null` — never as a number — when it is undefined, which on a small
  corpus happens routinely because a predictor is constant across all threads.
- **Precision@3**: of the three top-ranked threads, the share that saw any
  engagement at all.

Threads are matched across the two time points by their **root message id**. The
graph is rebuilt at *T+7d* rather than reused from *T*, because a message
arriving in between can join two previously separate components; matching on the
root keeps a thread's identity stable through that.

## Origins

By default the harness walks a rolling series of origins backwards in
horizon-length steps, stopping at the last date that still has a **full horizon of
observed data after it**. An origin without a complete horizon would score the
system against a future that has not happened, which would silently inflate the
result.

This is a backtest, and it is honest only because of that cutoff: the corpus
already contains the future relative to every origin used.

## Where the results go

Each origin produces one `ForecastEvaluated` event per forecaster, in the
**public** log. §6 requires the system's accuracy to be published: an experimental
system that shows its own hit rate is credible, and a confident unvalidated score
is not.

## What this does not validate

The holdout measures whether the ranking predicts engagement. It does **not**
establish that the substance classifier agrees with what a human would call
substantive — nothing here does, because §6 rules out the hand labelling that
would be needed to check. The `gemma4:12b`/`gemma4:31b` disagreement rate is
reported instead: two models trained differently arriving at different verdicts
flags a case for review rather than resolving it silently.

It also does not validate anything about provenance, which is not measured, not
stored, and not predicted anywhere in this system.
