"""Tests for per-thread measures and the temporal holdout.

The properties that matter here are about honesty rather than arithmetic: that an
unmeasured thread is distinguishable from a hollow one, that a measurement
as-of a date cannot see past it, and that a forecast is never scored against a
horizon that has not happened.
"""

from __future__ import annotations

import pytest

from laocoon.holdout import FORECASTERS, actual_engagement, evaluate, predictors
from laocoon.measures import messages_up_to, parse_time, thread_measures

SEED = "sha256:" + "5" * 64
A = "sha256:" + "a" * 64
B = "sha256:" + "b" * 64

PROVENANCE = {
    "seed_rule_version": "1.0.0",
    "classifier_model": "test",
    "prompt_hash": "sha256:" + "0" * 64,
    "prompt_version": "1.0.0",
    "generator": "test",
}


def msg(
    uid: int,
    message_id: str,
    *,
    sender: str = A,
    sent_at: str = "2026-08-01T00:00:00.000Z",
    in_reply_to: list[str] | None = None,
    quoted: int = 0,
    digest: str | None = None,
) -> dict:
    return {
        "list_name": "testlist",
        "uid": uid,
        "uid_validity": 1,
        "message_id": message_id,
        "in_reply_to": in_reply_to or [],
        "references": [],
        "subject": f"s{uid}",
        "sent_at": sent_at,
        "sent_at_raw": "",
        "sender_id": sender,
        "body": {
            "sha256": digest or ("sha256:" + f"{uid:064d}"),
            "chars": 100,
            "lines": 5,
            "quoted_lines": quoted,
            "unquoted_lines": 4,
        },
    }


def measures(messages, verdicts=None, seeds=None, as_of="2026-08-31T00:00:00Z", **kwargs):
    return thread_measures(
        messages,
        verdicts or {},
        seeds or set(),
        as_of=parse_time(as_of),
        window_days=kwargs.get("window_days", 7),
        new_participant_window_days=kwargs.get("new_participant_window_days", 14),
        list_name="testlist",
        provenance=PROVENANCE,
    )


def test_a_measurement_cannot_see_past_its_horizon():
    messages = [
        msg(1, "a@x", sent_at="2026-08-01T00:00:00.000Z"),
        msg(2, "b@x", in_reply_to=["a@x"], sent_at="2026-08-20T00:00:00.000Z"),
    ]
    early = measures(messages, as_of="2026-08-05T00:00:00Z")
    assert early[0]["messages_total"] == 1
    assert early[0]["reply_pairs"] == 0

    late = measures(messages, as_of="2026-08-31T00:00:00Z")
    assert late[0]["messages_total"] == 2


def test_an_undated_message_is_excluded_rather_than_assumed():
    undated = msg(1, "a@x")
    undated["sent_at"] = None
    assert messages_up_to([undated], parse_time("2026-08-31T00:00:00Z")) == []


def test_an_unclassified_thread_has_a_null_ratio_not_a_zero():
    # A thread nobody has classified and a thread of hollow replies are
    # different facts, and a 0.0 would conflate them.
    messages = [msg(1, "a@x"), msg(2, "b@x", in_reply_to=["a@x"])]
    result = measures(messages)[0]
    assert result["substantive_reply_ratio"] is None
    assert result["unclassified_replies"] == 1


def test_the_ratio_counts_only_judged_replies():
    messages = [
        msg(1, "a@x"),
        msg(2, "b@x", in_reply_to=["a@x"]),
        msg(3, "c@x", in_reply_to=["a@x"]),
        msg(4, "d@x", in_reply_to=["a@x"]),
    ]
    verdicts = {
        ("b@x", messages[1]["body"]["sha256"]): "substantive",
        ("c@x", messages[2]["body"]["sha256"]): "hollow",
        ("d@x", messages[3]["body"]["sha256"]): "unclear",
    }
    result = measures(messages, verdicts)[0]
    assert result["substantive_replies"] == 1
    assert result["hollow_replies"] == 1
    assert result["unclear_replies"] == 1
    assert result["substantive_reply_ratio"] == pytest.approx(0.5)


