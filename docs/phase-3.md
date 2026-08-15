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

- **The agreement rate is 97.6% and it validates nothing.** The two models agreed
  on 80 of 82 replies. That number looks reassuring and is not: two models that
  both answer "substantive" to almost everything agree perfectly while telling
  you nothing. §6 offers model disagreement as the substitute for hand labelling,
  and on a degenerate measure the substitute is degenerate too. Both models are
  `gemma4`, so a shared bias is exactly the failure this cannot see.
- **No human ever checked a verdict.** §6 rules out the hand labelling that would
  be needed.
- **The `hollow` definition is untested** because nothing in this corpus matched
  it. It may be too narrow; there is no way to tell from here.
- **Origins overlap**, so the evaluations are correlated. The p-values are
  reported but should not be read as independent significance tests.
- **One list, three weeks, 24 threads.** Every figure above would move on a
  larger corpus, and the 7-day horizon might become appropriate on a list with
  longer-lived threads.

---

## Addendum — the classifier replaced, and what the replacement does not fix

`gemma4:12b` and `gemma4:31b` both returned essentially zero hollow replies, and
their 97.6% agreement validated nothing, so the binary was replaced by a
continuous **novelty** measure: the fraction of a reply's sentences that nothing
earlier in the thread already said. 33,803 sentences across 1,266 messages,
embedded locally with `nomic-embed-text`.

Two wrong versions came first, both caught by testing the measure against
quantities it must be independent of:

| version | scored over | correlation with quoted fraction | with new-text lines |
| --- | --- | ---: | ---: |
| v1 | whole message body | **−0.32** | +0.09 |
| v2 | authored text, whole | +0.35 | **−0.58** |
| v3 | authored text, per sentence | +0.28 | −0.42 |

v1 measured quoting habit. v2 measured brevity — a short passage embeds far from
everything. v3 divides length out and is the one in use, with an explicitly
length-regressed variant reported beside it. The residual −0.42 is not zero and
is not claimed to be.

**The absolute value means nothing.** Median novelty moves from 0.39 to 1.00 as
the sentence-duplicate cutoff goes 0.65 → 0.85. Only the ranking under a fixed
cutoff carries information, and the sweep is in the artifact so a reader can see
that for themselves.

## Addendum — topic clustering over-merges

Topics beat subject-normalisation at predicting co-participation on both lists
(φ 0.394 vs 0.140 on agentproto; 0.213 vs 0.101 on agent2agent), which is the
test that was promised. They still are not good enough to use.

On **agentproto** the calibration chose a threshold that put 19 of 24 threads and
100 of 106 messages into one topic. On a small, densely connected list "one big
cluster" trivially predicts co-participation, so the objective is degenerate at
small *n* — the same failure shape as the classifier, in a different measure.

On **agent2agent** φ falls monotonically as clusters merge (0.213 at 112 clusters
→ 0.000 at 1), so calibration picks the tightest threshold — and even there one
cluster holds 167 of 344 threads and 74% of the messages. That is average-linkage
chaining, and no threshold fixes it.

What this rules out: agglomerative clustering with average linkage and a single
global threshold. What it suggests instead is hierarchical topics — a topic that
contains sub-topics, which is what the corpus actually looks like — or a
density-based method that is allowed to leave threads unassigned. Neither is
built.

---

## Addendum — the central result did not survive the control corpus

Every forecaster is now scored per list. It should have been from the start: with
one `list_name` missing from `ForecastEvaluated`, two lists pooled into one
median, and a finding from 15 origins on a three-week-old list silently became a
claim about the method.

**agent2agent, 7-day horizon, 159 origins** — the corpus with enough history to
mean anything:

| forecaster | defined | median ρ | beats baseline |
| --- | ---: | ---: | ---: |
| `recent_replies` *(baseline)* | 74/159 | **+0.462** | — |
| `recent_novel_replies` | 69/159 | +0.419 | 31/159 |
| `recent_seeded_participants` | 75/159 | +0.403 | 27/159 |

**Nothing beats counting replies.** Novelty and community-conferred participation
both land slightly below the baseline and beat it at under a fifth of origins.

This reverses two things reported earlier from `agentproto` alone:

- *"At a week out, raw volume anti-predicts (−0.260)."* True on 15 origins of a
  three-week-old list. On 159 origins of a 483-day list, volume predicts at
  **+0.462**. The negative was a property of a young list where every thread
  burns out, not of mailing lists.
- *"Participation by accounts with community-conferred standing is the only
  forecaster that survives."* It scored +0.522 against a negative baseline on
  agentproto. On agent2agent it is +0.403 against +0.462 — it loses.

The project's stated insight — that reception from centrally-connected accounts
beats message count — is **not supported on the larger corpus**. It is not
refuted either: 27 of 159 origins do favour it, and the corpus is still two
lists. But it cannot be reported as surviving contact with data, because on the
better data it does not.

## Addendum — the health verdict was removed

An open/narrow/closed label built from reach, uptake and novelty was tested
against the same standard and **inverted**:

| state | agentproto revival | agent2agent revival |
| --- | ---: | ---: |
| open | 0.077 | 0.021 |
| narrow | 0.370 | 0.046 |
| closed | **0.800** | **0.286** |

Threads it called closed were the most likely to continue. `reach` — distinct
senders per message — is an inverse proxy for a sustained argument: high reach is
usually a broadcast that drew a few one-off replies and died. The label encoded
"breadth is health" and two lists disagreed.

The three axes remain, as measurements. The verdict is gone, and nothing should
reintroduce one without passing the same test.
