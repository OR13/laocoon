"""Tests for the reply-graph projection.

The interesting cases are all failures of the corpus rather than of the code: a
parent that was never crawled, a client that omitted In-Reply-To, a message with
no threading headers at all. The projection must report each as a count and
attach nothing it cannot justify.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from laocoon.events import replay
from laocoon.reply_graph import build

SENDER_A = "sha256:" + "a" * 64
SENDER_B = "sha256:" + "b" * 64


def message(
    uid: int,
    message_id: str | None,
    *,
    in_reply_to: list[str] | None = None,
    references: list[str] | None = None,
    sender: str = SENDER_A,
    sent_at: str | None = None,
) -> dict:
    return {
        "list_name": "testlist",
        "uid": uid,
        "uid_validity": 1,
        "message_id": message_id,
        "in_reply_to": in_reply_to or [],
        "references": references or [],
        "subject": f"subject {uid}",
        "sent_at": sent_at or f"2026-08-{uid:02d}T00:00:00.000Z",
        "sent_at_raw": "",
        "sender_id": sender,
        "body": {
            "sha256": "sha256:" + "0" * 64,
            "chars": 10,
            "lines": 1,
            "quoted_lines": 0,
            "unquoted_lines": 1,
        },
    }


def test_linear_thread_has_one_root_and_increasing_depth():
    result = build(
        [
            message(1, "a@x"),
            message(2, "b@x", in_reply_to=["a@x"]),
            message(3, "c@x", in_reply_to=["b@x"]),
        ]
    )
    assert result["diagnostics"]["thread_count"] == 1
    assert result["diagnostics"]["edges_from_in_reply_to"] == 2
    depths = {n["message_id"]: n["depth"] for n in result["nodes"]}
    assert depths == {"a@x": 0, "b@x": 1, "c@x": 2}
    thread = result["threads"][0]
    assert thread["thread_id"] == "a@x"
    assert thread["max_depth"] == 2
    assert thread["message_count"] == 3
    assert thread["mean_branching_factor"] == 1.0


def test_branching_thread_reports_fan_out():
    result = build(
        [
            message(1, "a@x"),
            message(2, "b@x", in_reply_to=["a@x"]),
            message(3, "c@x", in_reply_to=["a@x"]),
        ]
    )
    thread = result["threads"][0]
    assert thread["reply_pairs"] == 2
    assert thread["mean_branching_factor"] == 2.0
    assert thread["max_depth"] == 1


def test_references_are_the_fallback_when_in_reply_to_is_not_in_the_corpus():
    # The immediate parent b@x was never crawled; the grandparent was.
    result = build(
        [
            message(1, "a@x"),
            message(2, "c@x", in_reply_to=["b@x"], references=["a@x", "b@x"]),
        ]
    )
    assert result["edges"] == [{"child": "c@x", "parent": "a@x", "via": "references"}]
    assert result["diagnostics"]["edges_from_references"] == 1
    assert result["diagnostics"]["dangling_parent_refs"] == 0


def test_an_unresolvable_parent_is_counted_not_invented():
    result = build([message(1, "b@x", in_reply_to=["missing@x"])])
    assert result["edges"] == []
    assert result["diagnostics"]["dangling_parent_refs"] == 1
    assert result["diagnostics"]["roots"] == 1


def test_messages_with_no_threading_headers_are_counted():
    result = build([message(1, "a@x"), message(2, "b@x")])
    assert result["diagnostics"]["messages_without_threading_headers"] == 2
    assert result["diagnostics"]["isolated_messages"] == 2


def test_same_subject_does_not_create_an_edge():
    # Subject-line threading is deliberately not implemented.
    a = message(1, "a@x")
    b = message(2, "b@x")
    b["subject"] = a["subject"]
    assert build([a, b])["edges"] == []


def test_a_message_without_a_message_id_is_counted_and_left_out():
    result = build([message(1, "a@x"), message(2, None)])
    assert result["diagnostics"]["messages_without_message_id"] == 1
    assert result["diagnostics"]["messages_total"] == 2
    assert len(result["nodes"]) == 1


def test_a_duplicate_message_id_collapses_to_one_node_and_is_counted():
    result = build([message(1, "a@x"), message(2, "a@x")])
    assert result["diagnostics"]["duplicate_message_ids"] == 1
    assert len(result["nodes"]) == 1
    # The earliest observation wins, deterministically.
    assert result["nodes"][0]["uid"] == 1


def test_distinct_senders_is_a_count_never_a_list():
    result = build(
        [
            message(1, "a@x", sender=SENDER_A),
            message(2, "b@x", in_reply_to=["a@x"], sender=SENDER_B),
            message(3, "c@x", in_reply_to=["a@x"], sender=SENDER_B),
        ]
    )
    thread = result["threads"][0]
    assert thread["distinct_senders"] == 2
    assert "senders" not in thread


def test_a_self_reference_does_not_become_a_self_loop():
    result = build([message(1, "a@x", in_reply_to=["a@x"])])
    assert result["edges"] == []
    assert result["diagnostics"]["thread_count"] == 1


def test_replay_skips_superseded_observations(tmp_path: Path):
    events_dir = tmp_path / "events" / "2026" / "08"
    events_dir.mkdir(parents=True)
    observed = {
        "event_id": "sha256:" + "1" * 64,
        "event_type": "MessageObserved",
        "schema_version": "1.0.0",
        "observed_at": "2026-08-15T00:00:00.000Z",
        "source": {"kind": "fixture", "name": "test"},
        "payload": message(1, "a@x"),
    }
    correction = {
        "event_id": "sha256:" + "2" * 64,
        "event_type": "ObservationSuperseded",
        "schema_version": "1.0.0",
        "observed_at": "2026-08-16T00:00:00.000Z",
        "source": {"kind": "fixture", "name": "test"},
        "payload": {
            "list_name": "testlist",
            "uid": 1,
            "uid_validity": 1,
            "superseded_event_id": observed["event_id"],
            "superseding_event_id": "sha256:" + "3" * 64,
            "reason": "content_changed",
        },
    }
    (events_dir / "15.jsonl").write_text(
        "\n".join(json.dumps(e) for e in (observed, correction)) + "\n", encoding="utf-8"
    )

    state = replay(tmp_path / "events")
    assert state.messages == []
    assert state.superseded_skipped == 1
    assert state.events_total == 2


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__]))
