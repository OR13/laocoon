# Phase 2 — reputation propagation and cluster detection

PROBLEM.md §11 item 2. What was built, what it found on the real corpus, and the
decisions §11 left open.

Phase 1 is [`docs/phase-1.md`](phase-1.md). The seed rule has its own published
page: [`docs/seed-rule.md`](seed-rule.md).

## What exists

| Piece | Where |
| --- | --- |
| Private event schema | `schemas/private-event.yaml` |
| Datatracker client (keyless, rate-limited) | `src/datatracker/client.ts` |
| Identity resolution → private log | `src/datatracker/resolve.ts` |
| The seed rule | `src/seed/rule.ts`, published in `docs/seed-rule.md` |
| Seed projection | `src/cli/seed.ts` → `private/artifacts/seed.json` |
| Propagation + clustering | `python/laocoon/reputation.py` |
| Artifact schemas | `schemas/seed.yaml`, `account-reputation.yaml`, `community-structure.yaml` |

```
bun run resolve      # addresses -> datatracker people, into private/events/
bun run seed         # apply the rule -> private/artifacts/seed.json
bun run reputation   # propagate + cluster -> private + aggregate artifacts
```

## Measured, on the real corpus

`agentproto`, 106 messages, 28 accounts, resolved 2026-08-15.

**Resolution.** 28 addresses queried, **23 matched** a Datatracker person, **5
have no record**. 212 API requests, **0 failures**.

**Seed.** **11 of 28 accounts** hold community-conferred standing. Of the 17 that
do not, 5 have no Datatracker record and 12 have a record that no clause matched.
Every seeded account matched `wg_chair_past`, `rfc_author` and
`adopted_wg_document_author`; six matched all six clauses. The population is
bimodal, so on this corpus the six-clause rule behaves like a one-clause rule —
robust, but its discrimination is untested at this size.

> **Corrected 2026-08-16.** That last sentence was an artifact of 11 seeded
> accounts, and it does not survive the second list. Recomputed at **86 seeded
> of 204 addresses**, no clause is matched by every member: `wg_chair_past`
> covers 53 and `rfc_author` 64, against the 84 covered by
> `adopted_wg_document_author`. Members are spread across how many clauses they
> match — 17 match exactly one, 15 two, 7 three, 26 four, 9 five, 12 all six —
> where at n=28 the distribution was two spikes. The rule is not
> interchangeable with its widest clause either: dropping the other five would
> lose 2 members, and 16 of the 17 single-clause members are held by
> `adopted_wg_document_author` alone, so the clauses that look redundant are
> carrying the accounts the widest one misses. The original numbers are left
> above unedited, because a corrected document that hides what it used to say
> is worse than a wrong one.

**Account graph.** 28 accounts, 58 directed edges, density 0.077. 2 self-reply
edges dropped. All 11 seed members had posted, so propagation restarts on all of
them.

**Weighting.** Personalized PageRank was run twice — over all replies, and over
only replies that quote. Spearman correlation between the two rankings is
**0.974** (n=28). The choice of weighting is not driving the result on this
corpus, which is the answer that lets phase 3's substance classifier be judged on
its own merits rather than confounded with the quoting proxy.

**Clusters.** Louvain found **8 communities, modularity 0.373** — modest, and
weak enough that the partition should not be read as strong structure at n=28.

| size | internal edges | external edges | external ratio | contains seed member | max core |
| ---: | ---: | ---: | ---: | :--- | ---: |
| 8 | 19 | 18 | 0.49 | yes | 4 |
| 7 | 11 | 10 | 0.48 | yes | 4 |
| 5 | 5 | 0 | 0.00 | yes | 1 |
| 3 | 3 | 10 | 0.77 | no | 4 |
| 2 | 1 | 0 | 0.00 | yes | 1 |
| 1 | 0 | 0 | 0.00 | yes | 0 |
| 1 | 0 | 0 | 0.00 | no | 0 |
| 1 | 0 | 0 | 0.00 | no | 0 |

## The negative result

**The pattern this project exists to detect is not present in this corpus.**

