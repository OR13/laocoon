"""Closed, low-novelty exchanges.

    uv run --directory python python -m laocoon.closed_loop \
        --events ../events --seed ../private/artifacts/seed.json \
        --reputation ../private/artifacts/reputation-agent2agent.json \
        --uptake ../private/artifacts/uptake-agent2agent.json \
        --out ../private/artifacts/closed-loop-agent2agent.json --list agent2agent

PROBLEM.md §3 asks for mutually-reinforcing clusters that do not connect to the
rest of the group. This is that, made concrete as **three independent
conditions**, every one of which is a count or a ratio:

  1. **closure** — the community's replies overwhelmingly go to its own members
  2. **no uptake** — its messages draw little engagement from outside it
  3. **low novelty** — its replies mostly restate what the thread already said

A **flag fires only when all three cross their thresholds**, and the three values
are always reported beside it. That is deliberately not a composite score: §7
rules one out, because a single number invites an argument about weights that
cannot be won. A conjunction can be disagreed with one column at a time.

**This says nothing about provenance, and cannot.** Every input is either graph
position or semantic overlap with earlier text. A group of humans talking only
to each other and repeating themselves scores exactly the same, which is the
correct behaviour: the measure is of the exchange, not of who or what produced
it. Nothing here licenses the claim that anything was machine-generated, and the
flag must never be presented as if it did.

A fired flag is a prompt to go and read the thread. It is not a verdict.
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
from .reputation import build_account_graph, detect_communities

GENERATOR = "laocoon.closed_loop/0.1.0"

#: Thresholds, each on its own axis. Stated as constants so a reader can move one
#: and see what changes, rather than arguing with a weighting.
MIN_MEMBERS = 3
MAX_EXTERNAL_EDGE_RATIO = 0.25
MAX_OUTSIDE_UPTAKE_SHARE = 0.20
MAX_MEDIAN_NOVELTY = 0.60


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--events", required=True, type=Path)
    parser.add_argument("--seed", required=True, type=Path)
    parser.add_argument("--reputation", required=True, type=Path)
    parser.add_argument("--uptake", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--list", dest="list_name", required=True)
    args = parser.parse_args()

    seed_ids = {
        m["sender_id"] for m in json.loads(args.seed.read_text(encoding="utf-8"))["members"]
    }
    uptake = json.loads(args.uptake.read_text(encoding="utf-8"))
    by_message = {m["id"]: m for m in uptake["messages"]}

    state = replay(args.events, {args.list_name})
    graph = build(state.messages)
    accounts, _ = build_account_graph(graph)
    partition, modularity = detect_communities(accounts)
    node_of = {n["message_id"]: n for n in graph["nodes"]}

    # Who replied to whom, so "uptake from outside" can be counted per community.
    repliers: dict[str, list[str]] = defaultdict(list)
    for edge in graph["edges"]:
        child = node_of[edge["child"]]
        repliers[edge["parent"]].append(child["sender_id"])

    findings = []
    for index, community in enumerate(partition):
        members = set(community)
        if len(members) < MIN_MEMBERS:
            continue

        internal = external = 0
        for u, v in accounts.edges():
            if u in members and v in members:
                internal += 1
            elif u in members or v in members:
                external += 1
        total_edges = internal + external
        external_ratio = (external / total_edges) if total_edges else 0.0

        own = [m for m in uptake["messages"] if m["sender_id"] in members]
        if not own:
            continue
        inside = outside = 0
        for m in own:
            for r in repliers.get(m["id"], []):
                if r in members:
                    inside += 1
                else:
                    outside += 1
        replies_total = inside + outside
        outside_share = (outside / replies_total) if replies_total else 0.0

        novelties = [m["novelty"] for m in own if m["novelty"] is not None]
        median_novelty = float(np.median(novelties)) if novelties else None

        conditions = {
            "closed": external_ratio <= MAX_EXTERNAL_EDGE_RATIO,
            "no_outside_uptake": replies_total > 0 and outside_share <= MAX_OUTSIDE_UPTAKE_SHARE,
            "low_novelty": median_novelty is not None and median_novelty <= MAX_MEDIAN_NOVELTY,
        }
        findings.append(
            {
                "community": index,
                "members": len(members),
                "contains_standing": bool(members & seed_ids),
                "messages": len(own),
                "internal_edges": internal,
                "external_edges": external,
                "external_edge_ratio": round(external_ratio, 4),
                "replies_from_inside": inside,
                "replies_from_outside": outside,
                "outside_uptake_share": round(outside_share, 4),
                "median_novelty": round(median_novelty, 4) if median_novelty is not None else None,
                "conditions": conditions,
                # All three, or nothing. Never a weighted blend.
                "flagged": all(conditions.values()),
            }
        )

    findings.sort(key=lambda f: (not f["flagged"], f["external_edge_ratio"], -f["members"]))
    flagged = [f for f in findings if f["flagged"]]

    artifact = {
        "schema_version": "1.0.0",
        "derived": True,
        "publication": "private",
        "generated_at": datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
        "generator": GENERATOR,
        "list_name": args.list_name,
        "modularity": round(modularity, 4),
        "thresholds": {
            "min_members": MIN_MEMBERS,
            "max_external_edge_ratio": MAX_EXTERNAL_EDGE_RATIO,
            "max_outside_uptake_share": MAX_OUTSIDE_UPTAKE_SHARE,
            "max_median_novelty": MAX_MEDIAN_NOVELTY,
        },
        "communities_examined": len(findings),
        "flagged": len(flagged),
        "findings": findings,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")

    print(
        json.dumps(
            {
                "out": str(args.out),
                "list": args.list_name,
                "communities_examined": len(findings),
                "flagged": len(flagged),
                "near_misses": [
                    {
                        "members": f["members"],
                        "failed": [k for k, v in f["conditions"].items() if not v],
                        "external_edge_ratio": f["external_edge_ratio"],
                        "outside_uptake_share": f["outside_uptake_share"],
                        "median_novelty": f["median_novelty"],
                    }
                    for f in findings
                    if not f["flagged"] and sum(f["conditions"].values()) == 2
                ][:5],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
