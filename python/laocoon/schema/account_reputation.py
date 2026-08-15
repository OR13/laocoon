# GENERATED FILE - DO NOT EDIT.
# Source of truth: schemas/*.yaml. Regenerate with `bun run codegen`.

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass
class Generator:
    name: str
    version: str


@dataclass
class Graph:
    accounts: int
    edges: int
    self_reply_edges_dropped: int
    seed_accounts_in_graph: int


@dataclass
class Account:
    sender_id: str
    seeded: bool
    clauses: list[str]
    ppr_replies: float
    ppr_quoting: float
    rank_replies: int
    rank_quoting: int
    community: int
    core_number: int
    replies_received: float
    replies_sent: float


@dataclass
class WeightingAgreement:
    """
    Rank correlation between the two weightings. Low agreement means the choice of weighting is doing the work rather than the data, and the result should not be trusted until the phase-3 substance classifier settles it.
    """

    spearman: float | None
    n: int


@dataclass
class AccountReputation:
    """
    Per-account reputation and graph position. **Private, permanently.** This is a ranked participant list, which PROBLEM.md section 7 keeps out of publication; the marker `publication: private` is here so a publishing step can refuse it mechanically rather than by anyone remembering.
    Scores are personalized PageRank restarted on the community-conferred seed, over account edges that point from a replier to the author they replied to. They measure reception and graph position. They are not a judgement about a person's competence, their good faith, or the provenance of anything they wrote, and nothing downstream may present them as one.
    """

    schema_version: str
    derived: Literal[True]
    publication: Literal['private']
    generated_at: str
    generator: Generator
    seed_rule_version: str
    damping: float
    graph: Graph
    accounts: list[Account]
    weighting_agreement: WeightingAgreement
