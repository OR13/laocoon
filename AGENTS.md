# LAOCOÖN — agent contract

Project-level contract for agents working in this repository. The workspace
contract is `../../AGENTS.md` and `../../rules/`; this file governs everything
inside `projects/laocoon/`.

**Read [`PROBLEM.md`](PROBLEM.md) before doing anything.** It is the agreed
problem statement, settled with the operator in a full design interrogation. It
is not a sketch — treat its exclusions as binding constraints, not suggestions.
If a change would contradict it, stop and raise it rather than reinterpreting it.

## What this is

A local pipeline that ingests the `agentproto` IETF mailing list, builds a reply
graph, propagates reputation from community-conferred standing, classifies reply
substance with a local model, and publishes thread-level engagement measures to
GitHub Pages.

## Non-negotiable constraints

These are the ones most likely to be eroded by well-meaning changes:

1. **Never detect or claim provenance.** The system must not form, store, or
   publish the claim that an account or message is AI-generated. Measure
   reception and graph position instead. This is the decision the entire
   project's defensibility rests on.
2. **Never publish per-person quality judgments.** Per-thread and aggregate
   measures are public; per-person scores and rankings stay local. See
   `PROBLEM.md` §7.
3. **Never publish a composite score.** Measures are a vector, side by side.
4. **No manual steps anywhere in the pipeline.** No hand labelling, no
   hand-maintained trust lists, no manual annotation. The seed is a computed rule.
5. **Daily operation is 100% local.** Bun, Python, and Ollama only. No Claude
   Code, no hosted model, no network spend in the pipeline. Claude Code is for
   setup and design review only.
6. **Events are immutable and kept for all time.** Corrections are compensating
   events, never edits. Graphs and scores are regenerable projections, never
   authoritative.
7. **Deltas only.** Never write daily full snapshots into the event log.
8. **Storage and crawling sit behind interfaces.** Git is today's event store and
   IMAP is today's source; both are expected to be replaced. Nothing above those
   layers may assume either.

## Stack

- **Bun / TypeScript** — ingestion, event store, app, UI, Pages build.
- **Python** — compute-heavy work only: `networkx`, `scipy`, `scikit-learn`.
  Invoked as a subprocess. The seam is schema-versioned JSON artifacts on disk,
  never an in-process bridge.
- **YAML-authored JSON Schema** is the single source of truth for types, with
  types generated into both TypeScript and Python.
- **Ollama** — `gemma4:12b` for per-message substance classification;
  `gemma4:31b` for per-thread topic mapping and summarisation. Record the model
  tag and prompt hash on every record.
- **launchd** for the daily run, following the existing
  `com.tradeverifyd.orie-morning-briefing.plist` pattern.

## Data sources and their limits

- **IETF IMAP** via the workspace `ietf-imap` MCP. ~1s per call — crawling is
  budgeted, not free. Mailboxes are namespaced `Shared Folders/<list>`.
- **Datatracker REST API**, keyless. `/api/v1/person/email/?address=<addr>`
  resolves an email to a person and its `origin` field states how they entered
  the system. `/api/v1/group/role/?group__acronym=<acr>` returns roles.
- **`mailarchive.ietf.org` is Cloudflare-blocked** (HTTP 403). There is no bulk
  cross-list search. Do not build anything that assumes there is.
- **ORCID and Crossref are not usable** for identity joins. See `PROBLEM.md` §5.

## Publishing

This is a **public** repository. The first push of any change is the operator's
decision — prepare the commit and ask. The repo being public is not standing
authorization to publish analysis of named participants.
