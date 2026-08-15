# GENERATED FILE - DO NOT EDIT.
# Source of truth: schemas/*.yaml. Regenerate with `bun run codegen`.

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import TypeAlias


class EventType(StrEnum):
    MessageObserved = 'MessageObserved'
    CrawlWindowCompleted = 'CrawlWindowCompleted'
    ObservationSuperseded = 'ObservationSuperseded'


ContentHash: TypeAlias = str


SenderId: TypeAlias = str


class Kind(StrEnum):
    imap = 'imap'
    fixture = 'fixture'


@dataclass
class SourceRef:
    """
    Where an observation came from. The crawler sits behind an interface; this records which implementation actually produced the fact.
    """

    kind: Kind
    name: str
    mailbox: str | None = None


MessageId: TypeAlias = str


@dataclass
class BodyShape:
    """
    Mechanical shape of the plain-text body. Every field here is countable without judging the text. Whether a reply is substantive is a separate, model-derived record introduced in phase 3, never a field on this event.
    """

    sha256: ContentHash
    chars: int
    lines: int
    quoted_lines: int
    unquoted_lines: int


class Mode(StrEnum):
    """
    incremental walks UIDs above the watermark; full re-examines the whole mailbox and can emit ObservationSuperseded.
    """

    incremental = 'incremental'
    full = 'full'


@dataclass
class Failure:
    uid: int
    reason: str


@dataclass
class CrawlWindowCompleted:
    """
    What one crawl actually covered. Emitted on every run, successful or not, so a gap in coverage is a visible fact instead of a silent absence. Every published figure must be able to cite the windows it rests on.
    """

    list_name: str
    mode: Mode
    started_at: str
    completed_at: str
    uid_validity: int
    mailbox_total: int
    watermark_before: int | None
    watermark_after: int | None
    uids_examined: int
    messages_new: int
    messages_unchanged: int
    messages_superseded: int
    failures: list[Failure]
    uid_min_seen: int | None = None
    uid_max_seen: int | None = None


class Reason(StrEnum):
    content_changed = 'content_changed'
    uid_validity_changed = 'uid_validity_changed'


@dataclass
class ObservationSuperseded:
    """
    A previously recorded observation no longer matches the source. The earlier event stays in the log untouched; this event is the correction. Projections must ignore any MessageObserved that a later event supersedes.
    """

    list_name: str
    uid: int
    uid_validity: int
    superseded_event_id: ContentHash
    superseding_event_id: ContentHash
    reason: Reason


@dataclass
class MessageObserved:
    """
    Structural facts about one message as seen in one mailbox. Message bodies are NOT stored here: only a digest and shape counts. The corpus is already published by the IETF; re-publishing it in this repository would add nothing and could not be undone, because the log is immutable.
    """

    list_name: str
    uid: int
    uid_validity: int
    message_id: MessageId | None
    in_reply_to: list[MessageId]
    references: list[MessageId]
    subject: str
    sent_at: str | None
    sent_at_raw: str
    sender_id: SenderId
    body: BodyShape


@dataclass
class Event:
    """
    An immutable observed fact in the LAOCOON event log. Events are append-only and are never edited; a correction is a new compensating event. Everything else in the system (graphs, measures, the site) is a regenerable projection of this log.
    `event_id` is the SHA-256 of the canonical JSON of `{event_type, payload}` and therefore excludes `observed_at`. Re-observing an unchanged fact produces the same `event_id`, so a re-crawl appends nothing. This is what keeps the log a stream of deltas rather than a daily snapshot.
    """

    event_id: ContentHash
    event_type: EventType
    schema_version: str
    observed_at: str
    source: SourceRef
    payload: MessageObserved | CrawlWindowCompleted | ObservationSuperseded
