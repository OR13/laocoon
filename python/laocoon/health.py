"""Thread health: three axes, a state from their conjunction, no score.

    uv run --directory python python -m laocoon.health \
        --events ../events --seed ../private/artifacts/seed.json \
        --cache ../.cache/embeddings/nomic-embed-text__sentence-v1 \
        --out ../artifacts/health-agentproto.json --list agentproto

Health is a property of a **discussion**, never of a person. Nothing here is
attached to an account, and the artifact is aggregate — thread-level counts and
ratios only — precisely so that "unhealthy" can be shown on screen without it
reading as an accusation against whoever posted.

Three axes, each measured independently:

  reach     how many distinct people took part, relative to how much was said.
            A long exchange between two people has low reach; the same length
            across eight has high reach.
  uptake    the share of this thread's replies that came from an account holding
            community-conferred standing. Whether the established part of the
            group engaged at all.
  novelty   the median fraction of a reply's sentences that said something the
            thread had not already said.

State comes from a **conjunction**, not a weighted sum — §7 rules a composite
out, because a single number invites an argument about weights nobody can win.
All three values travel with the state everywhere it is displayed, so a reader
can disagree with one column instead of the whole verdict.

  open        high on reach and novelty — a discussion that is going somewhere
  narrow      neither clearly one nor the other
  closed      low on all three — few people, no outside engagement, repeating

**None of this concerns provenance.** A closed, repetitive thread between humans
scores exactly as a closed, repetitive thread scores. A `closed` state is a
reason to go and read the thread, and it is not evidence about how anything in
it was written.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from .events import replay
from .reply_graph import build
from .topics import load_sentence_vectors, novelty_scores

GENERATOR = "laocoon.health/0.1.0"

#: Axis thresholds. Constants, stated here so moving one and re-running is a
#: one-line experiment rather than an argument.
LOW_REACH = 0.35
HIGH_REACH = 0.55
LOW_NOVELTY = 0.60
HIGH_NOVELTY = 0.75
LOW_UPTAKE = 0.05
#: Below this a thread is too short for any of the three to mean anything.
MIN_MESSAGES = 3


def classify(reach: float, uptake: float, novelty: float | None) -> str:
    """A state from a conjunction. Never an average of the three."""
    if novelty is None:
        return "unmeasured"
    if reach <= LOW_REACH and uptake <= LOW_UPTAKE and novelty <= LOW_NOVELTY:
        return "closed"
    if reach >= HIGH_REACH and novelty >= HIGH_NOVELTY:
        return "open"
    return "narrow"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--events", required=True, type=Path)
    parser.add_argument("--seed", required=True, type=Path)
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--list", dest="list_name", required=True)
    args = parser.parse_args()

    seed_ids = {
        m["sender_id"] for m in json.loads(args.seed.read_text(encoding="utf-8"))["members"]
    }
    state = replay(args.events, {args.list_name})
    graph = build(state.messages)
    body_of = {m["message_id"]: m["body"]["sha256"] for m in state.messages if m["message_id"]}
    sentence_vectors = load_sentence_vectors(args.cache, set(body_of.values()))
    novelty = novelty_scores(graph, body_of, sentence_vectors)

    node_of = {n["message_id"]: n for n in graph["nodes"]}
    replies_by_thread: dict[str, list[str]] = defaultdict(list)
    for edge in graph["edges"]:
        child = node_of[edge["child"]]
        replies_by_thread[child["thread_id"]].append(child["sender_id"])

    rows = []
    for thread in graph["threads"]:
        tid = thread["thread_id"]
        members = [n for n in graph["nodes"] if n["thread_id"] == tid]
        if len(members) < MIN_MESSAGES:
            continue
        senders = {n["sender_id"] for n in members}
        # Distinct people per message: 1.0 when everyone speaks once, low when a
        # few people go back and forth.
        reach = len(senders) / len(members)
        repliers = replies_by_thread.get(tid, [])
        uptake = (
            sum(1 for r in repliers if r in seed_ids) / len(repliers) if repliers else 0.0
        )
        vals = [novelty[n["message_id"]] for n in members if n["message_id"] in novelty]
        median_novelty = float(np.median(vals)) if vals else None

        rows.append(
            {
                "thread_id": tid,
                "subject": thread["subject"],
                "messages": len(members),
                "distinct_senders": len(senders),
                "started_at": thread["started_at"],
                "last_message_at": thread["last_message_at"],
                "reach": round(reach, 4),
                "uptake_from_standing": round(uptake, 4),
                "median_novelty": round(median_novelty, 4) if median_novelty is not None else None,
                "state": classify(reach, uptake, median_novelty),
            }
        )

    rows.sort(key=lambda r: (-r["messages"], r["thread_id"]))
    counts: dict[str, int] = defaultdict(int)
    for r in rows:
        counts[r["state"]] += 1

    artifact = {
        "schema_version": "1.0.0",
        "derived": True,
        "publication": "aggregate_public",
        "generated_at": datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
        "generator": GENERATOR,
        "list_name": args.list_name,
        "thresholds": {
            "low_reach": LOW_REACH,
            "high_reach": HIGH_REACH,
            "low_novelty": LOW_NOVELTY,
            "high_novelty": HIGH_NOVELTY,
            "low_uptake": LOW_UPTAKE,
            "min_messages": MIN_MESSAGES,
        },
        "counts": dict(counts),
        "threads_scored": len(rows),
        "threads": rows,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"out": str(args.out), "list": args.list_name,
                      "threads_scored": len(rows), "counts": dict(counts)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
