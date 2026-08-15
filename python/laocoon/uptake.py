"""Message-level uptake, and per-sender investment in a thread.

    uv run --directory python python -m laocoon.uptake \
        --events ../events --seed ../private/artifacts/seed.json \
        --reputation ../private/artifacts/reputation.json \
        --cache ../.cache/embeddings/nomic-embed-text__sentence-v1 \
        --out ../private/artifacts/uptake-agentproto.json --list agentproto

Two questions the thread-level view cannot answer.

**Which messages worked?** A message's *uptake* is the engagement it drew, and
replies are not interchangeable: a reply from someone the group listens to is
worth more than a reply from someone it does not. So uptake comes in three
forms, reported side by side rather than blended —

  replies            how many direct replies it drew
  uptake_reputation  those replies weighted by the replier's PageRank
  uptake_standing    how many came from an account with community-conferred
                     standing, and how many from a steward of this list

This is reception, and it is the whole reason the project can work without ever
touching provenance: PROBLEM.md §4's insight is that reception is measurable
where authorship is not. A message written by anyone at all, in any way at all,
gets the same uptake score for the same engagement.

**How invested is a sender in a thread?** Not message count alone — that counts
a one-line "+1" the same as a long argument. Investment combines how many
messages, how much *authored* text (quotes excluded), how long they stayed, and
how deep into the reply tree they went.

Private: every row joins to a person. The publishable form is the thread-level
aggregate.
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
from .measures import parse_time
from .reply_graph import build
from .topics import load_sentence_vectors, novelty_scores

GENERATOR = "laocoon.uptake/0.1.0"


def load_gists(cache: Path, digests: set[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for digest in digests:
        hexd = digest.replace("sha256:", "")
        path = cache / hexd[:2] / f"{hexd}.json"
        if not path.exists():
            continue
        blob = json.loads(path.read_text())
        if isinstance(blob, dict) and blob.get("sentences"):
            out[digest] = str(blob["sentences"][0])[:200]
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--events", required=True, type=Path)
    parser.add_argument("--seed", required=True, type=Path)
    parser.add_argument("--reputation", required=True, type=Path)
    parser.add_argument("--stewards", type=Path, default=None)
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--list", dest="list_name", required=True)
    args = parser.parse_args()

    seed_doc = json.loads(args.seed.read_text(encoding="utf-8"))
    seed_ids = {m["sender_id"] for m in seed_doc["members"]}
    rep_doc = json.loads(args.reputation.read_text(encoding="utf-8"))
    reputation = {a["sender_id"]: (a.get("ppr_replies") or 0.0) for a in rep_doc["accounts"]}

    steward_ids: set[str] = set()
    if args.stewards and args.stewards.exists():
        steward_ids = set(json.loads(args.stewards.read_text(encoding="utf-8")))

    state = replay(args.events, {args.list_name})
    graph = build(state.messages)
    node_of = {n["message_id"]: n for n in graph["nodes"]}
    payload_of = {m["message_id"]: m for m in state.messages if m["message_id"]}
    body_of = {mid: m["body"]["sha256"] for mid, m in payload_of.items()}

    sentence_vectors = load_sentence_vectors(args.cache, set(body_of.values()))
    novelty = novelty_scores(graph, body_of, sentence_vectors)
    gists = load_gists(args.cache, set(body_of.values()))

    # --- uptake: who replied to each message ------------------------------
    repliers: dict[str, list[str]] = defaultdict(list)
    for edge in graph["edges"]:
        child = node_of[edge["child"]]
        # A reply to yourself is not uptake. It is you, again.
        if child["sender_id"] != node_of[edge["parent"]]["sender_id"]:
            repliers[edge["parent"]].append(child["sender_id"])

    messages = []
    for n in graph["nodes"]:
        mid = n["message_id"]
        who = repliers.get(mid, [])
        body = payload_of[mid]["body"] if mid in payload_of else {}
        messages.append(
            {
                "id": mid,
                "thread_id": n["thread_id"],
                "sender_id": n["sender_id"],
                "sent_at": n["sent_at"],
                "depth": n["depth"],
                "gist": gists.get(body_of.get(mid, ""), ""),
                "authored_lines": body.get("unquoted_lines", 0),
                "novelty": round(novelty[mid], 4) if mid in novelty else None,
                "replies": len(who),
                "distinct_repliers": len(set(who)),
                # Reception weighted by whose attention it drew. Reported beside
                # the raw count, never instead of it.
                "uptake_reputation": round(sum(reputation.get(r, 0.0) for r in set(who)), 6),
                "replies_from_standing": sum(1 for r in set(who) if r in seed_ids),
                "replies_from_stewards": sum(1 for r in set(who) if r in steward_ids),
            }
        )
    messages.sort(key=lambda m: (m["thread_id"], m["sent_at"] or ""))

    # --- investment: how much a sender put into a thread ------------------
    invest: dict[tuple[str, str], dict[str, Any]] = {}
    for m in messages:
        key = (m["sender_id"], m["thread_id"])
        row = invest.setdefault(
            key,
            {
                "messages": 0,
                "authored_lines": 0,
                "max_depth": 0,
                "first": None,
                "last": None,
                "replies_drawn": 0,
                "uptake_reputation": 0.0,
                "replies_from_standing": 0,
            },
        )
        row["messages"] += 1
        row["authored_lines"] += m["authored_lines"]
        row["max_depth"] = max(row["max_depth"], m["depth"])
        row["replies_drawn"] += m["replies"]
        row["uptake_reputation"] += m["uptake_reputation"]
        row["replies_from_standing"] += m["replies_from_standing"]
        if m["sent_at"]:
            if row["first"] is None or m["sent_at"] < row["first"]:
                row["first"] = m["sent_at"]
            if row["last"] is None or m["sent_at"] > row["last"]:
                row["last"] = m["sent_at"]

    thread_lines: dict[str, int] = defaultdict(int)
    for (_, thread), row in invest.items():
        thread_lines[thread] += row["authored_lines"]

    investment = []
    for (person, thread), row in sorted(invest.items()):
        hours = 0.0
        if row["first"] and row["last"]:
            hours = (parse_time(row["last"]) - parse_time(row["first"])).total_seconds() / 3600
        investment.append(
            {
                "person": person,
                "thread": thread,
                "messages": row["messages"],
                "authored_lines": row["authored_lines"],
                # Share of everything actually written in the thread. Message
                # count alone scores a one-line "+1" the same as an argument.
                "share_of_authored_text": round(
                    row["authored_lines"] / max(1, thread_lines[thread]), 4
                ),
                "max_depth": row["max_depth"],
                "hours_engaged": round(hours, 2),
                "replies_drawn": row["replies_drawn"],
                "uptake_reputation": round(row["uptake_reputation"], 6),
                "replies_from_standing": row["replies_from_standing"],
            }
        )

    drew = [m for m in messages if m["replies"] > 0]
    artifact = {
        "schema_version": "1.0.0",
        "derived": True,
        "publication": "private",
        "generated_at": datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
        "generator": GENERATOR,
        "list_name": args.list_name,
        "messages": messages,
        "investment": investment,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")

    print(
        json.dumps(
            {
                "out": str(args.out),
                "list": args.list_name,
                "messages": len(messages),
                "messages_that_drew_a_reply": len(drew),
                "messages_with_a_reply_from_standing": sum(
                    1 for m in messages if m["replies_from_standing"] > 0
                ),
                "median_uptake_reputation_of_replied_to": round(
                    float(np.median([m["uptake_reputation"] for m in drew])), 6
                )
                if drew
                else None,
                "investment_rows": len(investment),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
