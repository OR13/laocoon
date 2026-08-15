# LAOCOÖN

> **Experimental.** This is a personal research project by Orie Steele. It is
> **not** an IETF product, not a working group deliverable, and not a statement
> made in any chair capacity. Nothing here represents IETF consensus.

LAOCOÖN measures the **structure of engagement** in IETF mailing list
discussions, to answer one question: on a given technical point, which positions
actually have support, and which only have volume?

It does **not** detect AI-generated text. Provenance is explicitly out of scope —
the system never forms or publishes the claim that an account or message is
machine-generated. It measures reception: whether content draws substantive
engagement from the broader group, or only from an isolated cluster that engages
with itself.

**Read [`PROBLEM.md`](PROBLEM.md) first.** It states the problem, the method, what
is deliberately excluded and why, how the system validates itself, and what is
published versus kept private. It is the contract this project is built against.

## Commitments

- **Structure is published; people are not scored in public.** Per-thread and
  aggregate measures are public. Per-person quality scores are not.
- **New participants are described, never ranked.** Account age and history
  structurally punish newcomers, and the IETF depends on them.
- **Every published figure is auditable.** Each derives from an event committed to
  this repository. If one is wrong, open an issue against it.
- **The system publishes its own accuracy.** Measures are validated by whether
  they predict subsequent engagement, and the hit rate is published alongside
  them.

## Status

Phases 1 and 2 built. Nothing is published, and the site is not up.

- **Phase 1** — schema and codegen, the append-only event store, ingestion, the
  reply graph. 106 of the 106 messages in the IMAP mailbox are in the log, no
  fetch or parse failures. [`docs/phase-1.md`](docs/phase-1.md).
- **Phase 2** — identity resolution against the Datatracker, the
  community-conferred seed, reputation propagation, cluster detection. 11 of 28
  accounts seeded. No mutually-reinforcing isolated cluster exists in this
  corpus — the honest result is that there is nothing there to find yet.
  [`docs/phase-2.md`](docs/phase-2.md).
- **Phase 3** — substance classification and the temporal holdout. The
  classifier called 81 of 82 replies substantive and none hollow, so the
  substance measure carries no information here and is numerically identical to
  raw reply volume. Participation by accounts with community-conferred standing
  is the only forecaster that ever beats that baseline.
  [`docs/phase-3.md`](docs/phase-3.md).
- **Phase 4** — the dashboard. Built and running locally; **not deployed**.
  [`docs/phase-4.md`](docs/phase-4.md).

The seed rule is published in full: [`docs/seed-rule.md`](docs/seed-rule.md).

```
bun install
LAOCOON_IMAP_EMAIL=you@example.org bun run ingest --list agentproto
bun run graph --list agentproto
bun run resolve && bun run seed && bun run reputation --list agentproto
bun run classify && bun run agreement
bun run measure --list agentproto
bun run holdout --list agentproto --horizon-days 2 --origin-step-days 1
bun run site            # writes site/, deploys nothing
bun run stats
bun run check          # typecheck, Bun tests, pytest
```

Per-person data — addresses, Datatracker identities, reputation scores, seed
membership — is written only under `private/`, which is gitignored. Artifacts
declare a `publication` field, and the publishing path refuses anything marked
`private`.

## Corrections

If something here mischaracterises a discussion you took part in, please open a
GitHub issue. Every number traces to a file in this repository, so a correction is
a diff.
