# LAOCOÖN — Problem Statement

**Status:** draft for confirmation. Nothing is built until this page is agreed.
**Repo:** `OR13/laocoon`, public from creation, marked experimental.
**Author:** Orie Steele, in a personal capacity. Not an IETF product.

---

## 1. The problem

The `agentproto` IETF mailing list carries 106 messages as of 2026-08-15, from a
list created 2026-07-24 — roughly 4.8 messages per day and rising. That volume is
still humanly readable. The trajectory is not, and the composition is already
degrading: of four senders sampled from the most recent traffic, three hold
datatracker records conferred entirely by their own hand (`draft-<name>-*`
individual submissions), and one has no record at all.

A working group chair has to answer one question repeatedly and correctly: **on
any given technical point, what does the group actually think?** The failure mode
LAOCOÖN exists to prevent is volume being mistaken for consensus — a position
that looks supported because it was restated fluently many times, or that looks
contested because a small mutually-reinforcing cluster kept replying to itself.

## 2. What this is not

**LAOCOÖN does not detect AI-generated text.** Provenance is out of scope, both
because detection is unreliable and because a participant using a model well can
produce a genuinely valuable contribution. The system never forms, stores, or
publishes the claim that a given account or message is machine-generated.

It also does not score people. It scores **structure**: threads, positions, and
patterns of engagement.

## 3. Primary objective

Determine **which technical arguments have the most and least human support**,
where support is measured as distinct positions engaged with, not messages
counted.

Secondary objectives, in priority order: reduce the reading burden on the chair;
make thread-level engagement patterns visible; surface mutually-reinforcing
clusters that do not connect to the rest of the group.

## 4. Method

The core insight is that **reception is measurable where provenance is not**.
Content that draws substantive replies from centrally-connected accounts is
valuable; content whose only engagement comes from an isolated peripheral cluster
is not. Both are read off the reply graph, and neither requires a judgement about
anyone's nature.

- **Primary graph:** directed reply edges from `In-Reply-To`/`References`.
  Weighted by whether a reply quotes and responds to specific text rather than
  restating.
- **Secondary view:** bipartite account × thread.
- **Rejected:** thread co-participation edges. They make everyone in a busy
  thread look connected and wash out exactly the peripheral clusters that matter.
- **Reputation propagation** is seeded by **community-conferred** standing only:
  current and past WG chairs, ADs, IAB/IESG (datatracker role API), and authors
  of adopted `draft-ietf-*` documents or RFCs. Self-conferred signals — submitting
  an individual draft — do not seed. The seed is a published *rule*, recomputed;
  never a hand-maintained list.
- **Cluster detection:** Louvain/Leiden community detection, temporal
  change-point detection per account, graph anomaly detection. Not reinforcement
  learning — there is no action the system takes and no reward it can influence.

## 5. Signals in scope

**In:** datatracker role records; adopted-document and RFC authorship; IETF
tenure; posting history across a curated ~20-list neighbourhood (ART area,
`oauth`, `wimse`, `webbotauth`, `moq`, `webtransport`, `quic`, `httpbis`,
`dispatch`, `ietf@ietf.org`); reply-graph position; substantive-vs-hollow reply
classification.

**Out, and why:**

- **Employer, affiliation, domain reputation.** A thin web presence is suggestive
  privately and defamatory publicly, and a legitimate newcomer with a personal
  domain looks identical to a fabricated one.
- **External SDO and academic credentials.** ORCID's public API returns nothing
  for email lookups (emails are private by default) and Crossref matches only on
  name. A name join is trivially claimable — pick a name, inherit a stranger's
  record — which would *create* the credibility-faking attack the system exists to
  resist. A namesake failure is already present in this corpus:
  `team@emiliaprotocol.ai` resolves through the datatracker to a `draft-dunbar-*`
  document whose author name does not match.
- **`mailarchive.ietf.org` bulk search.** Cloudflare-blocked (HTTP 403). All
  cross-list history comes from IMAP at ~1s per call, making it a budgeted crawl.

## 6. Validation

No hand labelling anywhere in the system.

- **Labels come from the graph.** A substantive reply from a community-conferred
  account is itself a human judgement that the message was worth engaging —
  continuously generated, free, and not fabricable by the thing being measured.
