# Phase 1 — event store, schema, ingestion, reply graph

Status of the phase-1 items in [`PROBLEM.md`](../PROBLEM.md) §11, what was
measured on the real corpus, and the decisions taken along the way that
`PROBLEM.md` did not settle.

## What exists

| Piece | Where | Notes |
| --- | --- | --- |
| Schema, single source of truth | `schemas/*.yaml` | YAML-authored JSON Schema |
| Generated JSON Schema | `schemas/generated/*.json` | used by ajv at runtime |
| Generated TypeScript types | `src/schema/generated.ts` | `bun run codegen` |
| Generated Python types | `python/laocoon/schema/` | same command |
| Storage seam | `src/store/event-store.ts` | interface only |
| Git/JSONL event store | `src/store/jsonl-store.ts` | append-only, date-partitioned |
| Crawling seam | `src/crawl/source.ts` | interface only |
| IMAP client | `src/crawl/imap-client.ts` | read-only, hand-written; see below |
| IMAP source | `src/crawl/imap-source.ts` | rate-limited, batched |
| Ingestion | `src/ingest/` | observations, corrections, coverage |
| Reply graph projection | `python/laocoon/reply_graph.py` | networkx |
| CLIs | `src/cli/` | `codegen`, `ingest`, `graph`, `stats` |
| Daily run | `scripts/daily.sh` | not scheduled; see *Not done* |

Commands:

```
bun run codegen                       # schemas -> types, both languages
bun run ingest --list agentproto      # crawl above the watermark
bun run ingest --list agentproto --mode full   # weekly reconciliation
bun run graph --list agentproto       # rebuild the reply graph artifact
bun run stats                         # what the log holds, and what it does not
bun run check                         # typecheck + 36 Bun tests + 11 pytest tests
```

## Measured, on the real corpus

Crawled 2026-08-15 from `imap.ietf.org`, mailbox `Shared Folders/agentproto`,
UIDVALIDITY 1784904078.

- **106 of 106 messages in the mailbox** are in the log. 0 fetch failures, 0
  parse failures, 0 messages missing a `Message-ID`, 0 unparseable `Date`
  headers.
- Sent range **2026-07-24T14:31:43Z → 2026-08-15T05:09:51Z**. 28 distinct sender
  ids. Median body 5209 characters after the list footer and signature are
  stripped; one body is empty.
- **Idempotency holds against the live source.** A full re-crawl of all 106 UIDs
  appended exactly one event — the crawl window — and zero observations.
- **21 of 106 messages carry neither `In-Reply-To` nor `References`.** 9 of those
  21 have a `Re:` subject, spread over 14 distinct sender ids, so this is not one
  broken client. Verified against an independent fetch of UID 28 through the
  `ietf-imap` MCP: its `In-Reply-To` really is empty. The parser is not at fault.
- **3 messages name a parent that is not in this corpus.** Two of the three
  reference the same `mail.gmail.com` id and have `[agent2agent]` in the subject,
  so they are cross-list; one references a `vaara.io` id.
- **24 threads from 82 edges.** Every edge came from `In-Reply-To`; the
  `References` fallback is implemented and unit-tested but contributed **0 edges**
  on this corpus. 11 messages are isolated.
- **11 of the 24 thread roots have a `Re:` subject.** The reply graph is
  materially fragmented, and it is fragmented by the corpus, not by the code —
  the links those messages would need were never sent.

That last figure is the phase-1 result that most affects what comes next. Any
measure built on thread structure is, on this corpus, measuring 24 fragments of a
smaller number of real conversations. Phase 2 has to decide what to do about that
without inventing edges.

## Decisions `PROBLEM.md` did not settle

Each of these is reversible in the sense that a later design can add events; none
is reversible in the sense of un-committing something. That asymmetry drove the
conservative choice in every case.

**Senders appear in the public log as a hash, never as an address.**
`sender_id` is `sha256:` plus the SHA-256 of the lowercased address. The
plaintext address and display name go to `private/senders.jsonl`, which is
gitignored. Rationale: the log is immutable and the repository is public, so a
plaintext address column could never be withdrawn, and a machine-readable list of
IETF participants' addresses is a harvesting surface the Cloudflare-protected
archive is not. The hash is deliberately **unsalted**, so a participant can hash
their own address and identify exactly which rows are theirs — that is what
§8's contestability commitment requires, and a salt would break it.

