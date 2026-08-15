"""Per-sender data for the operator's private view.

    uv run --directory python python -m laocoon.private_view \
        --events ../events --seed ../private/artifacts/seed.json \
        --reputation ../private/artifacts/reputation.json \
        --out ../private/artifacts/sender-view.json

**Private, permanently.** This is a ranked participant list — exactly what
PROBLEM.md section 7 keeps out of publication. Section 7 makes it private *to
Orie*, not nonexistent: the operator is meant to be able to look at it. Nothing
downstream may publish it, and the artifact carries `publication: private` so the
site build refuses it on sight.

It computes what the published view deliberately cannot: who replied to whom, how
often, in which threads, and where each account sits in the graph. The graph
layout is computed here rather than in the browser so the picture is deterministic
— the same corpus always draws the same diagram, and two runs can be compared.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import networkx as nx

from .events import replay
from .reply_graph import build
from .reputation import build_account_graph

GENERATOR = "laocoon.private_view/0.1.0"
LAYOUT_SEED = 1729


def layout(accounts: nx.DiGraph) -> dict[str, tuple[float, float]]:
    """Deterministic force layout, normalised into the unit square.

    Isolated accounts would be flung to the edges by the spring solver, so they
    are laid out separately in a band along the bottom: they have no edges, and
    pretending the solver placed them meaningfully would be misleading.
    """
    undirected = nx.Graph()
    undirected.add_nodes_from(accounts.nodes)
    for u, v, data in accounts.edges(data=True):
        w = data["replies"] + undirected.get_edge_data(u, v, {}).get("weight", 0)
        undirected.add_edge(u, v, weight=w)

    connected = [n for n in undirected.nodes if undirected.degree(n) > 0]
    isolated = sorted(n for n in undirected.nodes if undirected.degree(n) == 0)

    pos: dict[str, tuple[float, float]] = {}
    if connected:
        sub = undirected.subgraph(connected)
        raw = nx.spring_layout(sub, weight="weight", seed=LAYOUT_SEED, iterations=400)
        xs = [p[0] for p in raw.values()]
        ys = [p[1] for p in raw.values()]
        x0, x1 = min(xs), max(xs)
        y0, y1 = min(ys), max(ys)
        sx = (x1 - x0) or 1.0
        sy = (y1 - y0) or 1.0
        for node, (x, y) in raw.items():
            # Leave the bottom fifth free for the isolated band.
            pos[node] = ((x - x0) / sx, 0.78 * (y - y0) / sy)

    for i, node in enumerate(isolated):
        step = 1.0 / (len(isolated) + 1)
        pos[node] = ((i + 1) * step, 0.94)

    return pos


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--events", required=True, type=Path)
    parser.add_argument("--seed", required=True, type=Path)
    parser.add_argument("--reputation", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--list", dest="list_name", default="agentproto")
    args = parser.parse_args()

    seed_doc = json.loads(args.seed.read_text(encoding="utf-8"))
    clauses_of = {m["sender_id"]: m["clauses"] for m in seed_doc["members"]}
    unseeded_reason = {u["sender_id"]: u["reason"] for u in seed_doc["unseeded"]}

    rep_doc = json.loads(args.reputation.read_text(encoding="utf-8"))
    rep = {a["sender_id"]: a for a in rep_doc["accounts"]}

    state = replay(args.events, {args.list_name})
    graph = build(state.messages)
    accounts, self_loops = build_account_graph(graph)
    pos = layout(accounts)

    node_of = {n["message_id"]: n for n in graph["nodes"]}
    thread_subject = {t["thread_id"]: t["subject"] for t in graph["threads"]}
    thread_size = {t["thread_id"]: t["message_count"] for t in graph["threads"]}

    # sender -> thread -> messages, and the per-sender totals.
    matrix: dict[tuple[str, str], int] = {}
    per_sender: dict[str, dict[str, Any]] = {}
    for n in graph["nodes"]:
        s = n["sender_id"]
        key = (s, n["thread_id"])
        matrix[key] = matrix.get(key, 0) + 1
        row = per_sender.setdefault(
            s, {"messages": 0, "threads": set(), "first_seen": None, "last_seen": None}
        )
        row["messages"] += 1
        row["threads"].add(n["thread_id"])
        if n["sent_at"]:
            if row["first_seen"] is None or n["sent_at"] < row["first_seen"]:
                row["first_seen"] = n["sent_at"]
            if row["last_seen"] is None or n["sent_at"] > row["last_seen"]:
                row["last_seen"] = n["sent_at"]

    # A reply that started a thread is not a reply; count real reply edges.
    replies_sent: dict[str, int] = {}
    replies_received: dict[str, int] = {}
    for edge in graph["edges"]:
        child = node_of[edge["child"]]["sender_id"]
        parent = node_of[edge["parent"]]["sender_id"]
        replies_sent[child] = replies_sent.get(child, 0) + 1
        replies_received[parent] = replies_received.get(parent, 0) + 1

    senders = []
    for s, row in per_sender.items():
        r = rep.get(s, {})
        senders.append(
            {
                "sender_id": s,
                "messages": row["messages"],
                "threads_participated": len(row["threads"]),
                "replies_sent": replies_sent.get(s, 0),
                "replies_received": replies_received.get(s, 0),
                "first_seen": row["first_seen"],
                "last_seen": row["last_seen"],
                "seeded": s in clauses_of,
                "clauses": clauses_of.get(s, []),
                "unseeded_reason": unseeded_reason.get(s),
                "ppr_replies": r.get("ppr_replies"),
                "rank_replies": r.get("rank_replies"),
                "community": r.get("community"),
                "core_number": r.get("core_number"),
                "x": pos.get(s, (0.5, 0.5))[0],
                "y": pos.get(s, (0.5, 0.5))[1],
            }
        )
    senders.sort(key=lambda a: (-(a["ppr_replies"] or 0), a["sender_id"]))

    edges = [
        {
            "source": u,
            "target": v,
            "replies": d["replies"],
            "quoting": d["quoting"],
        }
        for u, v, d in accounts.edges(data=True)
    ]
    edges.sort(key=lambda e: (-e["replies"], e["source"], e["target"]))

    threads = sorted(
        ({"thread_id": t, "subject": thread_subject[t], "message_count": thread_size[t]}
         for t in thread_subject),
        key=lambda t: (-t["message_count"], t["thread_id"]),
    )

    artifact = {
        "schema_version": "1.0.0",
        "derived": True,
        "publication": "private",
        "generated_at": datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
        "generator": GENERATOR,
        "layout_seed": LAYOUT_SEED,
        "self_reply_edges_dropped": self_loops,
        "senders": senders,
        "edges": edges,
        "threads": threads,
        "matrix": [
            {"sender_id": s, "thread_id": t, "messages": n} for (s, t), n in sorted(matrix.items())
        ],
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "out": str(args.out),
                "senders": len(senders),
                "edges": len(edges),
                "threads": len(threads),
                "matrix_cells": len(artifact["matrix"]),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
