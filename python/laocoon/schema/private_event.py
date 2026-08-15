# GENERATED FILE - DO NOT EDIT.
# Source of truth: schemas/*.yaml. Regenerate with `bun run codegen`.

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import TypeAlias


class EventType(StrEnum):
    SenderResolved = 'SenderResolved'
    DatatrackerRecordFetched = 'DatatrackerRecordFetched'
    MessageClassified = 'MessageClassified'
    ListStewardsFetched = 'ListStewardsFetched'


ContentHash: TypeAlias = str


class Kind(StrEnum):
    datatracker = 'datatracker'
    ollama = 'ollama'
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


class Verdict(StrEnum):
    """
    `unclear` is the model declining to judge; `error` is the pipeline failing to get an answer. They are different facts and are never collapsed.
    """

    substantive = 'substantive'
    hollow = 'hollow'
    unclear = 'unclear'
    error = 'error'


@dataclass
class MessageClassified:
    """
    One model's verdict on whether one reply engages with the message it answers. Private, and necessarily so: a per-message quality label joined to the sender_id in the public log yields a per-person quality score in one line, which PROBLEM.md section 7 forbids publishing. What gets published is the per-thread ratio, carried by a `ThreadMeasured` event in the public log.
    The verdict concerns the relationship between two texts and nothing else. There is no field here, and no question in the prompt, about who wrote either message or how. Recording a provenance judgement would be outside what this project is allowed to do, not merely unused.
    `body_sha256` ties the verdict to the exact text judged, so a re-observed message whose body changed does not silently keep an obsolete label.
    """

    message_id: str
    list_name: str
    parent_message_id: str
    model: str
    prompt_hash: str
    prompt_version: str
    verdict: Verdict
    reason: str
    body_sha256: str
    parent_body_sha256: str
    classified_at: str
    duration_ms: int


@dataclass
class Steward:
    role: str
    person_id: int
    address: str
    sender_id: str


@dataclass
class ListStewardsFetched:
    """
    Who currently manages one list: its chairs, area directors and moderators, as the Datatracker reports them.
    Distinct from the community-conferred seed on purpose. The seed is *global* standing — chaired any working group, ever — and answers "did anyone established engage". Stewards are *this list's* current role holders and answer "did the people responsible for this discussion engage". A thread with high seed engagement and zero steward engagement is a discussion the people accountable for it have not touched, and merging the two would hide exactly that.
    A list may have no stewards at all, which is a fact about the list rather than a gap: a plain mailing list with no IETF group has no chairs to find. `group_found: false` records that, and it is never inferred as absence of oversight.
    """

    list_name: str
    group_acronym: str
    group_found: bool
    stewards: list[Steward]
    fetched_at: str
    endpoints: list[str]
    group_id: int | None = None
    group_type: str | None = None
    group_state: str | None = None
    charter_document: str | None = None


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
    payload: SenderResolved | DatatrackerRecordFetched | MessageClassified | ListStewardsFetched