def test_a_verdict_does_not_carry_over_to_changed_text():
    messages = [msg(1, "a@x"), msg(2, "b@x", in_reply_to=["a@x"], digest="sha256:" + "9" * 64)]
    stale = {("b@x", "sha256:" + "1" * 64): "substantive"}
    result = measures(messages, stale)[0]
    assert result["substantive_replies"] == 0
    assert result["unclassified_replies"] == 1


def test_participants_are_counted_never_listed():
    messages = [msg(1, "a@x", sender=A), msg(2, "b@x", sender=B, in_reply_to=["a@x"])]
    result = measures(messages, seeds={A})[0]
    assert result["distinct_senders"] == 2
    assert result["seeded_participants"] == 1
    assert not any(isinstance(v, list) for v in result.values())
    assert "sha256:" not in {k: v for k, v in result.items() if k != "thread_id"}.__str__().replace(
        PROVENANCE["prompt_hash"], ""
    )


def test_quoting_ratio_is_mechanical_and_needs_no_model():
    messages = [
        msg(1, "a@x"),
        msg(2, "b@x", in_reply_to=["a@x"], quoted=3),
        msg(3, "c@x", in_reply_to=["a@x"], quoted=0),
    ]
    assert measures(messages)[0]["quoting_reply_ratio"] == pytest.approx(0.5)


def test_holdout_scores_only_from_data_before_the_origin():
    messages = [
        msg(1, "a@x", sent_at="2026-08-01T00:00:00.000Z"),
        msg(2, "b@x", in_reply_to=["a@x"], sent_at="2026-08-02T00:00:00.000Z"),
        msg(3, "c@x", in_reply_to=["a@x"], sent_at="2026-08-20T00:00:00.000Z"),
    ]
    origin = parse_time("2026-08-05T00:00:00Z")
    scores, _ = predictors(messages, {}, set(), origin, 7)
    # Only the reply before the origin counts toward the prediction.
    assert scores["recent_replies"]["a@x"] == 1.0


def test_actual_engagement_counts_only_the_horizon():
    messages = [
        msg(1, "a@x", sent_at="2026-08-01T00:00:00.000Z"),
        msg(2, "b@x", in_reply_to=["a@x"], sent_at="2026-08-07T00:00:00.000Z"),
        msg(3, "c@x", in_reply_to=["a@x"], sent_at="2026-08-30T00:00:00.000Z"),
    ]
    counts = actual_engagement(
        messages,
        parse_time("2026-08-05T00:00:00Z"),
        parse_time("2026-08-12T00:00:00Z"),
        ["a@x"],
    )
    assert counts["a@x"] == 1


def test_every_evaluation_reports_a_baseline_alongside_the_others():
    # A correlation with no trivial predictor beside it is not a result.
    messages = [
        msg(1, "a@x", sent_at="2026-08-01T00:00:00.000Z"),
        msg(2, "b@x", in_reply_to=["a@x"], sent_at="2026-08-03T00:00:00.000Z"),
        msg(3, "c@x", sender=B, sent_at="2026-08-02T00:00:00.000Z"),
        msg(4, "d@x", sender=B, in_reply_to=["c@x"], sent_at="2026-08-09T00:00:00.000Z"),
    ]
    payloads = evaluate(messages, {}, set(), parse_time("2026-08-05T00:00:00Z"), 7)
    assert {p["forecaster"] for p in payloads} == set(FORECASTERS)
    assert sum(1 for p in payloads if p["is_baseline"]) == 1


def test_spearman_is_null_rather_than_invented_when_undefined():
    # One thread, or a constant predictor, has no rank correlation. Reporting a
    # number there would be worse than reporting nothing.
    messages = [
        msg(1, "a@x", sent_at="2026-08-01T00:00:00.000Z"),
        msg(2, "b@x", in_reply_to=["a@x"], sent_at="2026-08-03T00:00:00.000Z"),
    ]
    payloads = evaluate(messages, {}, set(), parse_time("2026-08-05T00:00:00Z"), 7)
    assert all(p["spearman"] is None for p in payloads)
