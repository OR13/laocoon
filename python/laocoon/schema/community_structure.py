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
class Accounts:
    """
    Composition of the list's participants against the seed rule. Counts only. "No datatracker record" is a fact about a lookup, never an inference about why, per section 8.
    """

    total: int
    seeded: int
    no_datatracker_record: int
    resolved_but_unseeded: int


@dataclass
class Graph:
    accounts: int
    edges: int
    density: float
    self_reply_edges_dropped: int


@dataclass
class Community:
    index: int
    size: int
    internal_edges: int
    external_edges: int
    external_edge_ratio: float
    contains_seed_member: bool
    max_core_number: int


@dataclass
class CommunitiesWithoutSeedMember:
    count: int
    accounts: int


@dataclass
class WeightingAgreement:
    spearman: float | None
    n: int


@dataclass
class CommunityStructure:
    """
    The account graph's shape, with no account in it. Community sizes, how much each community talks outside itself, whether it contains anyone holding community-conferred standing, and how well the two edge weightings agree.
    Marked `aggregate_public`: nothing here identifies a participant, so it is the kind of thing PROBLEM.md section 7 allows to be published. That is a permission, not an instruction — publication still happens only in phase 4 and only by an explicit decision.
    A community with no seed member and a low external-edge ratio is the pattern section 3 exists to surface: a group that mostly replies to itself and does not connect to the rest of the list. That is a statement about a subgraph. It is not a claim that anyone in it is acting in bad faith, and it is emphatically not a claim about whether anything was machine-generated.
    """

    schema_version: str
    derived: Literal[True]
    publication: Literal['aggregate_public']
    generated_at: str
    generator: Generator
    seed_rule_version: str
    accounts: Accounts
    graph: Graph
    modularity: float
    communities: list[Community]
    communities_without_seed_member: CommunitiesWithoutSeedMember
    weighting_agreement: WeightingAgreement
