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

Phase 1 built: schema and codegen, the append-only event store, ingestion of the
`agentproto` corpus, and the reply graph. 106 of the 106 messages in the IMAP
mailbox are in the log, with no fetch or parse failures. No measures are
published, no scores exist, and the site is not up.

The phase-1 write-up — what was measured, what was decided, and what was not
checked — is [`docs/phase-1.md`](docs/phase-1.md).

```
bun install
LAOCOON_IMAP_EMAIL=you@example.org bun run ingest --list agentproto
bun run graph --list agentproto
bun run stats
bun run check          # typecheck, Bun tests, pytest
```

## Corrections

If something here mischaracterises a discussion you took part in, please open a
GitHub issue. Every number traces to a file in this repository, so a correction is
a diff.
