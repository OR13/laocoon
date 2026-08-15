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
    ThreadMeasured = 'ThreadMeasured'
    ForecastEvaluated = 'ForecastEvaluated'


ContentHash: TypeAlias = str


SenderId: TypeAlias = str


class Kind(StrEnum):
    imap = 'imap'
    projection = 'projection'
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
    """
    `observation_differs` means the payload we would record now is not the one we recorded before. Ingestion cannot tell whether that is because the source changed or because our own parser was corrected, so it does not claim to: the git history of the parser disambiguates. Asserting "content_changed" would be a guess dressed as a fact.
    """

    observation_differs = 'observation_differs'
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
class Provenance:
    """
    Without these a historical series silently stops being comparable the first time a model or a prompt changes.
    """

    seed_rule_version: str
    classifier_model: str
    prompt_hash: str
    prompt_version: str
    generator: str


@dataclass
class ThreadMeasured:
    """
    The published measure vector for one thread, as of one data horizon.
    This is the only place a substance figure becomes public. The per-message verdicts it aggregates live in the private log, because a per-message quality label joined to the sender_id in this log would be a per-person quality score — forbidden by PROBLEM.md section 7. A per-thread ratio names nobody, and section 7 lists it as published.
    It is an event rather than a projection for one reason: the temporal holdout in section 6 scores at time T and checks at T+7d, which requires the figure computed at T to still exist at T+7d. A regenerated projection would silently become the figure computed later. `measured_at` is therefore the **data horizon** — the point in time the inputs were cut off at — not the wall clock, so recomputing the same horizon produces the same event id and appends nothing.
    Measures are a vector. There is no composite score here and there must not be one: PROBLEM.md section 7 rules it out, because a single number invites an argument about weights that cannot be won.
    """

    thread_id: str
    list_name: str
    subject: str
    measured_at: str
    window_days: int
    new_participant_window_days: int
    messages_total: int
    distinct_senders: int
    max_depth: int
    reply_pairs: int
    mean_branching_factor: float
    messages_in_window: int
    distinct_senders_in_window: int
    replies_classified: int
    substantive_replies: int
    hollow_replies: int
    unclear_replies: int
    unclassified_replies: int
    substantive_reply_ratio: float | None
    quoting_reply_ratio: float | None
    seeded_participants: int
    new_participants: int
    new_participant_share: float | None
    max_core_number: int
    mean_core_number: float
    provenance: Provenance


@dataclass
class ForecastEvaluated:
    """
    The system scoring itself. PROBLEM.md section 6 converts validation into forecasting: rank threads at time T, then check at T+7d whether the engagement actually materialised. That is objectively scorable with no human input and no hand labelling.
    Every run records a baseline alongside the forecaster being tested. A correlation is meaningless without the trivial predictor to compare it to — if reputation-weighted engagement does not beat recent reply count, that is the finding, and it must be visible rather than absent.
    """

    origin_at: str
    horizon_days: int
    forecaster: str
    is_baseline: bool
    threads_scored: int
    threads_with_engagement: int
    spearman: float | None
    p_value: float | None
    precision_at_3: float | None
    actual_metric: str
    generator: str


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
    payload: MessageObserved | CrawlWindowCompleted | ObservationSuperseded | ThreadMeasured | ForecastEvaluated
