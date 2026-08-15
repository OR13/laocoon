# Phase 3 — substance classification and the temporal holdout

PROBLEM.md §11 item 3. Built, run against the corpus, and the result is mostly
negative. The negative result is the useful part.

Method for the holdout is [`docs/holdout.md`](holdout.md).

## What exists

| Piece | Where |
| --- | --- |
| The prompt (versioned, hashed) | `src/classify/prompt.ts` |
| Local model client | `src/classify/ollama.ts` |
| Classification | `src/classify/classify.ts`, `bun run classify` |
| Model disagreement report | `src/cli/agreement.ts`, `bun run agreement` |
| Per-thread measures | `python/laocoon/measures.py`, `bun run measure` |
| Temporal holdout | `python/laocoon/holdout.py`, `bun run holdout` |

## Result 1 — the substance classifier has no variance

`gemma4:12b` over all 82 replies in the corpus:

| verdict | count |
| --- | ---: |
| substantive | 81 |
| unclear | 1 |
| **hollow** | **0** |

Not one reply was judged hollow. **A measure with no variance carries no
information**, so `substantive_reply_ratio` is 1.0 for every thread that has any
classified reply, and it distinguishes nothing.

I checked whether the classifier was simply rubber-stamping. It is not. The
reasons it gives are specific and correct, and the shortest replies in the corpus
— one line of new text on top of ten kilobytes of quotation, the shape that
usually means "+1" — turn out to be real technical objections when you read them:
*"Not sure that is a relevant case for session management…"*. On this corpus
"substantive" is very often the right answer.

So there are two candidate explanations and this run does not separate them:

1. **The corpus really is nearly all substantive.** A working group charter
   discussion among mostly experienced participants plausibly is.
2. **The prompt's `hollow` definition is too narrow** — it requires restating,
   endorsing without specifics, or being purely procedural. Nothing in this
   corpus met it.

Distinguishing them needs a corpus containing known-hollow messages, and this one
does not appear to contain any.

## Result 2 — the seven-day horizon does not fit this corpus

Thread lifespans, first message to last:

- **median 1.1 hours** across 24 threads
- only 8 threads live longer than 8 hours
- longest is 221 hours (9 days)

§6 specifies scoring at *T* and checking at *T+7d*. On this corpus a seven-day
horizon is longer than the entire life of most threads. At the natural origin
(the last date with a full horizon after it, 2026-08-08) **not one thread had a
message on both sides of the cut** — the harness correctly reported zero
engagement and an undefined correlation, which is true and useless.

That is a finding about the specification meeting the data, not a bug. The
harness now takes `--horizon-days` and `--origin-step-days`, and is reported at
both the specified 7 days and at 2 days, which fits the observed lifespans.

## Result 3 — the holdout, at both horizons

Rolling daily origins. Median Spearman across origins where it was defined.

**2-day horizon — 20 origins, engagement at 13 of them**

| forecaster | defined | median ρ | beats baseline |
| --- | ---: | ---: | ---: |
| `recent_replies` *(baseline)* | 12/20 | +0.584 | — |
| `recent_substantive_replies` | 12/20 | +0.584 | 0/20 |
| `recent_seeded_participants` | 10/20 | +0.529 | 4/20 |

**7-day horizon — 15 origins, engagement at 10 of them**

| forecaster | defined | median ρ | beats baseline |
| --- | ---: | ---: | ---: |
| `recent_replies` *(baseline)* | 10/15 | −0.260 | — |
| `recent_substantive_replies` | 10/15 | −0.260 | 0/15 |
| `recent_seeded_participants` | 10/15 | +0.522 | 7/15 |

Three things fall out of this.

**Substance adds exactly nothing.** `recent_substantive_replies` is *numerically
identical* to the baseline at every single origin — necessarily, because the
classifier called every reply substantive, so counting substantive replies is
counting replies. This is the direct consequence of Result 1, and it is the
clearest statement of it: the phase-3 signal, as implemented, is not a signal.

**At a week out, raw volume anti-predicts.** The baseline's median correlation is
**−0.260** at 7 days: a thread that was busy last week is, if anything, *less*
likely to be busy next week. Threads here burn out rather than build. That is a
real property of the corpus and it is the failure mode PROBLEM.md §1 names —
volume mistaken for consensus — showing up as a measurable fact.

**Participation by accounts with community-conferred standing is the only thing
that survives.** It is the sole forecaster that ever beats the baseline, and at 7
days it stays at **+0.522** where volume goes negative. That is the project's
central hypothesis — reception from centrally-connected accounts matters more
than message count — surviving its first contact with data.

**Do not overread it.** It beats the baseline at 7 of 15 origins and 4 of 20,
which is under half in both cases; the median is higher but individual origins
disagree. Daily origins overlap, so these runs are correlated and are not
independent trials. The corpus is one list, three weeks, 24 threads. This is
suggestive and nothing more.

## Decisions

**Verdicts are private; the ratio is public.** A per-message quality label joined
to the `sender_id` in the public log is a per-person quality score in one line.
`MessageClassified` goes to the private log; `ThreadMeasured` carries the
per-thread aggregate into the public one.

**The prompt forbids provenance speculation explicitly.** A model asked to judge
engagement will otherwise volunteer an opinion on authorship, and that opinion
would then be in the log. Tests assert the prompt contains no provenance
vocabulary and names neither sender.

**The model endpoint is checked, not configured.** `OllamaClient` refuses any
base URL that is not localhost. §9's "100% local" is a property of the code.

**`ThreadMeasured` is an event, not a projection**, because the holdout needs the
figure computed at *T* to still exist at *T+7d*. `measured_at` is the data
horizon, so recomputing the same horizon appends nothing.

**Disagreement is flagged, never resolved.** No tie-break between the models.

**Errors and "unclear" are different facts.** A pipeline failure is recorded as
`error` and stays eligible for a retry; the model declining to judge is
`unclear`. Collapsing them would let a broken run look like an inconclusive
corpus.

**No fitted forecaster.** Each is a single existing column, fixed before looking
at any answer. With 24 threads a learned weighting would be fitted to noise and
the accuracy figure would be a lie.

## Not done, and not checked

- **The 31b pass was still running** when this was written, so the 12b/31b
  disagreement rate — §6's substitute for hand labelling — is not yet known. Run
  `bun run agreement` once it finishes.
- **No human ever checked a verdict.** §6 rules out the hand labelling that would
  be needed. Model disagreement is the only proxy, and if both models share the
  same bias toward "substantive" it will not show up.
- **The `hollow` definition is untested** because nothing in this corpus matched
  it. It may be too narrow; there is no way to tell from here.
- **Origins overlap**, so the evaluations are correlated. The p-values are
  reported but should not be read as independent significance tests.
- **One list, three weeks, 24 threads.** Every figure above would move on a
  larger corpus, and the 7-day horizon might become appropriate on a list with
  longer-lived threads.
