"""Graph data for the operator's private view.

    uv run --directory python python -m laocoon.private_view \
        --events ../events --seed ../private/artifacts/seed.json \
        --reputation ../private/artifacts/reputation.json \
        --out ../private/artifacts/sender-view.json

**Private, permanently.** This names participants and ranks them — exactly what
PROBLEM.md section 7 keeps out of publication. Section 7 makes it private *to
Orie*, not nonexistent: the operator is meant to be able to look at it. The
artifact declares `publication: private`, which the site build rejects on sight.

Two graphs come out of here, following the standard treatment of threaded
conversation networks in the CSCW literature (Hansen, Shneiderman & Smith,
*Visualizing Threaded Conversation Networks*, 2010):

* a **bipartite participation graph** — people *and threads* are both nodes, and
  an edge means "this person posted in this thread". This answers *who engages
  with what*, which a person-to-person graph structurally cannot: two people who
  never reply to each other but always appear in the same threads are adjacent
  here and invisible there.
* a **reply graph** — person to person, edge from the replier to the author they
  replied to. This answers *who engages with whom*.

No layout is computed here. Positions come from fCoSE in the browser, which
handles disconnected components properly and scales far past anything a
hand-rolled relaxation pass would.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .events import replay
from .reply_graph import build
from .reputation import build_account_graph

GENERATOR = "laocoon.private_view/0.3.0"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--events", required=True, type=Path)
    parser.add_argument("--seed", required=True, type=Path)
    parser.add_argument("--reputation", required=True, type=Path)
    parser.add_argument("--measures", type=Path, default=None)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--list", dest="list_name", default="agentproto")
    args = parser.parse_args()

    seed_doc = json.loads(args.seed.read_text(encoding="utf-8"))
    clauses_of = {m["sender_id"]: m["clauses"] for m in seed_doc["members"]}
    unseeded_reason = {u["sender_id"]: u["reason"] for u in seed_doc["unseeded"]}

    rep_doc = json.loads(args.reputation.read_text(encoding="utf-8"))
    rep = {a["sender_id"]: a for a in rep_doc["accounts"]}

    measures: dict[str, dict[str, Any]] = {}
    if args.measures and args.measures.exists():
        for m in json.loads(args.measures.read_text(encoding="utf-8")):
            measures[m["thread_id"]] = m

    state = replay(args.events, {args.list_name})
    graph = build(state.messages)
    accounts, self_loops = build_account_graph(graph)

    node_of = {n["message_id"]: n for n in graph["nodes"]}
    thread_of = {t["thread_id"]: t for t in graph["threads"]}

    # --- participation: person x thread ------------------------------------
    participation: dict[tuple[str, str], dict[str, int]] = {}
    for n in graph["nodes"]:
        cell = participation.setdefault(
            (n["sender_id"], n["thread_id"]), {"messages": 0, "replies": 0}
        )
        cell["messages"] += 1
    for edge in graph["edges"]:
        child = node_of[edge["child"]]
        participation[(child["sender_id"], child["thread_id"])]["replies"] += 1

    # --- per person ---------------------------------------------------------
    per_person: dict[str, dict[str, Any]] = {}
    for n in graph["nodes"]:
        row = per_person.setdefault(
            n["sender_id"],
            {
                "messages": 0,
                "threads": set(),
                "first_seen": None,
                "last_seen": None,
                "started_threads": 0,
            },
        )
        row["messages"] += 1
        row["threads"].add(n["thread_id"])
        if n["thread_id"] == n["message_id"]:
            row["started_threads"] += 1
        if n["sent_at"]:
            if row["first_seen"] is None or n["sent_at"] < row["first_seen"]:
                row["first_seen"] = n["sent_at"]
            if row["last_seen"] is None or n["sent_at"] > row["last_seen"]:
                row["last_seen"] = n["sent_at"]

    replies_sent: dict[str, int] = {}
    replies_received: dict[str, int] = {}
    for edge in graph["edges"]:
        child = node_of[edge["child"]]["sender_id"]
        parent = node_of[edge["parent"]]["sender_id"]
        replies_sent[child] = replies_sent.get(child, 0) + 1
        replies_received[parent] = replies_received.get(parent, 0) + 1

    persons = []
    for pid, row in per_person.items():
        r = rep.get(pid, {})
        top = sorted(
            ((t, participation[(pid, t)]["messages"]) for t in row["threads"]),
            key=lambda kv: (-kv[1], kv[0]),
        )[:8]
        persons.append(
            {
                "id": pid,
                "messages": row["messages"],
                "threads_participated": len(row["threads"]),
                "threads_started": row["started_threads"],
                "replies_sent": replies_sent.get(pid, 0),
                "replies_received": replies_received.get(pid, 0),
                "first_seen": row["first_seen"],
                "last_seen": row["last_seen"],
                "seeded": pid in clauses_of,
                "clauses": clauses_of.get(pid, []),
                "unseeded_reason": unseeded_reason.get(pid),
                "ppr_replies": r.get("ppr_replies"),
                "ppr_quoting": r.get("ppr_quoting"),
                "rank_replies": r.get("rank_replies"),
                "community": r.get("community"),
                "core_number": r.get("core_number"),
                "top_threads": [{"thread_id": t, "messages": n} for t, n in top],
            }
        )
    persons.sort(key=lambda a: (-(a["ppr_replies"] or 0), a["id"]))

    threads = []
    for tid, t in thread_of.items():
        m = measures.get(tid, {})
        threads.append(
            {
                "id": tid,
                "subject": t["subject"],
                "message_count": t["message_count"],
                "distinct_senders": t["distinct_senders"],
                "max_depth": t["max_depth"],
                "reply_pairs": t["reply_pairs"],
                "mean_branching_factor": t["mean_branching_factor"],
                "started_at": t["started_at"],
                "last_message_at": t["last_message_at"],
                "root_sender": node_of[tid]["sender_id"] if tid in node_of else None,
                "substantive_reply_ratio": m.get("substantive_reply_ratio"),
                "seeded_participants": m.get("seeded_participants"),
            }
        )
    threads.sort(key=lambda t: (-t["message_count"], t["id"]))

    artifact = {
        "schema_version": "2.0.0",
        "derived": True,
        "publication": "private",
        "generated_at": datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
        "generator": GENERATOR,
        "self_reply_edges_dropped": self_loops,
        "persons": persons,
        "threads": threads,
        "participation": [
            {"person": p, "thread": t, "messages": c["messages"], "replies": c["replies"]}
            for (p, t), c in sorted(participation.items())
        ],
        "replies": sorted(
            (
                {"source": u, "target": v, "replies": d["replies"], "quoting": d["quoting"]}
                for u, v, d in accounts.edges(data=True)
            ),
            key=lambda e: (-e["replies"], e["source"], e["target"]),
        ),
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "out": str(args.out),
                "persons": len(persons),
                "threads": len(threads),
                "participation_edges": len(artifact["participation"]),
                "reply_edges": len(artifact["replies"]),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