**Pseudonymity, not anonymity — and the difference matters.** Verified on the
committed log: 89 addr-spec-shaped strings appear in it and all 89 are
`Message-ID`, `In-Reply-To` or `References` values; no sender address is present,
and every `sender_id` is a `sha256:` value. But a `Message-ID` encodes the
sending mail domain, and subject plus timestamp is enough to find the message in
the IETF archive and read the sender off it. So the hash raises the cost of bulk
correlation and removes the harvestable address list; it does not make a
participant unidentifiable, and nothing in this project should be described as if
it does. Hashing `Message-ID` was rejected: it is the graph's node identity, and
a corpus nobody can check is a corpus nobody can contest.

**Message bodies are not stored in the log.** Observations carry a digest and
mechanical shape counts. Full text goes to `.cache/bodies/`, keyed by that
digest, gitignored, so phase-3 classification never has to re-crawl. The corpus
is already published by the IETF; re-publishing it here would add nothing and
could not be undone.

**`event_id` is the SHA-256 of canonical `{event_type, payload}`,** excluding
`observed_at` and `source`. Re-observing an unchanged fact therefore produces a
byte-identical id and appends nothing. This is what makes "deltas only, never
daily snapshots" a property of the format rather than a rule someone has to
remember.

**Partitioned by observation date, not sent date.** `events/YYYY/MM/DD.jsonl`. A
run only ever appends to today's file, so no past partition is ever rewritten.

**No watermark file.** The crawl watermark is derived by replaying the log. There
is nothing that can disagree with the log and nothing to repair after an
interrupted run.

**`artifacts/` is gitignored.** A regenerated full graph committed every day is a
daily full snapshot, which §9 forbids. `bun run graph` rebuilds it in under a
second.

**Own IMAP client instead of `imapflow`.** `imapflow@1.7.1` deadlocks against
`imap.ietf.org`: the server returns a NIL personal namespace, `commands/
namespace.js` then assigns an index on the boolean `false`, and the resulting
exception happens before `response.next()`, so the command queue never drains and
`connect()` never resolves — no error, no output, an unattended job hung forever.
`src/crawl/imap-client.ts` implements only LOGIN, EXAMINE, UID SEARCH, UID FETCH
and LOGOUT, has no command capable of modifying a mailbox, and puts a timeout on
every command so a silent server fails the run instead of hanging it. It also has
to force the `LOGIN` command: `imap.ietf.org` advertises `AUTH=PLAIN` and then
rejects it for the anonymous account.

**`unquoted_lines` is defined, not assumed.** The mailman footer (after a rule of
20+ underscores) and the RFC 3676 signature block are removed first, then lines
beginning with `>` are counted as quoted, and the remaining non-blank lines that
are not a client-generated `… wrote:` attribution are counted as new text. Both
boilerplate blocks otherwise inflate every message identically.

**No subject-line threading.** Only `In-Reply-To` and `References` produce edges.
Subject matching would manufacture edges the corpus does not contain, on the
substrate every later measure sits on. There is a test asserting that two
messages with an identical subject produce no edge.

## Against the four failure modes

- **Provenance.** No field, event, artifact, or code path forms a claim about
  whether a message or account is machine-generated. The nearest thing to text
  analysis in phase 1 is counting lines.
- **Per-person publication.** The public log carries hashes. The reply-graph
  artifact reports `distinct_senders` as a count and has no field that can hold a
  list of participants — there is a test for that. Plaintext identity is confined
  to gitignored `private/`.
- **Manual steps.** There are none. Every number above came from
  `bun run ingest` and `bun run graph`.
- **Mutation.** `ObservationSuperseded` is the only correction mechanism, and the
  superseded event stays in the log byte for byte — there is a test asserting
  exactly that. Projections are regenerated and marked `derived: true`.

## Not done, and not checked

- **Scheduling.** `scripts/daily.sh` exists and runs; no launchd plist is
  installed. Scheduling an unattended job is the operator's call.
- **Other lists.** Only `agentproto` has been crawled. The ~20-list neighbourhood
  in §5 is untouched, and the per-command cost of crawling it has not been
  measured.
- **Datatracker.** No role or authorship data is fetched yet. That is phase 2.
- **UIDVALIDITY change against the real server.** Handled and unit-tested against
  a fixture; never observed live, because the value has not changed.
- **Corpus completeness beyond the mailbox.** The log covers 106 of the 106
  messages the IMAP server reports. Whether the IMAP mailbox itself is a complete
  record of the list was not verified — there is no second source to check it
  against, since `mailarchive.ietf.org` is Cloudflare-blocked.
- **Scale.** Deduplication is an in-memory scan of the whole log on each run.
  Fine at 10^2–10^5 events, wrong past ~10^6; that is where this store should be
  replaced rather than patched.
