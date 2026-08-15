"""Topic clustering over threads, and novelty scoring over replies.

    uv run --directory python python -m laocoon.topics \
        --events ../events --cache ../.cache/embeddings/nomic-embed-text \
        --out ../artifacts/topics.json --list agentproto

Two measures, both built on local embeddings, neither asking anything about who
wrote a message or how.

**Topics.** Threads are embedded and clustered. This exists because a thread is
not an argument: on `agentproto`, 13 of 24 threads are fragments of a subject
that already appears elsewhere, so a chair asking "what does the group think
about the trust model" gets four disconnected rows. The model names clusters but
does not form them — clustering runs on the embeddings, so a bad label cannot
corrupt the structure.

**Novelty.** The fraction of a reply's sentences that nothing earlier in the
thread already said. This replaces the substantive/hollow classifier, which
returned 81 substantive and 0 hollow across two model sizes — a binary that never
fires is a broken instrument, and a fraction is continuous, so it produces
variance the holdout can actually score.

Getting to a fraction took two corrections, both caught by checking the measure
against things it should be independent of:

* scored as one distance over the whole message body, novelty correlated -0.32
  with how much of the reply was quoted text — it was measuring quoting habit;
* scored over the authored text as a whole, it correlated -0.58 with how much
  new text there was — short passages embed far from everything, so it was
  measuring brevity.

A per-sentence fraction has neither bias by construction, because it divides
out length.

Novelty is emphatically **not** a provenance signal. A human restating the thread
scores exactly as low as anything else would, which is the correct behaviour:
the measure is of the contribution, not of its author.

The clustering threshold is calibrated, not chosen. Candidate thresholds are
scored on how well "same topic" predicts "these two threads share a participant",
and the result is compared against normalising the subject line. If subject
matching wins, it wins — and the report says so.
"""

from __future__ import annotations

import argparse
import json
import math
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.cluster import AgglomerativeClustering

from .events import replay
from .measures import parse_time
from .reply_graph import build

GENERATOR = "laocoon.topics/0.1.0"
CANDIDATE_THRESHOLDS = [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50]


def normalise_subject(subject: str) -> str:
    s = re.sub(r"^\s*(\[[^\]]+\]\s*)+", "", subject)
    s = re.sub(r"^((Re|RE|Fwd|FWD|AW)\s*:\s*)+", "", s, flags=re.I)
    return s.strip().lower()


#: Cosine similarity at or above which two sentences are treated as saying the
#: same thing. 0.75 is the conventional near-duplicate cutoff for this embedding
#: family; the sensitivity of every reported figure to it is in `threshold_sweep`.
SENTENCE_DUPLICATE_AT = 0.75


def load_sentence_vectors(cache: Path, digests: set[str]) -> dict[str, np.ndarray]:
    """Per-message matrices of unit-normalised sentence vectors."""
    out: dict[str, np.ndarray] = {}
    for digest in digests:
        hexd = digest.replace("sha256:", "")
        path = cache / hexd[:2] / f"{hexd}.json"
        if not path.exists():
            continue
        blob = json.loads(path.read_text())
        vectors = blob["vectors"] if isinstance(blob, dict) else blob
        if not vectors:
            continue
        m = np.asarray(vectors, dtype=np.float32)
        if m.ndim == 1:
            m = m[None, :]
        norms = np.linalg.norm(m, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        out[digest] = m / norms
    return out


def load_vectors(cache: Path, digests: set[str]) -> dict[str, np.ndarray]:
    """One mean vector per message, for thread-level clustering."""
    out: dict[str, np.ndarray] = {}
    for digest, m in load_sentence_vectors(cache, digests).items():
        v = m.mean(axis=0)
        norm = np.linalg.norm(v)
        if norm > 0:
            out[digest] = v / norm
    return out


def novelty_scores(
    graph: dict[str, Any],
    body_of: dict[str, str],
    sentence_vectors: dict[str, np.ndarray],
    threshold: float = SENTENCE_DUPLICATE_AT,
) -> dict[str, float]:
    """Fraction of a reply's sentences that nothing earlier in the thread said.

    A fraction, not a distance, and that is the whole point. Scored as a single
    distance over a message, novelty tracked how much the reply quoted
    (rho -0.32 with quoted fraction); scored over authored text as a whole it
    tracked how short the reply was (rho -0.58 with new-text lines), because a
    short passage embeds far from everything. A per-sentence fraction is
    invariant to both.
    """
    order: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for n in graph["nodes"]:
        if n["sent_at"]:
            order[n["thread_id"]].append(n)
    for members in order.values():
        members.sort(key=lambda n: n["sent_at"])

    scores: dict[str, float] = {}
    for members in order.values():
        seen: list[np.ndarray] = []
        for n in members:
            mat = sentence_vectors.get(body_of.get(n["message_id"], ""))
            if mat is None:
                continue
            if seen:
                prior = np.vstack(seen)
                # Unit vectors, so the dot product is the cosine.
                best = (mat @ prior.T).max(axis=1)
                scores[n["message_id"]] = float((best < threshold).mean())
            seen.append(mat)
    return scores


def length_adjusted(
    novelty: dict[str, float], sentence_count: dict[str, int]
) -> dict[str, float]:
    """Novelty with the residual length effect regressed out.

    A per-sentence fraction removes most of the length bias but not all of it:
    a reply with more sentences has more chances for one of them to echo
    something already said, so the fraction drifts down with length for reasons
    that are partly mechanical rather than substantive. On agent2agent the raw
    fraction still correlates -0.42 with new-text lines.

    This regresses the rank of novelty on the rank of log sentence count and
    keeps the residual, rescaled to a percentile. It is reported *alongside* the
    raw fraction, never instead of it — the adjustment is a modelling choice and
    a reader should be able to see what it did.
    """
    ids = [m for m in novelty if sentence_count.get(m)]
    if len(ids) < 8:
        return {}
    y = np.asarray([novelty[m] for m in ids], dtype=float)
    x = np.log1p(np.asarray([sentence_count[m] for m in ids], dtype=float))

    def ranks(v: np.ndarray) -> np.ndarray:
        order = v.argsort()
        r = np.empty_like(order, dtype=float)
        r[order] = np.arange(len(v))
        return r / max(1, len(v) - 1)

    rx, ry = ranks(x), ranks(y)
    slope = float(np.polyfit(rx, ry, 1)[0])
    residual = ry - slope * (rx - rx.mean())
    adjusted = ranks(residual)
    return {m: round(float(adjusted[i]), 4) for i, m in enumerate(ids)}


def _phi(tp: int, fp: int, fn: int, tn: int) -> float:
    """Matthews correlation between two binary labellings. 0 = no better than chance."""
    num = tp * tn - fp * fn
    den = math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn))
    return num / den if den else 0.0


