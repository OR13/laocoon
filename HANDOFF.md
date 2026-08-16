# Handoff — 2026-08-16

**Work in progress.** The site works end to end and every check passes, but the
design pass is mid-flight and the operator has a stated next step. Read
[`PROBLEM.md`](PROBLEM.md) and [`AGENTS.md`](AGENTS.md) first — this file is
what a fresh agent needs *on top of* them, not a substitute.

## State

38 commits on `main`. **Nothing has ever been pushed**: there is no upstream
configured, and this is a public remote, so the first push is the operator's
decision ([`INVARIANTS.md`](../../INVARIANTS.md) #5). Do not push.

Everything green as of the last commit:

```
bun run check                                    # 134 Bun tests, 31 pytest
bunx playwright test --config web/playwright.config.ts   # 31 e2e
bun run site                                     # static export → site/
```

`site/`, `artifacts/` and `private/` are gitignored and regenerable. The
pipeline order that matters:

```
bun run graph --list agentproto --list agent2agent   # reply-graph.json, BOTH lists
bun run concreteness                                 # per-message language measures
bun run reply-network                                # the artifact the site is built from
bun run site
```

`artifacts/reply-network.json` is the one the whole site reads. Regenerate it
after any scoring change.

## The open problem to fix

**A deliberate refusal renders as a bare zero, and reads as a bug.** This has
now happened twice, both times caught by the operator rather than by us:

1. `/lists/agentproto/` showed `TOPICS 0`. The clustering had been *refused* —
   all nine candidate thresholds failed the blob cap, because even the tightest
   put 56% of the list's 24 threads in one cluster. Fixed in `95b8d2d` by
   carrying a `topics_refused` reason on the artifact, derived from the topic
   tree's own calibration record so it disappears on its own if the list ever
   clusters.
2. Thread-level language measures are withheld below four messages, because a
   median over one or two values is noise. The threads table says so in a note;
   nothing else does.

**These are not two bugs, they are one class**, and the codebase is full of
places it can recur — every measure here can legitimately decline to produce a
value, and the UI mostly renders that as `0`, `—`, or an empty section. The fix
is not another one-off caption. It wants a convention: a withheld or refused
measure should carry its reason as data next to the value, and the components
that render measures should be unable to show an absence without one.

Known places that still show a bare absence without a reason:

- `RatioCell` renders `not measured` with no explanation of why.
- Topic pages and list pages show empty sections when a list has no topics.
- `median_novelty`, `median_distinctiveness` and
  `share_offering_nothing_checkable` are all `null` below the message floor.
- The graph legend counts a level as `0` with no distinction between "none of
  these exist" and "the filter excluded them".

## What the operator asked for next

Their words, in order: fix the handoff problem above, then **design the mailing
list landing page**. `/lists/<name>/` currently has stats, two distribution
bars, topics, busiest threads and busiest people — assembled quickly to
complete the hierarchy, not designed. They intend to work through landing pages
for each resource, starting there.

The established workflow is theirs and should be followed: build, rebuild the
site, open it in Chrome, and then put specific numbered questions to them about
whether it solves the problem. They answer bluntly and they are usually right.

## What the site is now

Four resources, each with its own page, and a landing page that is a way in
rather than a destination:

- `/` — the graph, a "where to start" block, and the daily trend.
- `/lists/`, `/lists/<name>/` — the top of the hierarchy.
- `/people/`, `/people/<slug>/` — 204 pages.
- `/topics/`, `/topics/<id>/` — 45 pages.
- `/threads/<slug>/` — 390 pages, keyed by the archive token because a
  Message-ID cannot go in a path.
- `/methodology/` — both scores, the topic calibration, and the validation that
  used to live on a separate Accuracy page.

The Threads table and the Accuracy page were removed on the operator's
instruction; the accuracy *content* moved into Methodology.

### The two scores

Both named by the operator, both defined at `/methodology/#scores`.

- **Laocoön contributor score** — per account, 0–100, a logistic curve over
  published IETF record (`src/score/contributor.ts`). An S-curve at the
  operator's direction: 1 unit → 3, 8 → 41, 12 → 66, 20 → 92. The `− L(0)`
  anchor matters; without it an empty record scores 12 and "has published
  nothing" reads as a low grade instead of an absence.
- **Laocoön utility score** — per thread, low/medium/high, never a number
  (`src/score/utility.ts`). A conjunction of thresholds so it can be disagreed
  with one condition at a time.

**Both share one red/amber/green palette**, stepped against
`scripts/validate_palette.js` in the `dataviz` skill, not by eye. Do not change
those hexes without re-running it.

## Findings that constrain the design

These were expensive to establish. Do not re-litigate them without new data.

- **No measurable property of a message predicts whether an established account
  replies to it.** Concreteness, novelty and thread-specificity were each
  tested against a held-out window; all three come back at ~0 on the 865-reply
  list. Only asking a question moves (+0.205, +0.210) and only weakly. The
  measures are kept as *descriptions*, never as predictors.
- **Accounts with no Datatracker record are statistically indistinguishable**
  from accounts with one, on every column measured.
- **The word "healthy" is banned** — the operator rejected it, correctly. It
  implies a verdict on a discussion that none of these inputs support.
- **A `low` utility score is a prompt to read the thread, not a verdict.** Two
  experts working a detail produce exactly the shape two amplifying accounts
  produce. There is a test asserting they score identically. *The day that test
  is changed is the day this became the provenance detector `PROBLEM.md` §2
  forbids.*

## Traps

**Sigma silently renders unparseable colours wrong.** Four distinct failures
hit so far, each costing a debugging cycle:

| form | what it does |
|---|---|
| `#8882` four-digit hex | ignored → olive |
| `oklch(…)` (i.e. most theme tokens) | ignored → black |
| `rgba(…)` | parsed but **not alpha-blended** → full strength |
| a node program's own `drawHover` | beats `defaultDrawNodeHover` → white box |

**Only opaque six-digit hex reaches the renderer.** There is a test asserting
it. When you need a theme colour in the graph, add a hex token to
`globals.css`; do not reach for an existing `oklch()` one.

Other sigma behaviour worth knowing, all with comments at the call sites in
`web/components/reply-network.tsx`:

- It measures its container once and never watches it — there is a
  `ResizeObserver`, and without it the graph rendered 304px narrow and jumped.
- It binds `mousemove` on the document and stops propagation while panning, so
  drag handlers are capture-phase on the document.
- `getNodeAtPosition` returns the right node when called cold and `null` from
  inside a mousedown; the hit test is computed from display positions instead.
- Rebuilding the renderer throws on its shared program registry. It is
  constructed once and the graph is repopulated in place.
- Seeding tiers on concentric circles produces concentric circles — a force
  layout cannot break that symmetry. Nodes are seeded from a hash of their key.

## Working discipline that has been earning its keep

- **Drive the browser, do not reason about it.** Every serious defect in this
  session was found by Playwright or by looking at a screenshot, and several
  passed every numeric check while being visibly broken.
- **A measure that cannot produce a negative result is broken.** This has
  caught four measures now — the substantive/hollow classifier (162 of 164),
  the health verdict (which inverted), and two prompt flags that never fired.
  `bun run value-probe` exists purely to check variance before a full pass.
- **Record dead ends where the next reader will hit them**, not in a changelog.
  `health.py` keeps its inversion table; `value-prompt.ts` keeps its failed
  distributions and a "do not add them back"; `layout.ts` keeps the two layout
  changes that measured worse with their numbers.

## Not done

- The v3.0.0 contribution prompt passes its variance probe on 48 replies but
  **has never been run over the full corpus** — ~12 hours of local GPU time,
  and it needs incremental flush and a resume point first.
- There is no scheduled pipeline. No launchd plist is installed; everything is
  run by hand.
- `bun run name-topics` silently skips a list under some ordering not yet
  isolated. It degrades to cleaned subjects, so it is cosmetic.
- The operator asked twice for the three threads they would call slop, to
  validate the measures against their judgement. They have not supplied them,
  and no measure here has been checked against a human call.