PROBLEM.md §3 names the target: a mutually-reinforcing cluster that does not
connect to the rest of the group. That shape is a community with no seed member
*and* a low external-edge ratio. Three communities contain no seed member, and
none of them is that shape:

- the size-3 one has an external-edge ratio of **0.77** — it is the most
  outward-facing group in the corpus, the opposite of self-reinforcing;
- the other two are **single accounts with no edges at all** — people who posted
  and drew no reply, and replied to nobody. That is isolation, not a clique.

The one community that talks only to itself (size 5, external ratio 0.00)
**contains a seed member**.

So: no isolated mutually-reinforcing cluster at n=106. The detector runs, the
measures compute, and the honest report is that there is nothing here to find
yet. A detector that has never fired on real data is also a detector that has not
been shown to work — see *Not checked* below.

## Decisions PROBLEM.md left open

**Two logs, not one.** Identity resolution de-pseudonymises: "sender_id X is
person 105857" turns the public log's hashes into named people, and §7 keeps
labels attached to named individuals unpublished. So `SenderResolved` and
`DatatrackerRecordFetched` go to a second append-only log at `private/events/`,
gitignored, with its own schema. The store interface from phase 1 took the second
implementation without a change; `JsonlEventStore` now takes the schema name, so
a private record appended to the public log fails validation rather than
succeeding quietly.

**The rule is published, the membership is not.** §7 says the seed rule is
published; it does not say the membership is, and membership is per-person. The
rule is in `docs/seed-rule.md` and the membership is in gitignored
`private/artifacts/seed.json`. Contestability is unharmed: the rule is public,
the Datatracker is public and keyless, and the message ids are in the committed
log, so anyone can recompute the membership and disagree.

**Facts are events; the rule is a projection.** The private log stores what the
Datatracker said, never what the rule concluded. Re-deciding the rule is a re-run
of `bun run seed`, never a re-crawl and never an edit to an event.

**Every artifact declares who may see it.** Artifacts now carry a required
`publication` field, `private` or `aggregate_public`, so a publishing step can
refuse mechanically. This caught a real problem: **`artifacts/reply-graph.json`
carries `sender_id` on every node**, so publishing it as-is would hand anyone a
ranked participant list. It is now marked `private`, and phase 4 must derive a
redacted thread-level view rather than publishing the graph. `bun run reputation`
additionally refuses to write per-account output anywhere outside `private/`, and
greps its own aggregate output for a sender hash before declaring success.

**Both weightings, no blend.** §4 asks the reply graph to be weighted by whether
a reply engages with specific text. The quoting half is mechanical now; the
"responds rather than restates" half is phase 3. Rather than invent a blending
constant, both weightings are computed and their rank correlation is reported.

**Self-replies are dropped.** Answering your own message is not evidence of
anyone else's engagement. Dropped and counted, not silently included.

**Restarting on an empty seed is an error.** Personalized PageRank with no seed
present degenerates to uniform PageRank, which looks like a result. It raises
instead, and there is a test for it.

## Not done, and not checked

- **The cluster detector has never fired on a positive case.** It is unit-tested
  against synthetic graphs, and on real data it correctly reported *nothing*.
  Whether it would identify a real mutually-reinforcing cluster is untested,
  because this corpus does not contain one.
- **Modularity 0.373 at n=28 is weak.** The partition is reported with that
  caveat and should not carry weight until the corpus is larger.
- **Only `agentproto`.** Cross-list posting history — the ~20-list neighbourhood
  in §5 — is still uncrawled, and it is the signal most likely to change the
  account graph's shape.
- **Datatracker records are a point-in-time snapshot.** Roles change. Nothing
  re-fetches them on a schedule yet; `bun run resolve --refresh` does it manually.
- **Namesake risk is unmeasured.** Resolution is by email address, which avoids
  the name-join attack §5 rejects, but a person with several addresses appears as
  several accounts. No merging is attempted, and how often that happens here was
  not measured.
- **No temporal holdout.** Validating that these measures predict later
  engagement is phase 3.
