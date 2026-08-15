# The community-conferred seed rule

**Version 1.0.0.** This page is the published rule. It is implemented in
[`src/seed/rule.ts`](../src/seed/rule.ts), which is a pure function of facts
fetched from the public IETF Datatracker API, and it is exercised by
[`tests/seed-rule.test.ts`](../tests/seed-rule.test.ts).

Reputation propagation has to start somewhere. If it started from a
hand-maintained list of people the author trusts, the whole system would be an
elaborate restatement of one person's opinion. Instead it starts from standing
that **the IETF community conferred**, computed from a rule, recomputed on every
run, and never edited by hand.

## What seeds

An account seeds if **any** of these matched at the time of the last fetch. Every
clause requires an act by someone other than the participant.

| Clause | Test | Datatracker query |
| --- | --- | --- |
| `wg_chair_current` | Holds a `chair` role in a group of type `wg` | `group/role/?person=P&name=chair&group__type=wg` |
| `wg_chair_past` | Held one historically | `group/rolehistory/?person=P&name=chair&group__type=wg` |
| `area_director` | Holds or held an `ad` role | `group/role/` and `group/rolehistory/?person=P&name=ad` |
| `iab_or_iesg` | Holds or held any role in `iab` or `iesg` | `…?person=P&group__acronym__in=iab,iesg` |
| `rfc_author` | Authored at least one document of type `rfc` | `doc/documentauthor/?person=P&document__type=rfc` |
| `adopted_wg_document_author` | Authored a document named `draft-ietf-*` | `doc/documentauthor/?person=P&document__group__type=wg`, then the name is tested |

## What does not seed, and why

**Individual submissions.** A `draft-<name>-*` document is standing the author
conferred on themselves: anyone may submit one, and no working group had to agree
to anything. Admitting it would make the seed forgeable by the very behaviour the
system exists to be robust against. This is the single most load-bearing
exclusion in the rule, and there is a test named after it.

**The address `origin` field.** The Datatracker records how an address entered
the system — often `author: draft-<name>-foo`. It is recorded on the
`SenderResolved` event because it is informative, and it is deliberately not
consulted by the rule, for the same reason.

**Having a Datatracker record at all.** Registering is self-service.

**Chairing something that is not a working group.** The rule as written follows
PROBLEM.md §4, which names working group chairs. Research group chairs and other
group types are outside it. This is a defensible narrowing rather than an obvious
one, and it is the clause most likely to be worth revisiting.

**Employer, affiliation, domain, external credentials.** Out of scope entirely,
per PROBLEM.md §5.

## What the rule is not

It is **not** a measure of who is worth listening to. Plenty of valuable
contributors hold no community-conferred role, and the fairness commitment in
PROBLEM.md §8 is explicit that new participants are described and never ranked.
The seed exists because propagation needs a starting distribution that cannot be
manufactured by the thing being measured — nothing more.

It also says nothing about provenance. No clause, and no fact any clause reads,
concerns whether anything was machine-generated.

## Where the membership lives

The rule is public; the membership it produces is not. A list mapping accounts to
"has community-conferred standing" is a label attached to identifiable people,
which PROBLEM.md §7 keeps unpublished. It sits in `private/artifacts/seed.json`,
which is gitignored.

That costs nothing in contestability. The rule is on this page, the Datatracker
is public and keyless, and the message identifiers are in the committed event
log — so anyone can recompute the membership and disagree with it, without this
repository hosting a list of names.

## What it produced on the first run

Against the `agentproto` corpus on 2026-08-15 — 28 accounts that had posted:

- **11 seeded**, 17 not.
- Of the 17: **5 have no Datatracker record**, and 12 have one that no clause
  matched. "No record" is reported as a fact about a lookup and never as an
  inference about why.
- Every one of the 11 matched `wg_chair_past`, `rfc_author` **and**
  `adopted_wg_document_author`. Six matched all six clauses.

That last line matters more than it looks: on this corpus the six clauses
collapse to roughly one, because the population is sharply bimodal — a
participant either has a long IETF history with all of these, or none of them. No
single clause is load-bearing, so the seed is robust to any one of them being
wrong; equally, the rule's discrimination is untested here and would only show on
a larger, more mixed corpus.

## Changing the rule

Bump `SEED_RULE_VERSION`, and edit this page in the same commit. Every artifact
downstream records the version it was computed under, so a series computed under
two different rules is never silently compared. Changing the rule never requires
re-crawling and never edits an event: the facts stay, the projection is re-run.
