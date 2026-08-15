# GENERATED FILE - DO NOT EDIT.
# Source of truth: schemas/*.yaml. Regenerate with `bun run codegen`.

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Literal


@dataclass
class Generator:
    name: str
    version: str


@dataclass
class Window:
    list_name: str
    mode: str
    started_at: str
    completed_at: str
    mailbox_total: int
    uids_examined: int
    failure_count: int


@dataclass
class Coverage:
    """
    The crawl coverage this graph rests on, carried into the artifact so that any figure derived from it can state what it did and did not see.
    """

    lists: list[str]
    event_count: int
    message_event_count: int
    windows: list[Window]
    observed_from: str | None = None
    observed_to: str | None = None
    sent_from: str | None = None
    sent_to: str | None = None


@dataclass
class Body:
    chars: int
    quoted_lines: int
    unquoted_lines: int


@dataclass
class Node:
    message_id: str
    list_name: str
    uid: int
    sender_id: str
    sent_at: str | None
    subject: str
    thread_id: str
    depth: int
    in_degree: int
    out_degree: int
    body: Body


class Via(StrEnum):
    """
    Which header the edge was read from. in_reply_to is the direct claim; references is the fallback when In-Reply-To is absent or dangling.
    """

    in_reply_to = 'in_reply_to'
    references = 'references'


@dataclass
class Edge:
    child: str
    parent: str
    via: Via


@dataclass
class Thread:
    thread_id: str
    list_name: str
    subject: str
    message_count: int
    distinct_senders: int
    max_depth: int
    mean_branching_factor: float
    started_at: str | None
    last_message_at: str | None
    reply_pairs: int


@dataclass
class Diagnostics:
    """
    Everything the graph could not do, stated as counts. A projection that hides its gaps is worse than no projection.
    """

    messages_total: int
    messages_superseded_skipped: int
    messages_without_message_id: int
    messages_without_threading_headers: int
    duplicate_message_ids: int
    dangling_parent_refs: int
    edges_from_in_reply_to: int
    edges_from_references: int
    roots: int
    thread_count: int
    isolated_messages: int


@dataclass
class ReplyGraph:
    """
    A projection of the event log: the directed reply graph for one or more lists, plus the coverage it was built from and the diagnostics that say how complete it is. This artifact is derived and regenerable. It is never authoritative and is never committed; delete it and re-run the projection.
    Edges come only from In-Reply-To and References. Subject-line threading is deliberately absent: it invents edges the corpus does not contain. Messages with no threading headers are reported as a count, not repaired.
    """

    schema_version: str
    derived: Literal[True]
    publication: Literal['private']
    generated_at: str
    generator: Generator
    coverage: Coverage
    nodes: list[Node]
    edges: list[Edge]
    threads: list[Thread]
    diagnostics: Diagnostics
