"""Does the health state predict anything?

    uv run --directory python python -m laocoon.health_check \
        --events ../events --health ../artifacts/health-agent2agent.json \
        --out ../artifacts/health-check-agent2agent.json --list agent2agent

The five constants behind `open` / `narrow` / `closed` were chosen by inspection.
Unlike the topic threshold there is no ground truth for what a closed exchange
is, so they cannot be calibrated directly — but they can be *tested*, against
the same standard everything else in this project answers to: held-out
prediction.

If a thread's state at time *T* says nothing about the engagement it receives in
*(T, T+h]*, the boundaries carry no information and the three-state label should
be dropped. The continuous axes are the data; the state is only a reading aid,
and a reading aid that misleads is worse than none.

Deriving the thresholds from the corpus instead — tertiles of each axis — was
rejected deliberately. It would guarantee that roughly a third of every list is
labelled "closed" whether or not anything is, which is the same
cannot-produce-a-negative-result failure as the substantive/hollow classifier
that never said hollow. It would also destroy comparison between lists, which is
the entire reason a second list was added.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np
from scipy.stats import mannwhitneyu, spearmanr

from .events import replay
from .measures import parse_time
from .reply_graph import build

GENERATOR = "laocoon.health_check/0.1.0"
#: closed < narrow < open, so a positive correlation means the label is ordered
#: the way it claims to be.
STATE_RANK = {"closed": 0, "narrow": 1, "open": 2}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--events", required=True, type=Path)
    parser.add_argument("--health", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--list", dest="list_name", required=True)
    parser.add_argument("--horizon-days", type=int, default=7)
    args = parser.parse_args()

    health = {r["thread_id"]: r for r in json.loads(args.health.read_text())["threads"]}
    state = replay(args.events, {args.list_name})
    graph = build(state.messages)

    sent = sorted(parse_time(m["sent_at"]) for m in state.messages if m["sent_at"])
    if not sent:
        raise SystemExit("no dated messages")
    horizon = timedelta(days=args.horizon_days)

    # Rolling origins, each with a full horizon of observed data after it.
    origins: list[datetime] = []
    cursor = sent[-1] - horizon
    while cursor > sent[0] and len(origins) < 20:
        origins.append(cursor)
        cursor -= timedelta(days=max(1, args.horizon_days // 2))
    origins.reverse()

    per_origin = []
    pooled: dict[str, list[float]] = defaultdict(list)
    for origin in origins:
        after: dict[str, int] = defaultdict(int)
        alive: set[str] = set()
        for n in graph["nodes"]:
            if not n["sent_at"]:
                continue
            when = parse_time(n["sent_at"])
            if when <= origin:
                alive.add(n["thread_id"])
            elif when <= origin + horizon:
                after[n["thread_id"]] += 1

        rows = [(health[t]["state"], float(after.get(t, 0))) for t in alive if t in health]
        rows = [(s, v) for s, v in rows if s in STATE_RANK]
        if len(rows) < 6:
            continue
        ranks = [STATE_RANK[s] for s, _ in rows]
        actual = [v for _, v in rows]
        for s, v in rows:
            pooled[s].append(v)
        rho = None
        if len(set(ranks)) > 1 and len(set(actual)) > 1:
            value = float(spearmanr(ranks, actual).statistic)
            rho = None if value != value else round(value, 4)
        per_origin.append(
            {
                "origin_at": origin.astimezone(timezone.utc)
                .isoformat(timespec="seconds")
                .replace("+00:00", "Z"),
                "threads": len(rows),
                "spearman_state_vs_engagement": rho,
            }
        )

    defined = [o["spearman_state_vs_engagement"] for o in per_origin
               if o["spearman_state_vs_engagement"] is not None]
    median_rho = round(float(np.median(defined)), 4) if defined else None

    # Open against closed directly, pooled across origins.
    open_vals, closed_vals = pooled.get("open", []), pooled.get("closed", [])
    contrast: dict[str, Any] = {
        "open_n": len(open_vals),
        "closed_n": len(closed_vals),
        "open_median_engagement": round(float(np.median(open_vals)), 3) if open_vals else None,
        "closed_median_engagement": round(float(np.median(closed_vals)), 3) if closed_vals else None,
        "narrow_median_engagement": round(float(np.median(pooled.get("narrow", []))), 3)
        if pooled.get("narrow")
        else None,
        "mannwhitney_p": None,
    }
    if len(open_vals) >= 5 and len(closed_vals) >= 5:
        contrast["mannwhitney_p"] = round(
            float(mannwhitneyu(open_vals, closed_vals, alternative="greater").pvalue), 5
        )

    verdict = (
        "separates"
        if median_rho is not None and median_rho > 0.1
        else "no separation"
        if median_rho is not None
        else "not scorable"
    )

    artifact = {
        "schema_version": "1.0.0",
        "derived": True,
        "publication": "aggregate_public",
        "generated_at": datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
        "generator": GENERATOR,
        "list_name": args.list_name,
        "horizon_days": args.horizon_days,
        "origins_scored": len(per_origin),
        "median_spearman": median_rho,
        "contrast": contrast,
        "verdict": verdict,
        "per_origin": per_origin,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: artifact[k] for k in
                      ("list_name", "origins_scored", "median_spearman", "contrast", "verdict")},
                     indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