- **The metric is temporal holdout.** The system scores at time *T*; at *T+7d* it
  measures whether the engagement it predicted actually materialised. This
  converts validation into forecasting, which is objectively scorable with zero
  human input.
- **Disagreement between the 12b and 31b models flags a case** for review rather
  than resolving it silently.
- **The forecast accuracy is published on the site.** An experimental system that
  shows its own hit rate is credible; a confident unvalidated score is not.

## 7. Publication policy

**Published:** the argument/position map, per-thread measures, aggregate
composition of list traffic, the methodology, the seed rule, the crawled list
neighbourhood, and the system's own accuracy.

**Private to Orie:** any per-person quality score, any ranked participant list,
any label attached to a named individual.

Measures are published as a **vector, never a composite score** — distinct
participants, reply depth, core/periphery mix, substantive-reply ratio,
new-participant share, side by side. A single number invites an argument about
weights that cannot be won, and one disputed input would contaminate the whole
ranking instead of one column.

**Corrections:** every published figure derives from a JSON event in the repo.
A dispute is a GitHub issue against that file. Documented on the methodology page.

## 8. Fairness commitments, stated on the site

- Accounts are bucketed as **new participant** vs established, and new
  participants are **described, never ranked**. Age plus history structurally
  punishes newcomers, and the IETF depends on them.
- Every signal used is one a participant can verify and contest.
- The system reports **"no datatracker record"** as a fact, never as an inference
  about why.

## 9. Architecture

**100% local for daily operation.** No Claude Code, no hosted model, no remote
token spend in the pipeline. Claude Code is used for setup and design review only.

- **Event sourced.** Observed facts are events (`MessageObserved`,
  `SenderResolved`, `DatatrackerRecordFetched`, `CrawlWindowCompleted`).
  Append-only JSONL partitioned by date, committed to git. Graphs and scores are
  **projections** — regenerated, marked derived, never authoritative.
- **Corrections are compensating events, never edits.** Re-crawl emits
  `ObservationSuperseded`; identity resolution emits reversible
  `SenderIdentityMerged`. Self-healing is replay-and-diff, with disagreement
  emitting an event rather than overwriting.
- **Deltas only, never daily full snapshots.** Events for all time plus daily
  snapshots is how the repo reaches a gigabyte of noise in a year.
- **Storage behind an interface.** Git is the store today and is expected to be
  swapped later; nothing above the storage layer may assume it.
- **Crawling behind an interface** likewise, so the IMAP source can be replaced
  when it becomes the bottleneck. Daily incremental by UID watermark, weekly full
  reconciliation, catch-up after downtime, and the actual coverage window recorded
  in every output so gaps are visible rather than papered over.
- **Scheduling:** launchd, following the existing
  `com.tradeverifyd.orie-morning-briefing.plist` pattern.
- **Runtimes:** Bun/TypeScript for ingestion, event store, app and UI. Python for
  compute-heavy work Bun cannot do — `networkx`, `scipy`, `scikit-learn`. The seam
  is schema-versioned JSON artifacts on disk, never an in-process bridge.
- **Type system:** YAML-authored JSON Schema as the single source of truth, with
  types generated into both TypeScript and Python for cross-language type safety.
- **Models:** `gemma4:12b` for substantive-vs-hollow classification on every
  message; `gemma4:31b` for topic mapping and thread summarisation, which run per
  thread rather than per message. Model tag and prompt hash recorded on every
  record — without them the historical series silently stops being comparable.
- **Site:** GitHub Pages, static build. Primary page is a **thread health
  dashboard**, with graphs embedded per thread rather than a standalone explorer.

## 10. Deferred

- Presentation and information design — after a working prototype, via a design
  review loop against real usage. The question is whether the UI solves a problem
  for the reader, which cannot be answered before there is something to read.
- Argument/position units are currently thread-derived. Chair-curated position
  lists are a later refinement, not phase one.
- Weak supervision (Snorkel-style labelling functions) — only if graph-derived
  labels prove insufficient.
- Scaling the crawl beyond the 20-list neighbourhood.

## 11. Phasing

1. Event store, schema, ingestion of the `agentproto` corpus, reply graph.
2. Reputation propagation from the community-conferred seed; cluster detection.
3. Substantive-vs-hollow classification; temporal holdout harness.
4. Thread health dashboard on Pages, with methodology and accuracy published.
5. Design review loop.
