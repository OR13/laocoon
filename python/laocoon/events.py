"""Reading and replaying the event log from the Python side.

This mirrors the TypeScript replay deliberately rather than importing it: the two
runtimes are separated by JSON on disk, and the log is the contract between them.
Both sides read the same generated schema, so a divergence is a schema change,
not a silent drift.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator


@dataclass
class Replay:
    """Live observations and the coverage they came from."""

    events_total: int = 0
    by_type: dict[str, int] = field(default_factory=dict)
    #: MessageObserved payloads that no later event supersedes.
    messages: list[dict[str, Any]] = field(default_factory=list)
    #: Every CrawlWindowCompleted payload, in log order.
    windows: list[dict[str, Any]] = field(default_factory=list)
    superseded_skipped: int = 0
    observed_from: str | None = None
    observed_to: str | None = None


def iter_events(events_dir: Path) -> Iterator[dict[str, Any]]:
    """Yield every event in chronological partition order.

    Partitions are ``YYYY/MM/DD.jsonl``, so lexicographic path order is
    chronological order.
    """
    for path in sorted(events_dir.rglob("*.jsonl")):
        with path.open("r", encoding="utf-8") as handle:
            for line_no, line in enumerate(handle, start=1):
                if not line.strip():
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"corrupt event log line {path}:{line_no}") from exc


def replay(events_dir: Path, lists: set[str] | None = None) -> Replay:
    """Replay the log into live observations.

    Two passes: the first collects the set of superseded ``event_id`` values, the
    second keeps only the observations that survive. A single pass would have to
    guess whether a correction is still coming.
    """
    superseded: set[str] = set()
    for event in iter_events(events_dir):
        if event["event_type"] == "ObservationSuperseded":
            superseded.add(event["payload"]["superseded_event_id"])

    out = Replay()
    for event in iter_events(events_dir):
        out.events_total += 1
        kind = event["event_type"]
        out.by_type[kind] = out.by_type.get(kind, 0) + 1

        observed_at = event["observed_at"]
        if out.observed_from is None or observed_at < out.observed_from:
            out.observed_from = observed_at
        if out.observed_to is None or observed_at > out.observed_to:
            out.observed_to = observed_at

        payload = event["payload"]
        if kind == "MessageObserved":
            if lists is not None and payload["list_name"] not in lists:
                continue
            if event["event_id"] in superseded:
                out.superseded_skipped += 1
                continue
            out.messages.append(payload)
        elif kind == "CrawlWindowCompleted":
            if lists is not None and payload["list_name"] not in lists:
                continue
            out.windows.append(payload)

    return out
