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

GENERATOR = "laocoon.private_view/0.2.0"
LAYOUT_SEED = 1729

#: Layout is computed in pixel space so that "far enough apart to read" is a
#: number rather than a hope. The renderer reads these back out of the artifact,
#: so the two never disagree about the canvas.
CANVAS = {"width": 1440, "height": 840, "padding": 56, "isolated_band": 78}

#: Clear space around every node, on top of its own radius. Sized to fit a line
#: of label text between two adjacent nodes.
MIN_GAP = 38.0

NODE_MIN_R = 5.0
NODE_SPAN_R = 20.0

#: Local spread per node when laying a component out on its own, and the space
#: left between packed components.
COMPONENT_SPACING = 105.0
COMPONENT_GUTTER = 74.0


def node_radius(messages: int, max_messages: int) -> float:
    """Area proportional to message count, so 4x messages is 4x the ink."""
    return NODE_MIN_R + NODE_SPAN_R * ((messages / max(1, max_messages)) ** 0.5)


def _relax(
    points: dict[str, list[float]],
    radii: dict[str, float],
    box: tuple[float, float, float, float] | None,
    rounds: int = 600,
) -> None:
    """Push overlapping nodes apart until everything has clear space.

    A force solver optimises edge lengths, not legibility: on this corpus it put
    64 of 378 node pairs in overlap. This is a separate, purely geometric pass
    run afterwards — it preserves the solver's structure, because every push is
    local and symmetric, while guaranteeing the spacing the labels need.
    """
    keys = sorted(points)
    for _ in range(rounds):
        moved = 0.0
        for i, a in enumerate(keys):
            for b in keys[i + 1 :]:
                ax, ay = points[a]
                bx, by = points[b]
                dx, dy = bx - ax, by - ay
                dist = (dx * dx + dy * dy) ** 0.5
                want = radii[a] + radii[b] + MIN_GAP
                if dist >= want:
                    continue
                if dist < 1e-6:
                    # Exactly coincident: separate deterministically rather than
                    # randomly, so the layout stays reproducible.
                    dx, dy, dist = 1.0, 0.0, 1.0
                push = (want - dist) / 2.0
                ux, uy = dx / dist, dy / dist
                points[a][0] -= ux * push
                points[a][1] -= uy * push
                points[b][0] += ux * push
                points[b][1] += uy * push
                moved += push
        if box is not None:
            x0, y0, x1, y1 = box
            for k in keys:
                points[k][0] = min(max(points[k][0], x0 + radii[k]), x1 - radii[k])
                points[k][1] = min(max(points[k][1], y0 + radii[k]), y1 - radii[k])
        if moved < 0.5:
            break


def _component_layout(sub: nx.Graph, radii: dict[str, float]) -> dict[str, list[float]]:
    """Lay one connected component out in its own local coordinate space."""
    if len(sub) == 1:
        return {next(iter(sub)): [0.0, 0.0]}
    raw = nx.spring_layout(
        sub, weight="weight", seed=LAYOUT_SEED, iterations=600, k=2.4 / (len(sub) ** 0.5)
    )
    # Scale so the component's own spread is proportional to how many nodes it
    # holds, rather than every component being stretched to the same size.
    side = (len(sub) ** 0.5) * COMPONENT_SPACING
    xs = [p[0] for p in raw.values()]
    ys = [p[1] for p in raw.values()]
    sx = (max(xs) - min(xs)) or 1.0
    sy = (max(ys) - min(ys)) or 1.0
    out = {n: [(p[0] - min(xs)) / sx * side, (p[1] - min(ys)) / sy * side] for n, p in raw.items()}
    _relax(out, radii, None)
    return out


def _bounds(points: dict[str, list[float]], radii: dict[str, float]) -> tuple[float, float, float, float]:
    x0 = min(p[0] - radii[k] for k, p in points.items())
    x1 = max(p[0] + radii[k] for k, p in points.items())
    y0 = min(p[1] - radii[k] for k, p in points.items())
    y1 = max(p[1] + radii[k] for k, p in points.items())
    return x0, y0, x1, y1