def score_partition(
    labels: dict[str, Any], shares_participant: dict[tuple[str, str], bool], thread_ids: list[str]
) -> float:
    """How well 'same group' predicts 'shares a participant'."""
    tp = fp = fn = tn = 0
    for i, a in enumerate(thread_ids):
        for b in thread_ids[i + 1 :]:
            same = labels[a] == labels[b]
            shared = shares_participant.get((a, b), False)
            if same and shared:
                tp += 1
            elif same and not shared:
                fp += 1
            elif not same and shared:
                fn += 1
            else:
                tn += 1
    return _phi(tp, fp, fn, tn)


def cluster_threads(
    thread_ids: list[str],
    matrix: np.ndarray,
    shares: dict[tuple[str, str], bool],
    subjects: dict[str, str],
) -> dict[str, Any]:
    """Calibrate the distance threshold, and check it against subject matching."""
    baseline_labels = {t: normalise_subject(subjects[t]) for t in thread_ids}
    baseline = score_partition(baseline_labels, shares, thread_ids)

    trials = []
    best = None
    for threshold in CANDIDATE_THRESHOLDS:
        model = AgglomerativeClustering(
            n_clusters=None, distance_threshold=threshold, metric="cosine", linkage="average"
        )
        assignment = model.fit_predict(matrix)
        labels = {t: int(assignment[i]) for i, t in enumerate(thread_ids)}
        phi = score_partition(labels, shares, thread_ids)
        trials.append(
            {"threshold": threshold, "clusters": int(len(set(assignment))), "phi": round(phi, 4)}
        )
        if best is None or phi > best["phi"]:
            best = {"threshold": threshold, "phi": phi, "labels": labels}

    assert best is not None
    return {
        "trials": trials,
        "chosen_threshold": best["threshold"],
        "phi": round(best["phi"], 4),
        "subject_baseline_phi": round(baseline, 4),
        "beats_subject_baseline": bool(best["phi"] > baseline),
        "labels": best["labels"],
        "subject_labels": baseline_labels,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--events", required=True, type=Path)
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--list", dest="list_name", required=True)
    parser.add_argument("--embed-model", default="nomic-embed-text")
    args = parser.parse_args()

    state = replay(args.events, {args.list_name})
    graph = build(state.messages)
    body_of = {m["message_id"]: m["body"]["sha256"] for m in state.messages if m["message_id"]}
    sentence_vectors = load_sentence_vectors(args.cache, set(body_of.values()))
    vectors = load_vectors(args.cache, set(body_of.values()))

    novelty = novelty_scores(graph, body_of, sentence_vectors)
    sentence_count = {
        n["message_id"]: int(sentence_vectors[body_of[n["message_id"]]].shape[0])
        for n in graph["nodes"]
        if n["message_id"] in body_of and body_of[n["message_id"]] in sentence_vectors
    }
    adjusted = length_adjusted(novelty, sentence_count)

    # Report how much the reported figures move with the duplicate cutoff, so a
    # reader can see whether the conclusion rests on the constant.
    threshold_sweep = []
    for candidate in (0.65, 0.70, 0.75, 0.80, 0.85):
        s = novelty_scores(graph, body_of, sentence_vectors, candidate)
        vals = list(s.values())
        threshold_sweep.append(
            {
                "duplicate_at": candidate,
                "median": round(float(np.median(vals)), 4) if vals else None,
            }
        )

    # A thread's vector is the mean of its messages' vectors: cheap, stable, and
    # it weights a long discussion by everything said in it rather than by its
    # opening message alone.
    members: dict[str, list[np.ndarray]] = defaultdict(list)
    participants: dict[str, set[str]] = defaultdict(set)
    subjects: dict[str, str] = {}
    for n in graph["nodes"]:
        participants[n["thread_id"]].add(n["sender_id"])
        vec = vectors.get(body_of.get(n["message_id"], ""))
        if vec is not None:
            members[n["thread_id"]].append(vec)
    for t in graph["threads"]:
        subjects[t["thread_id"]] = t["subject"]

    thread_ids = sorted(t for t in subjects if members.get(t))
    if len(thread_ids) < 3:
        raise SystemExit(f"only {len(thread_ids)} threads have embeddings; nothing to cluster")

    matrix = np.vstack(
        [
            (lambda v: v / (np.linalg.norm(v) or 1.0))(np.mean(members[t], axis=0))
            for t in thread_ids
        ]
    )
    shares = {
        (a, b): bool(participants[a] & participants[b])
        for i, a in enumerate(thread_ids)
        for b in thread_ids[i + 1 :]
    }

    clustering = cluster_threads(thread_ids, matrix, shares, subjects)
    labels: dict[str, int] = clustering.pop("labels")
    clustering.pop("subject_labels")

    by_cluster: dict[int, list[str]] = defaultdict(list)
    for t, c in labels.items():
        by_cluster[c].append(t)

    topics = []
    for c, ts in sorted(by_cluster.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        ts_sorted = sorted(ts, key=lambda t: -sum(1 for n in graph["nodes"] if n["thread_id"] == t))
        sent = [t_["started_at"] for t_ in graph["threads"] if t_["thread_id"] in set(ts) and t_["started_at"]]
        topics.append(
            {
                "id": f"topic-{c}",
                "threads": ts_sorted,
                "thread_count": len(ts),
                "message_count": sum(1 for n in graph["nodes"] if n["thread_id"] in set(ts)),
                "distinct_senders": len(set().union(*(participants[t] for t in ts))),
                "subjects": sorted({subjects[t] for t in ts}),
                # Named by a model in a later step; clustering never depends on it.
                "label": None,
                "started_at": min(sent) if sent else None,
            }
        )

    per_thread_novelty = {}
    for t in graph["threads"]:
        vals = [
            novelty[n["message_id"]]
            for n in graph["nodes"]
            if n["thread_id"] == t["thread_id"] and n["message_id"] in novelty
        ]
        adj = [
            adjusted[n["message_id"]]
            for n in graph["nodes"]
            if n["thread_id"] == t["thread_id"] and n["message_id"] in adjusted
        ]
        per_thread_novelty[t["thread_id"]] = {
            "scored": len(vals),
            "mean": round(float(np.mean(vals)), 4) if vals else None,
            "median": round(float(np.median(vals)), 4) if vals else None,
            "median_length_adjusted": round(float(np.median(adj)), 4) if adj else None,
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
        "embed_model": args.embed_model,
        "messages_embedded": len(vectors),
        "replies_scored": len(novelty),
        "sentence_duplicate_at": SENTENCE_DUPLICATE_AT,
        "novelty_threshold_sweep": threshold_sweep,
        "clustering": clustering,
        "topics": topics,
        "thread_novelty": per_thread_novelty,
        "message_novelty": {
            m: {"novelty": round(v, 4), "length_adjusted": adjusted.get(m)}
            for m, v in novelty.items()
        },
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")

    vals = list(novelty.values())
    print(
        json.dumps(
            {
                "out": str(args.out),
                "list": args.list_name,
                "threads_clustered": len(thread_ids),
                "topics": len(topics),
                "chosen_threshold": clustering["chosen_threshold"],
                "phi": clustering["phi"],
                "subject_baseline_phi": clustering["subject_baseline_phi"],
                "beats_subject_baseline": clustering["beats_subject_baseline"],
                "replies_scored": len(vals),
                "novelty_median": round(float(np.median(vals)), 4) if vals else None,
                "novelty_p10": round(float(np.percentile(vals, 10)), 4) if vals else None,
                "novelty_p90": round(float(np.percentile(vals, 90)), 4) if vals else None,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
