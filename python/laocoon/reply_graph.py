"""Build the reply graph projection.

    uv run --directory python python -m laocoon.reply_graph \
        --events ../events --out ../artifacts/reply-graph.json --list agentproto

Edges come only from In-Reply-To and References. Subject-line threading is
deliberately not implemented: it manufactures edges the corpus does not contain,
and this graph is the substrate every later measure sits on. Messages that cannot
be attached are reported as counts in ``diagnostics`` and left unattached.

Nothing here judges a message or a person. Threads carry a count of distinct
senders, never a list of them: which accounts took part is per-person data and
PROBLEM.md section 7 keeps that out of anything intended for publication.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import networkx as nx

from .events import replay

SCHEMA_VERSION = "1.0.0"
GENERATOR = {"name": "laocoon.reply_graph", "version": "0.1.0"}


def _canonical_key(message: dict[str, Any]) -> tuple[str, int]:
    """Tie-break duplicates deterministically: earliest sent, then lowest UID."""
    return (message["sent_at"] or "9999", message["uid"])


def build(messages: list[dict[str, Any]]) -> dict[str, Any]:
    """Return nodes, edges, threads and diagnostics for a set of observations."""
    without_message_id = sum(1 for m in messages if not m["message_id"])
    without_threading = sum(
        1 for m in messages if not m["in_reply_to"] and not m["references"]
    )

    # One node per message_id. A message_id seen twice is the same message
    # observed twice (cross-posted, or delivered twice); keep one and count it.
    by_id: dict[str, dict[str, Any]] = {}
    id_counts: Counter[str] = Counter()
    for message in messages:
        mid = message["message_id"]
        if not mid:
            continue
        id_counts[mid] += 1
        existing = by_id.get(mid)
        if existing is None or _canonical_key(message) < _canonical_key(existing):
            by_id[mid] = message
    duplicate_message_ids = sum(1 for count in id_counts.values() if count > 1)

    graph = nx.DiGraph()
    for mid, message in by_id.items():
        graph.add_node(mid, message=message)

    edges: list[dict[str, str]] = []
    dangling = 0
    from_in_reply_to = 0
    from_references = 0

    for mid, message in by_id.items():
        parent, via = _resolve_parent(mid, message, by_id)
        if parent is None:
            if message["in_reply_to"] or message["references"]:
                dangling += 1
            continue
        graph.add_edge(mid, parent, via=via)
        edges.append({"child": mid, "parent": parent, "via": via})
        if via == "in_reply_to":
            from_in_reply_to += 1
        else:
            from_references += 1

    threads, node_thread, node_depth = _threads(graph, by_id)

    nodes = []
    for mid, message in sorted(by_id.items(), key=lambda kv: _canonical_key(kv[1])):
        nodes.append(
            {
                "message_id": mid,
                "list_name": message["list_name"],
                "uid": message["uid"],
                "sender_id": message["sender_id"],
                "sent_at": message["sent_at"],
                "subject": message["subject"],
                "thread_id": node_thread[mid],
                "depth": node_depth[mid],
                "in_degree": graph.in_degree(mid),
                "out_degree": graph.out_degree(mid),
                "body": {
                    "chars": message["body"]["chars"],
                    "quoted_lines": message["body"]["quoted_lines"],
                    "unquoted_lines": message["body"]["unquoted_lines"],
                },
            }
        )

    diagnostics = {
        "messages_total": len(messages),
        "messages_superseded_skipped": 0,  # filled in by the caller from the replay
        "messages_without_message_id": without_message_id,
        "messages_without_threading_headers": without_threading,
        "duplicate_message_ids": duplicate_message_ids,
        "dangling_parent_refs": dangling,
        "edges_from_in_reply_to": from_in_reply_to,
        "edges_from_references": from_references,
        "roots": len(threads),
        "thread_count": len(threads),
        "isolated_messages": sum(1 for t in threads if t["message_count"] == 1),
    }

    return {"nodes": nodes, "edges": edges, "threads": threads, "diagnostics": diagnostics}


def _resolve_parent(
    mid: str, message: dict[str, Any], by_id: dict[str, dict[str, Any]]
) -> tuple[str | None, str | None]:
    """The nearest ancestor present in the corpus.

    In-Reply-To is the sender's direct claim and is tried first. References is
    the fallback, walked from the end backwards because the last entry is the
    nearest ancestor — that way a reply whose immediate parent was not crawled
    attaches to its grandparent instead of silently becoming a root.
    """
    for candidate in message["in_reply_to"]:
        if candidate != mid and candidate in by_id:
            return candidate, "in_reply_to"
    for candidate in reversed(message["references"]):
        if candidate != mid and candidate in by_id:
            return candidate, "references"
    return None, None


def _threads(
    graph: nx.DiGraph, by_id: dict[str, dict[str, Any]]
) -> tuple[list[dict[str, Any]], dict[str, str], dict[str, int]]:
    threads: list[dict[str, Any]] = []
    node_thread: dict[str, str] = {}
    node_depth: dict[str, int] = {}

    for component in nx.weakly_connected_components(graph):
        members = sorted(component, key=lambda m: _canonical_key(by_id[m]))
        # Every node has at most one parent, so a component is a tree with one
        # root — unless malformed headers produced a cycle, in which case the
        # earliest message is used as the root rather than dropping the thread.
        roots = [m for m in members if graph.out_degree(m) == 0]
        root = roots[0] if roots else members[0]

        undirected = graph.subgraph(component).to_undirected()
        depths = nx.single_source_shortest_path_length(undirected, root)
        for member in members:
            node_thread[member] = root
            node_depth[member] = depths.get(member, 0)

        sent = [by_id[m]["sent_at"] for m in members if by_id[m]["sent_at"]]
        reply_pairs = graph.subgraph(component).number_of_edges()
        parents_with_replies = sum(1 for m in members if graph.in_degree(m) > 0)

        threads.append(
            {
                "thread_id": root,
                "list_name": by_id[root]["list_name"],
                "subject": by_id[root]["subject"],
                "message_count": len(members),
                "distinct_senders": len({by_id[m]["sender_id"] for m in members}),
                "max_depth": max(depths.values()) if depths else 0,
                "mean_branching_factor": (
                    reply_pairs / parents_with_replies if parents_with_replies else 0.0
                ),
                "started_at": min(sent) if sent else None,
                "last_message_at": max(sent) if sent else None,
                "reply_pairs": reply_pairs,
            }
        )

    threads.sort(key=lambda t: (-t["message_count"], t["thread_id"]))
    return threads, node_thread, node_depth


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--events", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument(
        "--list",
        action="append",
        dest="lists",
        help="Restrict to a list. Repeatable. Default: every list in the log.",
    )
    parser.add_argument("--generated-at", default=None, help="ISO timestamp, for reproducible output.")
    args = parser.parse_args()

    state = replay(args.events, set(args.lists) if args.lists else None)
    built = build(state.messages)
    built["diagnostics"]["messages_superseded_skipped"] = state.superseded_skipped

    sent = [m["sent_at"] for m in state.messages if m["sent_at"]]
    artifact = {
        "schema_version": SCHEMA_VERSION,
        "derived": True,
        "generated_at": args.generated_at
        or datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "generator": GENERATOR,
        "coverage": {
            "lists": sorted({m["list_name"] for m in state.messages}),
            "event_count": state.events_total,
            "message_event_count": len(state.messages),
            "observed_from": state.observed_from,
            "observed_to": state.observed_to,
            "sent_from": min(sent) if sent else None,
            "sent_to": max(sent) if sent else None,
            "windows": [
                {
                    "list_name": w["list_name"],
                    "mode": w["mode"],
                    "started_at": w["started_at"],
                    "completed_at": w["completed_at"],
                    "mailbox_total": w["mailbox_total"],
                    "uids_examined": w["uids_examined"],
                    "failure_count": len(w["failures"]),
                }
                for w in state.windows
            ],
        },
        **built,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(artifact, indent=2, sort_keys=False) + "\n", encoding="utf-8")
    print(json.dumps({"out": str(args.out), **artifact["diagnostics"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
