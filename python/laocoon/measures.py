"""Per-thread measures, as of a data horizon.

    uv run --directory python python -m laocoon.measures \
        --events ../events --private-events ../private/events \
        --seed ../private/artifacts/seed.json \
        --out ../artifacts/thread-measures.json --as-of 2026-08-15T00:00:00Z

Produces the vector PROBLEM.md section 7 publishes: distinct participants, reply
depth, core/periphery mix, substantive-reply ratio, new-participant share, side
by side. **There is no composite score and there must not be one** — a single
number invites an argument about weights that cannot be won, and one disputed
input would contaminate the whole ranking instead of one column.

Everything here is a count or a ratio over a thread. No participant is named. The
per-message substance verdicts this reads come from the private log and stay
there; only their per-thread aggregate crosses into the public log.

`as_of` is a data horizon, not a wall clock. Only messages sent at or before it
are counted, which is what makes the temporal holdout in `laocoon.holdout`
possible: it can ask what the measures would have said last week.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

import networkx as nx

from .events import iter_events, replay
from .reply_graph import build
from .reputation import build_account_graph

GENERATOR = "laocoon.measures/0.1.0"


def parse_time(value: str) -> datetime:
    """Parse an ISO 8601 timestamp, tolerating the trailing Z form."""
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def load_verdicts(private_events: Path, model: str) -> dict[tuple[str, str], str]:
    """Substance verdicts for one model, keyed by (message_id, body digest).

    Keying on the body digest means a verdict never carries over to a message
    whose text changed underneath it. `error` verdicts are dropped: a pipeline
    failure is not a judgement, and treating it as one would let a broken run
    look like a corpus full of hollow replies.
    """
    verdicts: dict[tuple[str, str], str] = {}
    if not private_events.exists():
        return verdicts
    for event in iter_events(private_events):
        if event["event_type"] != "MessageClassified":
            continue
        payload = event["payload"]
        if payload["model"] != model or payload["verdict"] == "error":
            continue
        verdicts[(payload["message_id"], payload["body_sha256"])] = payload["verdict"]
    return verdicts


def messages_up_to(messages: Iterable[dict[str, Any]], as_of: datetime) -> list[dict[str, Any]]:
    """Messages sent at or before the horizon. Undated messages are excluded.

    An undated message cannot be placed in time, so including it would silently
    leak the future into a measurement that claims to be as-of a date.
    """
    kept = []
    for message in messages:
        if not message["sent_at"]:
            continue
        if parse_time(message["sent_at"]) <= as_of:
            kept.append(message)
    return kept


def thread_measures(
    messages: list[dict[str, Any]],
    verdicts: dict[tuple[str, str], str],
    seed_ids: set[str],
    *,
    as_of: datetime,
    window_days: int,
    new_participant_window_days: int,
    list_name: str,
    provenance: dict[str, str],
) -> list[dict[str, Any]]:
    """The measure vector for every thread present at the horizon."""
    visible = messages_up_to(messages, as_of)
    graph = build(visible)
    body_of = {m["message_id"]: m["body"]["sha256"] for m in visible if m["message_id"]}

    accounts, _ = build_account_graph(graph)
    cores = nx.core_number(nx.Graph(accounts.to_undirected())) if accounts.number_of_nodes() else {}

    first_seen: dict[str, datetime] = {}
    for message in visible:
        sent = parse_time(message["sent_at"])
        sender = message["sender_id"]
        if sender not in first_seen or sent < first_seen[sender]:
            first_seen[sender] = sent

    window_start = as_of - timedelta(days=window_days)
    new_cutoff = as_of - timedelta(days=new_participant_window_days)
    # A message is a reply when it resolved a parent inside the corpus.
    has_parent = {edge["child"] for edge in graph["edges"]}

    out = []
    for thread in graph["threads"]:
        members = [n for n in graph["nodes"] if n["thread_id"] == thread["thread_id"]]
        senders = {n["sender_id"] for n in members}
        in_window = [n for n in members if n["sent_at"] and parse_time(n["sent_at"]) > window_start]

        replies = [n for n in members if n["message_id"] in has_parent]
        substantive = hollow = unclear = unclassified = 0
        for reply in replies:
            digest = body_of.get(reply["message_id"])
            verdict = verdicts.get((reply["message_id"], digest)) if digest else None
            if verdict == "substantive":
                substantive += 1
            elif verdict == "hollow":
                hollow += 1
            elif verdict == "unclear":
                unclear += 1
            else:
                unclassified += 1

        judged = substantive + hollow
        quoting = sum(1 for r in replies if r["body"]["quoted_lines"] > 0)
        member_cores = [cores.get(s, 0) for s in senders]

        out.append(
            {
                "thread_id": thread["thread_id"],
                "list_name": list_name,
                "subject": thread["subject"],
                "measured_at": as_of.astimezone(timezone.utc)
                .isoformat(timespec="seconds")
                .replace("+00:00", "Z"),
                "window_days": window_days,
                "new_participant_window_days": new_participant_window_days,
                "messages_total": len(members),
                "distinct_senders": len(senders),
                "max_depth": thread["max_depth"],
                "reply_pairs": thread["reply_pairs"],
                "mean_branching_factor": thread["mean_branching_factor"],
                "messages_in_window": len(in_window),
                "distinct_senders_in_window": len({n["sender_id"] for n in in_window}),
                "replies_classified": judged + unclear,
                "substantive_replies": substantive,
                "hollow_replies": hollow,
                "unclear_replies": unclear,
                "unclassified_replies": unclassified,
                # None, never 0, when nothing was judged: an unmeasured thread
                # and a thread of hollow replies are different facts.
                "substantive_reply_ratio": (substantive / judged) if judged else None,
                "quoting_reply_ratio": (quoting / len(replies)) if replies else None,
                "seeded_participants": len(senders & seed_ids),
                "new_participants": sum(
                    1 for s in senders if first_seen.get(s, as_of) > new_cutoff
                ),
                "new_participant_share": (
                    sum(1 for s in senders if first_seen.get(s, as_of) > new_cutoff) / len(senders)
                    if senders
                    else None
                ),
                "max_core_number": max(member_cores, default=0),
                "mean_core_number": (sum(member_cores) / len(member_cores)) if member_cores else 0.0,
                "provenance": provenance,
            }
        )

    out.sort(key=lambda t: (-t["messages_total"], t["thread_id"]))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--events", required=True, type=Path)
    parser.add_argument("--private-events", required=True, type=Path)
    parser.add_argument("--seed", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--as-of", required=True)
    parser.add_argument("--window-days", type=int, default=7)
    parser.add_argument("--new-participant-window-days", type=int, default=14)
    parser.add_argument("--model", default="gemma4:12b", help="reference classifier")
    parser.add_argument("--prompt-hash", required=True)
    parser.add_argument("--prompt-version", required=True)
    parser.add_argument("--list", dest="list_name", default="agentproto")
    args = parser.parse_args()

    as_of = parse_time(args.as_of)
    seed_doc = json.loads(args.seed.read_text(encoding="utf-8"))
    seed_ids = {m["sender_id"] for m in seed_doc["members"]}

    state = replay(args.events, {args.list_name})
    verdicts = load_verdicts(args.private_events, args.model)

    provenance = {
        "seed_rule_version": seed_doc["seed_rule_version"],
        "classifier_model": args.model,
        "prompt_hash": args.prompt_hash,
        "prompt_version": args.prompt_version,
        "generator": GENERATOR,
    }

    measures = thread_measures(
        state.messages,
        verdicts,
        seed_ids,
        as_of=as_of,
        window_days=args.window_days,
        new_participant_window_days=args.new_participant_window_days,
        list_name=args.list_name,
        provenance=provenance,
    )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(measures, indent=2) + "\n", encoding="utf-8")

    judged = sum(m["substantive_replies"] + m["hollow_replies"] for m in measures)
    print(
        json.dumps(
            {
                "out": str(args.out),
                "threads": len(measures),
                "replies_judged": judged,
                "substantive": sum(m["substantive_replies"] for m in measures),
                "hollow": sum(m["hollow_replies"] for m in measures),
                "unclear": sum(m["unclear_replies"] for m in measures),
                "unclassified": sum(m["unclassified_replies"] for m in measures),
                "threads_with_no_ratio": sum(
                    1 for m in measures if m["substantive_reply_ratio"] is None
                ),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
