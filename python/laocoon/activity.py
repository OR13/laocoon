"""Daily activity rollup and the thread co-participation graph.

    uv run --directory python python -m laocoon.activity \
        --events ../events --seed ../private/artifacts/seed.json \
        --out ../artifacts/activity.json

Both outputs are **aggregate_public**: every figure is a count over a day or a
thread, and no account appears anywhere. That is what lets the dashboard show a
trend and a graph without publishing a ranked participant list.

Two things come out:

* a **daily series** — messages, threads touched, distinct participants, how many
  of those hold community-conferred standing, how many are new, and the
  substantive/hollow split. Distinct-participant counts are counts, never lists.
* a **thread co-participation graph** — thread nodes, with an edge wherever two
  threads share at least one participant, weighted by how many. This is the
  publishable counterpart to the private bipartite graph: it shows which
  discussions are connected by the same people without saying who they are.

Co-participation edges are rejected between *people* in PROBLEM.md §4, because
they make everyone in a busy thread look connected. Between *threads* the same
construction is the point: it is a statement about which discussions overlap.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from itertools import combinations
from pathlib import Path
from typing import Any

from .events import iter_events, replay
from .measures import load_verdicts, parse_time
from .reply_graph import build

GENERATOR = "laocoon.activity/0.1.0"


def daily_series(
    graph: dict[str, Any],
    verdicts: dict[tuple[str, str], str],
    body_of: dict[str, str],
    seed_ids: set[str],
    first_seen: dict[str, datetime],
    new_participant_window_days: int,
) -> list[dict[str, Any]]:
    """One row per calendar day between the first and last message, inclusive.

    Days with no traffic are emitted as zeroes rather than skipped: a gap in a
    trend line must read as "nothing happened", not as "not measured".
    """
    nodes = [n for n in graph["nodes"] if n["sent_at"]]
    if not nodes:
        return []
    has_parent = {e["child"] for e in graph["edges"]}

    by_day: dict[date, dict[str, Any]] = defaultdict(
        lambda: {
            "messages": 0,
            "replies": 0,
            "threads": set(),
            "participants": set(),
            "seeded": set(),
            "new": set(),
            "substantive": 0,
            "hollow": 0,
            "unclear": 0,
            "unclassified": 0,
        }
    )
    for n in nodes:
        sent = parse_time(n["sent_at"])
        row = by_day[sent.date()]
        row["messages"] += 1
        row["threads"].add(n["thread_id"])
        row["participants"].add(n["sender_id"])
        if n["sender_id"] in seed_ids:
            row["seeded"].add(n["sender_id"])
        seen = first_seen.get(n["sender_id"])
        if seen and (sent - seen).days <= new_participant_window_days and seen.date() == sent.date():
            row["new"].add(n["sender_id"])
        if n["message_id"] in has_parent:
            row["replies"] += 1
            verdict = verdicts.get((n["message_id"], body_of.get(n["message_id"], "")))
            if verdict == "substantive":
                row["substantive"] += 1
            elif verdict == "hollow":
                row["hollow"] += 1
            elif verdict == "unclear":
                row["unclear"] += 1
            else:
                row["unclassified"] += 1

    start = min(by_day)
    end = max(by_day)
    out = []
    cursor = start
    while cursor <= end:
        row = by_day.get(cursor)
        judged = (row["substantive"] + row["hollow"]) if row else 0
        out.append(
            {
                "day": cursor.isoformat(),
                "messages": row["messages"] if row else 0,
                "replies": row["replies"] if row else 0,
                "threads_touched": len(row["threads"]) if row else 0,
                "participants": len(row["participants"]) if row else 0,
                "participants_with_standing": len(row["seeded"]) if row else 0,
                "new_participants": len(row["new"]) if row else 0,
                "substantive_replies": row["substantive"] if row else 0,
                "hollow_replies": row["hollow"] if row else 0,
                "unclear_replies": row["unclear"] if row else 0,
                "unclassified_replies": row["unclassified"] if row else 0,
                # None, never 0, when nothing on that day was judged.
                "substantive_ratio": (row["substantive"] / judged) if judged else None,
            }
        )
        cursor += timedelta(days=1)
    return out


def thread_graph(graph: dict[str, Any], seed_ids: set[str]) -> dict[str, Any]:
    """Threads as nodes, edges where two threads share participants.

    No account identifier appears in the result — only counts of them.
    """
    members: dict[str, set[str]] = defaultdict(set)
    for n in graph["nodes"]:
        members[n["thread_id"]].add(n["sender_id"])

    nodes = [
        {
            "id": t["thread_id"],
            "subject": t["subject"],
            "message_count": t["message_count"],
            "distinct_senders": t["distinct_senders"],
            "max_depth": t["max_depth"],
            "with_standing": len(members[t["thread_id"]] & seed_ids),
            "started_at": t["started_at"],
            "last_message_at": t["last_message_at"],
        }
        for t in graph["threads"]
    ]
    edges = []
    for a, b in combinations(sorted(members), 2):
        shared = len(members[a] & members[b])
        if shared:
            edges.append({"source": a, "target": b, "shared_participants": shared})
    edges.sort(key=lambda e: (-e["shared_participants"], e["source"], e["target"]))
    return {"nodes": nodes, "edges": edges}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--events", required=True, type=Path)
    parser.add_argument("--private-events", type=Path, default=None)
    parser.add_argument("--seed", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--model", default="gemma4:12b")
    parser.add_argument("--new-participant-window-days", type=int, default=14)
    parser.add_argument("--list", dest="list_name", default="agentproto")
    args = parser.parse_args()

    seed_doc = json.loads(args.seed.read_text(encoding="utf-8"))
    seed_ids = {m["sender_id"] for m in seed_doc["members"]}

    state = replay(args.events, {args.list_name})
    graph = build(state.messages)
    body_of = {m["message_id"]: m["body"]["sha256"] for m in state.messages if m["message_id"]}
    verdicts = (
        load_verdicts(args.private_events, args.model) if args.private_events else {}
    )

    first_seen: dict[str, datetime] = {}
    for m in state.messages:
        if not m["sent_at"]:
            continue
        sent = parse_time(m["sent_at"])
        if m["sender_id"] not in first_seen or sent < first_seen[m["sender_id"]]:
            first_seen[m["sender_id"]] = sent

    series = daily_series(
        graph, verdicts, body_of, seed_ids, first_seen, args.new_participant_window_days
    )
    threads = thread_graph(graph, seed_ids)

    artifact = {
        "schema_version": "1.0.0",
        "derived": True,
        "publication": "aggregate_public",
        "generated_at": datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
        "generator": GENERATOR,
        "list_name": args.list_name,
        "seed_rule_version": seed_doc["seed_rule_version"],
        "new_participant_window_days": args.new_participant_window_days,
        "daily": series,
        "thread_graph": threads,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "out": str(args.out),
                "days": len(series),
                "thread_nodes": len(threads["nodes"]),
                "thread_edges": len(threads["edges"]),
                "messages": sum(d["messages"] for d in series),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
