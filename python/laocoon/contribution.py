"""What draws engagement, and what is getting buried.

    uv run --directory python python -m laocoon.contribution \
        --uptake ../private/artifacts/uptake-agent2agent.json \
        --seed ../private/artifacts/seed.json \
        --out ../artifacts/contribution-agent2agent.json --list agent2agent

Two questions, both stated by the operator as the actual point of the project:
useful comments are getting lost in the volume, and new people need to learn how
to contribute successfully.

**What works.** Compare messages that drew a reply from an account holding
community-conferred standing against those that did not, across the mechanical
properties of the message: how much new text it contained, how much it quoted,
how novel it was, how deep in the thread it sat, and whether its author was new.
The output is a set of contrasts a newcomer could act on — not a model, not a
score, just "messages that got engagement looked like this".

**What is buried.** Messages that drew engagement from the established part of
the group while sitting in threads that got little attention overall. These are
the contributions the operator says are being lost: they landed with the people
who matter and then went nowhere visible. Ranked by uptake, filtered to quiet
threads.

Also surfaced: messages from **first-time participants that drew a reply from
someone with standing**. Those are the worked examples — proof a newcomer did it
right, and the best thing to show another newcomer.

This is signal recovery, not slop detection. There is no measure here of whether
anything was machine-generated, and none of these inputs could support one: they
are counts of words, positions in a graph, and overlap with earlier text. A
message that draws engagement from people the group listens to is surfaced
whoever or whatever wrote it, and one that draws none is not accused of
anything.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

GENERATOR = "laocoon.contribution/0.1.0"

#: A thread this quiet counts as somewhere a good message can get lost.
QUIET_THREAD_MESSAGES = 6
#: How many worked examples to carry into the artifact.
TOP_N = 25


def contrast(
    with_uptake: list[float], without: list[float]
) -> dict[str, float | None]:
    """Median in each group, and the standardised difference between them.

    Cliff's delta rather than a mean difference: these distributions are skewed
    and full of zeros, and a mean would be dragged around by a handful of very
    long messages.
    """
    if not with_uptake or not without:
        return {"with": None, "without": None, "delta": None}
    greater = sum(1 for a in with_uptake for b in without if a > b)
    less = sum(1 for a in with_uptake for b in without if a < b)
    total = len(with_uptake) * len(without)
    return {
        "with": round(float(np.median(with_uptake)), 3),
        "without": round(float(np.median(without)), 3),
        # +1 means every engaged message scores higher; 0 means no difference.
        "delta": round((greater - less) / total, 3) if total else None,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--uptake", required=True, type=Path)
    parser.add_argument("--concreteness", type=Path, default=None)
    parser.add_argument("--seed", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--list", dest="list_name", required=True)
    args = parser.parse_args()

    doc = json.loads(args.uptake.read_text(encoding="utf-8"))
    messages: list[dict[str, Any]] = doc["messages"]
    seed_ids = {
        m["sender_id"] for m in json.loads(args.seed.read_text(encoding="utf-8"))["members"]
    }

    per_thread: dict[str, int] = defaultdict(int)
    for m in messages:
        per_thread[m["thread_id"]] += 1

    # First appearance per sender, so "new participant" is a fact about when
    # they arrived rather than a guess.
    first_seen: dict[str, str] = {}
    for m in sorted(messages, key=lambda m: m["sent_at"] or ""):
        first_seen.setdefault(m["sender_id"], m["id"])

    # Only replies can draw a reply; a thread opener is a different animal.
    replies = [m for m in messages if m["depth"] > 0]
    engaged = [m for m in replies if m["replies_from_standing"] > 0]
    ignored = [m for m in replies if m["replies_from_standing"] == 0]

    def axis(key: str) -> dict[str, float | None]:
        pick = lambda m: float(m[key] or 0)  # noqa: E731 - closes over key correctly
        return contrast([pick(m) for m in engaged], [pick(m) for m in ignored])

    # Concreteness, joined by message id. Novelty measures distance from what
    # the thread already said, so fluent filler scores *high* on it — it cannot
    # see a message that commits to nothing. These count what a message points
    # at that a reader could go and check.
    concrete: dict[str, dict[str, Any]] = {}
    if args.concreteness and args.concreteness.exists():
        doc_c = json.loads(args.concreteness.read_text(encoding="utf-8"))
        concrete = {m["message_id"]: m for m in doc_c["messages"]}

    def concrete_axis(key: str) -> dict[str, float | None]:
        def pick(group: list[dict[str, Any]]) -> list[float]:
            return [float(concrete[m["id"]][key] or 0) for m in group if m["id"] in concrete]

        return contrast(pick(engaged), pick(ignored))

    what_works = {
        "authored_lines": axis("authored_lines"),
        "novelty": axis("novelty"),
        "depth": axis("depth"),
        "replies_drawn_total": axis("replies"),
        "author_already_had_standing": contrast(
            [1.0 if m["sender_id"] in seed_ids else 0.0 for m in engaged],
            [1.0 if m["sender_id"] in seed_ids else 0.0 for m in ignored],
        ),
    }
    if concrete:
        what_works.update(
            {
                "referent_kinds": concrete_axis("referent_kinds"),
                "referent_density": concrete_axis("referent_density"),
                "draft_references": concrete_axis("draft_references"),
                "section_references": concrete_axis("section_references"),
                "asks_a_question": concrete_axis("questions"),
                "contends": concrete_axis("contends"),
                # Negative delta expected: a message offering nothing checkable
                # should be *less* likely to draw an established reply. If this
                # comes back at zero the measure sees nothing that matters.
                "offers_nothing_checkable": concrete_axis("offers_nothing_checkable"),
            }
        )

    # Buried: landed with the people who matter, in a thread nobody watched.
    buried = sorted(
        (
            m
            for m in messages
            if m["replies_from_standing"] > 0
            and per_thread[m["thread_id"]] <= QUIET_THREAD_MESSAGES
        ),
        key=lambda m: (-m["uptake_reputation"], -m["replies_from_standing"]),
    )[:TOP_N]

    # Worked examples: a newcomer's first message that drew standing engagement.
    newcomer_wins = sorted(
        (
            m
            for m in messages
            if m["replies_from_standing"] > 0
            and m["sender_id"] not in seed_ids
            and first_seen.get(m["sender_id"]) == m["id"]
        ),
        key=lambda m: -m["uptake_reputation"],
    )[:TOP_N]

    def public(m: dict[str, Any]) -> dict[str, Any]:
        """Message-shaped, with no sender identifier. The gist and the thread are
        enough for a reader to go and read it; who wrote it is a private join."""
        return {
            "message_id": m["id"],
            "thread_id": m["thread_id"],
            "sent_at": m["sent_at"],
            "gist": m["gist"],
            "authored_lines": m["authored_lines"],
            "novelty": m["novelty"],
            "replies": m["replies"],
            "replies_from_standing": m["replies_from_standing"],
            "thread_messages": per_thread[m["thread_id"]],
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
        "replies_examined": len(replies),
        "replies_that_drew_standing_engagement": len(engaged),
        "quiet_thread_threshold": QUIET_THREAD_MESSAGES,
        "what_works": what_works,
        "buried": [public(m) for m in buried],
        "newcomer_wins": [public(m) for m in newcomer_wins],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")

    print(
        json.dumps(
            {
                "out": str(args.out),
                "list": args.list_name,
                "replies_examined": len(replies),
                "drew_standing_engagement": len(engaged),
                "what_works": what_works,
                "buried": len(buried),
                "newcomer_wins": len(newcomer_wins),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
