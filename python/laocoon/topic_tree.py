"""Hierarchical topics, scored on held-out prediction.

    uv run --directory python python -m laocoon.topic_tree \
        --events ../events --cache ../.cache/embeddings/nomic-embed-text__sentence-v1 \
        --out ../artifacts/topic-tree-agentproto.json --list agentproto

Replaces the flat clustering in `laocoon.topics`, which failed in two ways worth
keeping in view because both are easy to reintroduce.

**It over-merged.** A single global threshold with average linkage chains: on
agentproto it put 19 of 24 threads into one topic; on agent2agent even the
tightest threshold left one cluster holding 74% of the messages. Forcing every
thread into some topic is what produces the blob, so here a thread may stay
**unassigned** — that is a legitimate answer for a one-off message that belongs
with nothing.

**Its calibration objective was degenerate.** Scoring "same topic" against "these
threads share a participant" rewards merging on a densely connected list, so the
optimiser walked toward one cluster. This scores topics the way every other
measure in the project is scored: **held-out prediction**. Does knowing a
thread's topic at time *T* help predict which threads receive replies in
*(T, T+h]*? A giant cluster predicts nothing about *which* member revives, so
merging cannot game it.

Topics nest. A parent groups sub-topics that are close but distinguishable,
which is what the corpus actually looks like: "charter scope" contains "trust
model", "session lifecycle" and so on.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np
from scipy.stats import spearmanr
from sklearn.cluster import AgglomerativeClustering

from .events import replay
from .measures import messages_up_to, parse_time
from .reply_graph import build
from .topics import load_sentence_vectors, normalise_subject, novelty_scores

GENERATOR = "laocoon.topic_tree/0.1.0"

#: Child clusters must be this tight. Complete linkage, not average: average
#: linkage chains, which is what produced the blob.
CHILD_THRESHOLDS = [0.08, 0.10, 0.12, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40]
#: Parents group children. Looser, and only used to nest — never to merge
#: members, so a bad parent costs grouping and not membership.
PARENT_THRESHOLD = 0.55
#: A cluster holding more than this share of all threads is a blob, not a topic.
MAX_CLUSTER_SHARE = 0.35


def load_gists(cache: Path, digests: set[str]) -> dict[str, str]:
    """First authored sentence of each message, from the sentence cache.

    Extractive, not generated: the sentences are already there from embedding,
    it costs nothing, and it cannot hallucinate. A model summary of 1,339
    messages would be seven hours of local inference to produce something a
    reader can already get from the first line.
    """
    out: dict[str, str] = {}
    for digest in digests:
        hexd = digest.replace("sha256:", "")
        path = cache / hexd[:2] / f"{hexd}.json"
        if not path.exists():
            continue
        blob = json.loads(path.read_text())
        if isinstance(blob, dict) and blob.get("sentences"):
            out[digest] = str(blob["sentences"][0])[:220]
    return out


def thread_vectors(
    graph: dict[str, Any], body_of: dict[str, str], sentence_vectors: dict[str, np.ndarray]
) -> tuple[list[str], np.ndarray]:
    members: dict[str, list[np.ndarray]] = defaultdict(list)
    for n in graph["nodes"]:
        m = sentence_vectors.get(body_of.get(n["message_id"], ""))
        if m is not None:
            members[n["thread_id"]].append(m.mean(axis=0))
    ids = sorted(members)
    if not ids:
        return [], np.zeros((0, 1), dtype=np.float32)
    rows = []
    for t in ids:
        v = np.mean(members[t], axis=0)
        rows.append(v / (np.linalg.norm(v) or 1.0))
    return ids, np.vstack(rows)


def holdout_score(
    labels: dict[str, int],
    graph_at_horizon: dict[str, Any],
    thread_ids: list[str],
    origin: datetime,
    horizon: datetime,
) -> float | None:
    """Does a thread's topic help predict which threads revive?

    For each thread, the predictor is how many replies *its topic siblings*
    received in the window before the origin — the topic's momentum, excluding
    the thread itself. That is scored against what the thread actually received
    after the origin. A single giant cluster gives every thread the same
    predictor, so its correlation collapses; that is the property that makes
    this objective safe to optimise against.
    """
    replies_before: dict[str, int] = defaultdict(int)
    replies_after: dict[str, int] = defaultdict(int)
    window_start = origin - (horizon - origin)
    for n in graph_at_horizon["nodes"]:
        if not n["sent_at"]:
            continue
        sent = parse_time(n["sent_at"])
        if window_start < sent <= origin:
            replies_before[n["thread_id"]] += 1
        elif origin < sent <= horizon:
            replies_after[n["thread_id"]] += 1

    siblings: dict[int, list[str]] = defaultdict(list)
    for t in thread_ids:
        siblings[labels[t]].append(t)

    predicted, observed = [], []
    for t in thread_ids:
        peers = [s for s in siblings[labels[t]] if s != t]
        predicted.append(float(sum(replies_before[s] for s in peers)))
        observed.append(float(replies_after[t]))
    if len(set(predicted)) < 2 or len(set(observed)) < 2:
        return None
    result = spearmanr(predicted, observed)
    value = float(result.statistic)
    return None if value != value else value


def build_tree(
    thread_ids: list[str],
    matrix: np.ndarray,
    graph_at_horizon: dict[str, Any],
    origins: list[tuple[datetime, datetime]],
    subjects: dict[str, str],
) -> dict[str, Any]:
    """Choose a child threshold by held-out prediction, then nest the result."""

    def score(labels: dict[str, int]) -> float | None:
        scores = [
            s
            for origin, horizon in origins
            if (s := holdout_score(labels, graph_at_horizon, thread_ids, origin, horizon))
            is not None
        ]
        return float(np.median(scores)) if scores else None

    baseline_subject = {t: hash(normalise_subject(subjects[t])) for t in thread_ids}
    subject_score = score(baseline_subject)
    # Everything in one topic: the degenerate partition the old objective walked
    # toward. Scored explicitly so its failure is on the record.
    blob_score = score({t: 0 for t in thread_ids})

    trials: list[dict[str, Any]] = []
    best: dict[str, Any] | None = None
    for threshold in CHILD_THRESHOLDS:
        assignment = AgglomerativeClustering(
            n_clusters=None, distance_threshold=threshold, metric="cosine", linkage="complete"
        ).fit_predict(matrix)
        labels = {t: int(assignment[i]) for i, t in enumerate(thread_ids)}
        sizes = defaultdict(int)
        for c in labels.values():
            sizes[c] += 1
        largest_share = max(sizes.values()) / len(thread_ids)
        value = score(labels)
        trials.append(
            {
                "threshold": threshold,
                "clusters": int(len(sizes)),
                "largest_cluster_share": round(largest_share, 3),
                "holdout_spearman": round(value, 4) if value is not None else None,
                "rejected_as_blob": bool(largest_share > MAX_CLUSTER_SHARE),
            }
        )
        if largest_share > MAX_CLUSTER_SHARE or value is None:
            continue
        if best is None or value > best["score"]:
            best = {"threshold": threshold, "score": value, "labels": labels}

    return {
        "trials": trials,
        "subject_baseline_holdout": round(subject_score, 4) if subject_score is not None else None,
        "single_cluster_holdout": round(blob_score, 4) if blob_score is not None else None,
        "max_cluster_share": MAX_CLUSTER_SHARE,
        "chosen": best,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--events", required=True, type=Path)
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--list", dest="list_name", required=True)
    parser.add_argument("--horizon-days", type=int, default=None)
    args = parser.parse_args()

    state = replay(args.events, {args.list_name})
    graph = build(state.messages)
    body_of = {m["message_id"]: m["body"]["sha256"] for m in state.messages if m["message_id"]}
    sentence_vectors = load_sentence_vectors(args.cache, set(body_of.values()))
    subjects = {t["thread_id"]: t["subject"] for t in graph["threads"]}

    gist_by_digest = load_gists(args.cache, set(body_of.values()))
    novelty = novelty_scores(graph, body_of, sentence_vectors)
    ids, matrix = thread_vectors(graph, body_of, sentence_vectors)
    if len(ids) < 6:
        raise SystemExit(f"only {len(ids)} threads have embeddings")

    sent = sorted(parse_time(m["sent_at"]) for m in state.messages if m["sent_at"])
    # Horizon from the list's own thread lifespans rather than a global constant:
    # agentproto's p90 is 96 hours and agent2agent's is 180, and one number
    # cannot be right for both.
    if args.horizon_days is None:
        spans = []
        for t in graph["threads"]:
            if t["started_at"] and t["last_message_at"]:
                spans.append(
                    (parse_time(t["last_message_at"]) - parse_time(t["started_at"])).total_seconds()
                    / 86400
                )
        horizon_days = max(2, int(round(float(np.percentile(spans, 90))))) if spans else 7
    else:
        horizon_days = args.horizon_days

    step = timedelta(days=max(1, horizon_days // 2))
    origins: list[tuple[datetime, datetime]] = []
    cursor = sent[-1] - timedelta(days=horizon_days)
    while cursor > sent[0] and len(origins) < 12:
        origins.append((cursor, cursor + timedelta(days=horizon_days)))
        cursor -= step
    graph_at_horizon = build(messages_up_to(state.messages, sent[-1]))

    result = build_tree(ids, matrix, graph_at_horizon, origins, subjects)
    chosen = result.pop("chosen")

    topics: list[dict[str, Any]] = []
    unassigned: list[str] = []
    parents: dict[int, int] = {}

    if chosen is not None:
        labels: dict[str, int] = chosen["labels"]
        groups: dict[int, list[str]] = defaultdict(list)
        for t, c in labels.items():
            groups[c].append(t)

        # A thread alone in its cluster is not a topic; it is a thread. Saying so
        # beats chaining it into a neighbour to avoid an empty-looking result.
        singletons = [ts[0] for c, ts in groups.items() if len(ts) == 1]
        unassigned = sorted(singletons)
        real = {c: ts for c, ts in groups.items() if len(ts) > 1}

        if real:
            centroids = np.vstack(
                [
                    (lambda v: v / (np.linalg.norm(v) or 1.0))(
                        np.mean([matrix[ids.index(t)] for t in ts], axis=0)
                    )
                    for ts in real.values()
                ]
            )
            keys = list(real)
            if len(keys) > 1:
                parent_assign = AgglomerativeClustering(
                    n_clusters=None,
                    distance_threshold=PARENT_THRESHOLD,
                    metric="cosine",
                    linkage="complete",
                ).fit_predict(centroids)
                parents = {keys[i]: int(parent_assign[i]) for i in range(len(keys))}
            else:
                parents = {keys[0]: 0}

            for c, ts in sorted(real.items(), key=lambda kv: (-len(kv[1]), kv[0])):
                members = set(ts)
                topics.append(
                    {
                        "id": f"topic-{c}",
                        "parent_id": f"group-{parents[c]}",
                        "label": None,
                        "threads": sorted(ts),
                        "thread_count": len(ts),
                        "message_count": sum(
                            1 for n in graph["nodes"] if n["thread_id"] in members
                        ),
                        "distinct_senders": len(
                            {n["sender_id"] for n in graph["nodes"] if n["thread_id"] in members}
                        ),
                        "subjects": sorted({subjects[t] for t in ts}),
                        "started_at": min(
                            (
                                t_["started_at"]
                                for t_ in graph["threads"]
                                if t_["thread_id"] in members and t_["started_at"]
                            ),
                            default=None,
                        ),
                    }
                )

    thread_rows = []
    for th in graph["threads"]:
        tid = th["thread_id"]
        members = [n for n in graph["nodes"] if n["thread_id"] == tid]
        vals = [novelty[n["message_id"]] for n in members if n["message_id"] in novelty]
        thread_rows.append(
            {
                "id": tid,
                "subject": th["subject"],
                "gist": gist_by_digest.get(body_of.get(tid, ""), ""),
                "message_count": th["message_count"],
                "distinct_senders": th["distinct_senders"],
                "max_depth": th["max_depth"],
                "started_at": th["started_at"],
                "last_message_at": th["last_message_at"],
                "median_novelty": round(float(np.median(vals)), 4) if vals else None,
            }
        )
    thread_rows.sort(key=lambda r: (-r["message_count"], r["id"]))

    artifact = {
        "schema_version": "1.0.0",
        "derived": True,
        "publication": "aggregate_public",
        "generated_at": datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
        "generator": GENERATOR,
        "list_name": args.list_name,
        "horizon_days": horizon_days,
        "origins_scored": len(origins),
        "calibration": result,
        "chosen_threshold": chosen["threshold"] if chosen else None,
        "holdout_spearman": round(chosen["score"], 4) if chosen else None,
        "topics": topics,
        "threads": thread_rows,
        "unassigned_threads": unassigned,
        "parent_groups": sorted({t["parent_id"] for t in topics}),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")

    print(
        json.dumps(
            {
                "out": str(args.out),
                "list": args.list_name,
                "horizon_days": horizon_days,
                "threads": len(ids),
                "topics": len(topics),
                "parent_groups": len(artifact["parent_groups"]),
                "unassigned": len(unassigned),
                "largest_topic_share": round(
                    max((t["thread_count"] for t in topics), default=0) / max(1, len(ids)), 3
                ),
                "holdout_spearman": artifact["holdout_spearman"],
                "subject_baseline": result["subject_baseline_holdout"],
                "single_cluster": result["single_cluster_holdout"],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
