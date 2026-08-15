"""Temporal holdout: the system scoring itself.

    uv run --directory python python -m laocoon.holdout \
        --events ../events --private-events ../private/events \
        --seed ../private/artifacts/seed.json \
        --out ../artifacts/holdout.json --horizon-days 7

PROBLEM.md section 6 turns validation into forecasting. Rank the threads using
only data available at time T; at T+7d, check whether the engagement actually
materialised. That is objectively scorable, needs no hand labelling, and cannot
be gamed by the thing being measured.

**Every run reports a baseline.** A correlation without the trivial predictor
beside it is not a result. The baseline here is "replies in the previous window"
— raw volume, no model, no seed. If substance classification or
community-conferred participation does not beat raw volume, that is the finding,
and it appears in the output rather than being quietly omitted.

The three forecasters are each a single column of the measure vector, chosen
before looking at the answer. Nothing here is a fitted blend: with 24 threads and
one list, any weighting learned from this corpus would be fitted to noise.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from scipy.stats import spearmanr

from .events import replay
from .measures import load_verdicts, messages_up_to, parse_time
from .reply_graph import build

GENERATOR = "laocoon.holdout/0.1.0"

#: Forecaster name -> whether it is the baseline. Documented in docs/holdout.md.
FORECASTERS = {
    "recent_replies": True,
    "recent_substantive_replies": False,
    "recent_seeded_participants": False,
    "recent_novel_replies": False,
}

#: A reply is "novel" when most of its sentences said something the thread had
#: not. The cutoff is the same one the health axes use, so the two agree.
NOVEL_AT = 0.60


def predictors(
    messages: list[dict[str, Any]],
    verdicts: dict[tuple[str, str], str],
    seed_ids: set[str],
    origin: datetime,
    window_days: int,
    novelty: dict[str, float] | None = None,
) -> tuple[dict[str, dict[str, float]], dict[str, str]]:
    """Score every thread visible at the origin, using only data up to it.

    Returns ``(scores_by_forecaster, thread_root_of_message)``.
    """
    visible = messages_up_to(messages, origin)
    graph = build(visible)
    body_of = {m["message_id"]: m["body"]["sha256"] for m in visible if m["message_id"]}
    has_parent = {edge["child"] for edge in graph["edges"]}
    window_start = origin - timedelta(days=window_days)

    scores: dict[str, dict[str, float]] = {name: {} for name in FORECASTERS}
    for thread in graph["threads"]:
        thread_id = thread["thread_id"]
        members = [n for n in graph["nodes"] if n["thread_id"] == thread_id]
        in_window = [
            n for n in members if n["sent_at"] and parse_time(n["sent_at"]) > window_start
        ]

        replies_in_window = [n for n in in_window if n["message_id"] in has_parent]
        substantive = sum(
            1
            for n in replies_in_window
            if verdicts.get((n["message_id"], body_of.get(n["message_id"], ""))) == "substantive"
        )
        seeded = len({n["sender_id"] for n in in_window} & seed_ids)
        novel = sum(
            1
            for n in replies_in_window
            if (novelty or {}).get(n["message_id"], 0.0) >= NOVEL_AT
        )

        scores["recent_replies"][thread_id] = float(len(replies_in_window))
        scores["recent_substantive_replies"][thread_id] = float(substantive)
        scores["recent_seeded_participants"][thread_id] = float(seeded)
        scores["recent_novel_replies"][thread_id] = float(novel)

    return scores, {n["message_id"]: n["thread_id"] for n in graph["nodes"]}


def actual_engagement(
    messages: list[dict[str, Any]],
    origin: datetime,
    horizon: datetime,
    thread_ids: list[str],
) -> dict[str, int]:
    """Replies each thread actually received in (origin, horizon].

    Threads are matched by their root message id. The graph is rebuilt at the
    horizon rather than reusing the one from the origin, because a message
    arriving in between can join two previously separate components; matching on
    the root keeps the identity stable through that.
    """
    later = messages_up_to(messages, horizon)
    graph = build(later)
    thread_of = {n["message_id"]: n["thread_id"] for n in graph["nodes"]}

    # If two origin-time threads merged into one by the horizon, a new message
    # in the merged thread is attributed to the first of them. It is counted
    # once, never twice.
    counts = {thread_id: 0 for thread_id in thread_ids}
    for node in graph["nodes"]:
        if not node["sent_at"]:
            continue
        sent = parse_time(node["sent_at"])
        if not (origin < sent <= horizon):
            continue
        # Which origin-time thread does this new message belong to?
        root_now = thread_of.get(node["message_id"])
        for thread_id in thread_ids:
            if thread_of.get(thread_id) == root_now:
                counts[thread_id] += 1
                break
    return counts


def evaluate(
    messages: list[dict[str, Any]],
    verdicts: dict[tuple[str, str], str],
    seed_ids: set[str],
    origin: datetime,
    horizon_days: int,
    novelty: dict[str, float] | None = None,
    list_name: str = "",
) -> list[dict[str, Any]]:
    """One ForecastEvaluated payload per forecaster at this origin."""
    horizon = origin + timedelta(days=horizon_days)
    scores, _ = predictors(messages, verdicts, seed_ids, origin, horizon_days, novelty)
    thread_ids = sorted(scores["recent_replies"])
    actual = actual_engagement(messages, origin, horizon, thread_ids)

    origin_iso = origin.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    positives = sum(1 for t in thread_ids if actual[t] > 0)

    payloads = []
    for name, is_baseline in FORECASTERS.items():
        predicted = [scores[name][t] for t in thread_ids]
        observed = [float(actual[t]) for t in thread_ids]

        rho: float | None = None
        p_value: float | None = None
        # Spearman is undefined when a vector is constant, which happens
        # routinely on a small corpus. Report null rather than a number.
        if len(thread_ids) > 2 and len(set(predicted)) > 1 and len(set(observed)) > 1:
            result = spearmanr(predicted, observed)
            rho = _finite(float(result.statistic))
            p_value = _finite(float(result.pvalue))

        ranked = sorted(thread_ids, key=lambda t: (-scores[name][t], t))[:3]
        precision_at_3 = (
            sum(1 for t in ranked if actual[t] > 0) / len(ranked) if ranked else None
        )

        payloads.append(
            {
                "list_name": list_name,
                "origin_at": origin_iso,
                "horizon_days": horizon_days,
                "forecaster": name,
                "is_baseline": is_baseline,
                "threads_scored": len(thread_ids),
                "threads_with_engagement": positives,
                "spearman": rho,
                "p_value": p_value,
                "precision_at_3": precision_at_3,
                "actual_metric": "replies_in_horizon",
                "generator": GENERATOR,
            }
        )
    return payloads


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--events", required=True, type=Path)
    parser.add_argument("--private-events", required=True, type=Path)
    parser.add_argument("--seed", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--horizon-days", type=int, default=7)
    parser.add_argument(
        "--origin-step-days",
        type=float,
        default=None,
        help="Spacing between rolling origins. Defaults to the horizon, which gives "
        "non-overlapping windows and very few of them; a smaller step gives more "
        "evaluation points at the cost of their being correlated.",
    )
    parser.add_argument(
        "--origin",
        action="append",
        dest="origins",
        help="ISO timestamp. Repeatable. Default: a rolling series ending one horizon "
        "before the last message, so every origin has a full horizon of real data.",
    )
    parser.add_argument("--model", default="gemma4:12b")
    parser.add_argument("--novelty", type=Path, default=None,
                        help="health artifact, for per-message novelty")
    parser.add_argument("--list", dest="list_name", default="agentproto")
    args = parser.parse_args()

    seed_doc = json.loads(args.seed.read_text(encoding="utf-8"))
    seed_ids = {m["sender_id"] for m in seed_doc["members"]}
    state = replay(args.events, {args.list_name})
    verdicts = load_verdicts(args.private_events, args.model)

    sent = sorted(parse_time(m["sent_at"]) for m in state.messages if m["sent_at"])
    if not sent:
        raise SystemExit("no dated messages")

    if args.origins:
        origins = [parse_time(o) for o in args.origins]
    else:
        # Rolling origins, one per horizon-length step back from the last date
        # that still has a full horizon of observed data after it. An origin
        # without a complete horizon would score the system against a future
        # that has not happened yet.
        step = timedelta(days=args.origin_step_days or args.horizon_days)
        last_scoreable = sent[-1] - timedelta(days=args.horizon_days)
        origins = []
        cursor = last_scoreable
        while cursor > sent[0]:
            origins.append(cursor)
            cursor -= step
        origins.reverse()

    # Per-message novelty, recomputed here from the same cache the health axes
    # use so the two cannot disagree about what "novel" means.
    novelty: dict[str, float] = {}
    if args.novelty and args.novelty.exists():
        from .topics import load_sentence_vectors, novelty_scores

        body_of = {m["message_id"]: m["body"]["sha256"] for m in state.messages if m["message_id"]}
        cache = args.novelty
        sv = load_sentence_vectors(cache, set(body_of.values()))
        novelty = novelty_scores(build(state.messages), body_of, sv)

    evaluations: list[dict[str, Any]] = []
    for origin in origins:
        evaluations.extend(
            evaluate(
                state.messages, verdicts, seed_ids, origin, args.horizon_days, novelty,
                args.list_name,
            )
        )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(evaluations, indent=2) + "\n", encoding="utf-8")

    print(
        json.dumps(
            {
                "out": str(args.out),
                "origins": [
                    o.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
                    for o in origins
                ],
                "horizon_days": args.horizon_days,
                "evaluations": len(evaluations),
                "corpus_sent_range": [
                    sent[0].isoformat(timespec="seconds"),
                    sent[-1].isoformat(timespec="seconds"),
                ],
                "by_forecaster": {
                    name: [
                        {
                            "origin": e["origin_at"][:10],
                            "n": e["threads_scored"],
                            "positives": e["threads_with_engagement"],
                            "spearman": e["spearman"],
                            "p": e["p_value"],
                            "prec@3": e["precision_at_3"],
                        }
                        for e in evaluations
                        if e["forecaster"] == name
                    ]
                    for name in FORECASTERS
                },
            },
            indent=2,
        )
    )
    return 0


def _finite(value: float) -> float | None:
    return None if value != value else round(value, 6)


if __name__ == "__main__":
    raise SystemExit(main())