def layout(
    accounts: nx.DiGraph, messages_by_sender: dict[str, int]
) -> tuple[dict[str, tuple[float, float]], dict[str, float]]:
    """Readable pixel positions for every account, and their radii.

    Components are laid out one at a time and then packed, rather than handed to
    the solver together. A force solver pushes disconnected components apart
    until they reach the edge of whatever space it is given, which on this corpus
    left the graph crammed into a third of the canvas with the rest empty.
    Packing them means the space is used and the largest component — the one
    worth reading — gets the room.

    Accounts with no reply edges at all sit in their own band at the bottom.
    They have no position the graph could meaningfully give them, and mixing them
    into the packing would imply one.
    """
    undirected = nx.Graph()
    undirected.add_nodes_from(accounts.nodes)
    for u, v, data in accounts.edges(data=True):
        w = data["replies"] + undirected.get_edge_data(u, v, {}).get("weight", 0)
        undirected.add_edge(u, v, weight=w)

    max_messages = max(messages_by_sender.values(), default=1)
    radii = {n: node_radius(messages_by_sender.get(n, 1), max_messages) for n in undirected.nodes}

    isolated = sorted(n for n in undirected.nodes if undirected.degree(n) == 0)
    components = sorted(
        (c for c in nx.connected_components(undirected) if len(c) > 1),
        key=lambda c: (-len(c), sorted(c)[0]),
    )

    pad = CANVAS["padding"]
    x0, x1 = float(pad), float(CANVAS["width"] - pad)
    y0 = float(pad)
    y1 = float(CANVAS["height"] - pad - (CANVAS["isolated_band"] if isolated else 0))

    # Lay each component out locally, then shelf-pack the boxes.
    laid: list[tuple[dict[str, list[float]], float, float]] = []
    for comp in components:
        sub = undirected.subgraph(comp)
        local = _component_layout(sub, {n: radii[n] for n in comp})
        bx0, by0, bx1, by1 = _bounds(local, radii)
        for p in local.values():
            p[0] -= bx0
            p[1] -= by0
        laid.append((local, bx1 - bx0, by1 - by0))

    # Shelf-pack, then centre each component vertically within its shelf. Without
    # the centring, a short component top-aligns against a tall neighbour and
    # leaves an obvious hole underneath it.
    gutter = COMPONENT_GUTTER
    shelf_width = x1 - x0
    shelves: list[list[tuple[dict[str, list[float]], float, float]]] = [[]]
    widths = [0.0]
    for entry in laid:
        _, w, _ = entry
        if widths[-1] > 0 and widths[-1] + w > shelf_width:
            shelves.append([])
            widths.append(0.0)
        shelves[-1].append(entry)
        widths[-1] += w + gutter

    pos: dict[str, list[float]] = {}
    cursor_y = 0.0
    for shelf in shelves:
        shelf_height = max((h for _, _, h in shelf), default=0.0)
        cursor_x = 0.0
        for local, w, h in shelf:
            dy = cursor_y + (shelf_height - h) / 2
            for node, point in local.items():
                pos[node] = [point[0] + cursor_x, point[1] + dy]
            cursor_x += w + gutter
        cursor_y += shelf_height + gutter

    # Scale the packed arrangement up to fill the box, preserving aspect ratio.
    if pos:
        bx0, by0, bx1, by1 = _bounds(pos, radii)
        scale = min((x1 - x0) / max(bx1 - bx0, 1.0), (y1 - y0) / max(by1 - by0, 1.0))
        scale = max(scale, 1.0)
        cx_off = x0 + ((x1 - x0) - (bx1 - bx0) * scale) / 2 - bx0 * scale
        cy_off = y0 + ((y1 - y0) - (by1 - by0) * scale) / 2 - by0 * scale
        for p in pos.values():
            p[0] = p[0] * scale + cx_off
            p[1] = p[1] * scale + cy_off
        _relax(pos, {n: radii[n] for n in pos}, (x0, y0, x1, y1))

    if isolated:
        band_y = CANVAS["height"] - pad - CANVAS["isolated_band"] / 2
        step = (x1 - x0) / (len(isolated) + 1)
        for i, node in enumerate(isolated):
            pos[node] = [x0 + (i + 1) * step, band_y]

    return {k: (round(v[0], 2), round(v[1], 2)) for k, v in pos.items()}, {
        k: round(v, 2) for k, v in radii.items()
    }


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

    messages_by_sender: dict[str, int] = {}
    for n in graph["nodes"]:
        messages_by_sender[n["sender_id"]] = messages_by_sender.get(n["sender_id"], 0) + 1
    pos, radii = layout(accounts, messages_by_sender)

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
                "x": pos.get(s, (0.0, 0.0))[0],
                "y": pos.get(s, (0.0, 0.0))[1],
                "r": radii.get(s, NODE_MIN_R),
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
        "canvas": CANVAS,
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
