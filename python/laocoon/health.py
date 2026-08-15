"""Thread axes: reach, uptake and novelty. No state, and no health verdict.

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

**There was an open/narrow/closed state here and it has been removed, because it
was wrong.** It was tested the way everything else here is tested — does the
label at time *T* predict engagement in *(T, T+h]* — and it did not merely fail
to separate, it inverted:

    P(any reply in horizon | state)     agentproto      agent2agent
      open                                   0.077            0.021
      narrow                                 0.370            0.046
      closed                                 0.800            0.286

Threads the label called "closed" were by far the *most* likely to continue. The
cause is `reach`: distinct senders per message is an inverse proxy for a
sustained conversation. High reach is usually a broadcast that drew a few one-off
replies and died; low reach is an argument still in progress. The label encoded
"breadth is health", and on two lists the data says otherwise.

The three axes are kept because they are measurements. The verdict built on top
of them is gone, and nothing should reintroduce one without passing the same
test first.

**None of this concerns provenance,** and no arrangement of these axes could.
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

#: Below this a thread is too short for any of the three axes to mean anything.
MIN_MESSAGES = 3


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
            }
        )

    rows.sort(key=lambda r: (-r["messages"], r["thread_id"]))

    def spread(key: str) -> dict[str, float | None]:
        vals = [r[key] for r in rows if r[key] is not None]
        if not vals:
            return {"p10": None, "median": None, "p90": None}
        return {
            "p10": round(float(np.percentile(vals, 10)), 4),
            "median": round(float(np.median(vals)), 4),
            "p90": round(float(np.percentile(vals, 90)), 4),
        }

    artifact = {
        "schema_version": "1.0.0",
        "derived": True,
        "publication": "aggregate_public",
        "generated_at": datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
        "generator": GENERATOR,
        "list_name": args.list_name,
        "thresholds": {"min_messages": MIN_MESSAGES},
        "axes": {
            "reach": spread("reach"),
            "uptake_from_standing": spread("uptake_from_standing"),
            "median_novelty": spread("median_novelty"),
        },
        "state_removed": (
            "An open/narrow/closed label was removed after it failed its holdout "
            "test and inverted: threads it called closed were the most likely to "
            "continue. See the module docstring."
        ),
        "threads_scored": len(rows),
        "threads": rows,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"out": str(args.out), "list": args.list_name,
                      "threads_scored": len(rows), "axes": artifact["axes"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
