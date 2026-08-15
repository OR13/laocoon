# GENERATED FILE - DO NOT EDIT.
# Source of truth: schemas/*.yaml. Regenerate with `bun run codegen`.

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import TypeAlias


class EventType(StrEnum):
    SenderResolved = 'SenderResolved'
    DatatrackerRecordFetched = 'DatatrackerRecordFetched'


ContentHash: TypeAlias = str


class Kind(StrEnum):
    datatracker = 'datatracker'
    fixture = 'fixture'


@dataclass
class PrivateSourceRef:
    kind: Kind
    name: str
    mailbox: str | None = None


class Resolution(StrEnum):
    matched = 'matched'
    no_record = 'no_record'


@dataclass
class SenderResolved:
    """
    An address seen on a list, mapped to a datatracker person — or explicitly mapped to nothing. "No datatracker record" is recorded as a fact, never as an inference about why, per PROBLEM.md section 8.
    """

    sender_id: str
    address: str
    person_id: int | None
    resolution: Resolution
    origin: str


@dataclass
class RoleFact:
    """
    One role, recorded as the query that found it rather than as a resolved group object. The datatracker can filter roles by group type and acronym directly, so the group's type is known by construction and no extra per-group request is made.
    """

    role: str
    group_ref: str
    group_type: str
    current: bool


@dataclass
class DatatrackerRecordFetched:
    """
    What the datatracker said about one person at one moment. Facts only; the seed rule is applied later, as a projection, so re-deciding the rule never requires re-crawling and never rewrites history.
    """

    person_id: int
    fetched_at: str
    chair_roles: list[RoleFact]
    ad_roles: list[RoleFact]
    iab_iesg_roles: list[RoleFact]
    rfc_authorships: int
    wg_document_authorships: list[str]
    endpoints: list[str]


@dataclass
class PrivateEvent:
    """
    An immutable observed fact that must never be published. Same append-only discipline as the public log, different destination: `private/events/`, which is gitignored.
    These events exist because identity resolution de-pseudonymises. A record saying "sender_id X is datatracker person 105857" turns the public log's hashes into named individuals, and PROBLEM.md section 7 keeps any label attached to a named individual out of publication. Nothing derived from this log may be published except as an aggregate that names nobody.
    The community-conferred seed is computed from these facts. The seed *rule* is published (docs/seed-rule.md); the seed *membership* is not, and does not have to be — anyone can recompute it from the published rule and the same public datatracker API, which is what makes it contestable.
    """

    event_id: ContentHash
    event_type: EventType
    schema_version: str
    observed_at: str
    source: PrivateSourceRef
    payload: SenderResolved | DatatrackerRecordFetched
