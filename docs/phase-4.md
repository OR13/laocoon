# Phase 4 — the thread health dashboard

PROBLEM.md §11 item 4: a thread health dashboard on Pages, with methodology and
accuracy published. **Built, not deployed.** The site generator runs and its
output is correct; turning it into a public web page is an operator decision and
has not been made.

## What exists

| Piece | Where |
| --- | --- |
| Next.js app (React, TypeScript, Tailwind v4, shadcn/ui) | `web/` |
| Public pages | `web/app/page.tsx`, `accuracy/`, `methodology/` |
| Private page | `web/app/private/graph/page.private.tsx` |
| Graph component (Cytoscape + fCoSE) | `web/components/participation-graph.tsx` |
| Build-time data loading | `web/lib/data.ts` |
| Publication guard | `src/site/publishable.ts` |
| Public build | `src/cli/site.ts` → `bun run site` |
| Private build | `src/cli/private-view.ts` → `bun run private-serve` |

```
bun run site            # next build -> site/, deploys nothing
bun run private-serve   # next build (private) -> private/views/, serves on loopback
```

The site is a Next.js static export rather than hand-written HTML. Both builds
come out of one app, separated by `pageExtensions` (below). A Next export
references its assets from the site root, so the private view has to be
**served** rather than opened with `file://` — `bun run private-serve` starts a
loopback-only static server and prints the URL.

Public routes:

- `/` — the corpus summary as stat cards, the thread measure table, and the
  community structure.
- `/accuracy/` — the per-horizon summary, then every forecast evaluation with the
  baseline beside it.
- `/methodology/` — what is measured, what is excluded and why, the seed rule,
  the fairness commitments, the corrections policy, and the coverage table.

Private route, built only under `LAOCOON_PRIVATE=1`:

- `/private/graph/` — the bipartite participation graph with named people and
  threads as nodes, click-through profiles, and the two tables.

## The guard is the design

Publishing is irreversible, so the build refuses input rather than trusting
whoever wrote it. Three independent checks, each of which would have to fail
silently for per-person data to escape:

1. **The private route does not exist in a public build.** Its file is named
   `page.private.tsx`, and `private.tsx` is only in Next's `pageExtensions` when
   `LAOCOON_PRIVATE=1`. In a public build that file is not a page, so there is no
   route to accidentally populate. (An earlier attempt used a dynamic segment
   with empty `generateStaticParams`; `output: "export"` rejects that outright,
   which is how the weaker mechanism got found.)
2. **A whitelist of event types.** Only `ThreadMeasured`, `ForecastEvaluated` and
   `CrawlWindowCompleted` are read from the log. A blacklist would start
   publishing the next event type someone adds; this one refuses it by default.
   `MessageObserved` — which carries `sender_id` — is not on the list.
3. **Artifacts must declare themselves.** Every aggregate artifact must carry
   `publication: aggregate_public`. `reply-graph.json` and `reputation.json`
   declare `private` and are rejected on sight. Saying nothing is also rejected:
   silence is not consent.
4. **Every exported byte is scanned.** All 34 exported files are read after the
   build and any `sha256:…` matching the sender-hash shape aborts it, with the
   classifier's prompt hash allowed by name rather than by loosening the
   pattern. The build also fails if any exported path contains `/private/`.

## Presentation

PROBLEM.md §10 defers information design until there is a working prototype and a
real reader. There is now one, so the site is a Next.js app with shadcn/ui rather
than hand-written markup — the components carry the accessibility and theming
work, which leaves the effort for the three things that would make the numbers
dishonest if got wrong:

- **No composite score, anywhere.** Measures are columns side by side. §7 rules a
  single number out, and the table is never sorted by a quality measure — only by
  message count.
- **"Not measured" never renders as zero.** A thread nobody classified and a
  thread of hollow replies are different facts, and get visibly different cells.
  The same applies to an undefined rank correlation, which prints as *undefined*
  rather than as a number.
- **New participants are described, never ranked.** The column is shown, with the
  caveat that on a list a few weeks old it is near 1 everywhere and carries
  almost no information. Showing it with the caveat beats hiding it.

The experimental banner and the "does not detect AI-generated text" disclaimer
are in the page template, so they cannot be omitted from a page by forgetting.

## Deploying — not done, and why

`site/` is gitignored, no GitHub Actions workflow exists, and Pages is not
enabled. That is deliberate: this is a public repository, the first push of
anything is the operator's decision, and a workflow that deploys on push would
turn every future commit into a publication.

When it is time, the two options are:

1. **Actions workflow** building `site/` and deploying to Pages. Cleanest, but it
   makes publishing automatic — every push to `main` republishes.
2. **Commit `site/` and serve it from a branch or `docs/`.** More friction, and
   the friction is the point: publishing becomes an explicit commit.

Option 2 is the better fit for this project while it is experimental, because it
keeps a human in the loop on every change to what the world sees. Neither is
wired up.

Before the first deploy, two things should be settled that this phase did not:
whether the thread subjects — which are public in the IETF archive but become far
more findable on an indexed page — should appear in full, and whether
`<meta name="robots" content="noindex">`, which the template currently sets,
should stay.
