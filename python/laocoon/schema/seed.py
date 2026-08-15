# GENERATED FILE - DO NOT EDIT.
# Source of truth: schemas/*.yaml. Regenerate with `bun run codegen`.

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Literal


@dataclass
class Counts:
    """
    The funnel from list participants to seed members. `no_datatracker_record` is reported as a fact and never as an inference about why, per section 8.
    """

    addresses_seen: int
    resolved_to_person: int
    no_datatracker_record: int
    records_available: int
    seeded: int
    unseeded: int


@dataclass
class Member:
    sender_id: str
    person_id: int
    clauses: list[str]


class Reason(StrEnum):
    not_resolved = 'not_resolved'
    no_datatracker_record = 'no_datatracker_record'
    record_missing = 'record_missing'
    no_clause_matched = 'no_clause_matched'


@dataclass
class UnseededItem:
    sender_id: str
    reason: Reason
    person_id: int | None = None


@dataclass
class Seed:
    """
    The community-conferred seed set: the accounts reputation propagation starts from. A projection of the private log through the rule in `src/seed/rule.ts`, which is published as prose in `docs/seed-rule.md`.
    Private. Membership is a label attached to an identifiable person, and section 7 of PROBLEM.md keeps those out of publication. It does not need to be published to be contestable: the rule is public and the datatracker is public, so anyone can recompute this file and disagree with it.
    This is also the seam between the two runtimes. The rule lives in TypeScript and is applied here; the Python side consumes this artifact and never re-implements the rule, so the two cannot drift.
    """

    schema_version: str
    derived: Literal[True]
    publication: Literal['private']
    generated_at: str
    seed_rule_version: str
    counts: Counts
    members: list[Member]
    unseeded: list[UnseededItem]
    clause_counts: dict[str, int] | None = None
