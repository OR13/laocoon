"""Reputation propagation and cluster detection on the account graph.

    uv run --directory python python -m laocoon.reputation \
        --events ../events --seed ../private/artifacts/seed.json \
        --out ../private/artifacts/reputation.json \
        --aggregate-out ../artifacts/community-structure.json

Two things happen here, both read off the reply graph and neither requiring a
judgement about anyone's nature:

**Propagation.** Personalized PageRank restarted on the community-conferred seed.
Account edges point from the replier to the author they replied to, so score
flows the way an endorsement does: when a seeded account engages with something,
the account that wrote it gains standing. Provenance is nowhere in this — the
input is who replied to whom.

**Clustering.** Louvain communities on the undirected account graph, plus a k-core
decomposition. What this is for is stated in PROBLEM.md section 3: finding
mutually-reinforcing clusters that do not connect to the rest of the group. A
community with no seed member and a low external-edge ratio is exactly that
shape. It is a description of a subgraph, not an accusation about the people in
it.

Two weightings are run rather than one. `replies` counts every reply; `quoting`
counts only replies that quote at least one line. Section 4 asks for the graph to
be weighted by whether a reply engages with specific text; the quoting half of
that is mechanical and available now, the "responds rather than restates" half is
a phase-3 classifier. Rather than invent a blend, both are computed and their
rank correlation is reported — where they disagree is information, not noise.

Outputs are split by who may see them. The per-account file is private: it is a
ranked participant list, which section 7 keeps unpublished. The aggregate file
names no account and carries only structure.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import networkx as nx
from scipy.stats import spearmanr

from .events import replay
from .reply_graph import build

SCHEMA_VERSION = "1.0.0"
GENERATOR = {"name": "laocoon.reputation", "version": "0.1.0"}
DAMPING = 0.85
#: Fixed so a re-run reproduces the same partition. Louvain is stochastic.
LOUVAIN_SEED = 1729


def build_account_graph(graph: dict[str, Any]) -> tuple[nx.DiGraph, int]:
    """Collapse the message graph onto accounts.

    An edge ``u -> v`` means "u replied to a message written by v". Self-replies
    are dropped and counted: a thread where someone answers their own message is
    not evidence of anyone else's engagement.
    """
    sender_of = {node["message_id"]: node["sender_id"] for node in graph["nodes"]}
    quoted_of = {
        node["message_id"]: node["body"]["quoted_lines"] > 0 for node in graph["nodes"]
    }

    accounts = nx.DiGraph()
    for sender in set(sender_of.values()):
        accounts.add_node(sender)

    self_loops = 0
    for edge in graph["edges"]:
        child, parent = sender_of[edge["child"]], sender_of[edge["parent"]]
        if child == parent:
            self_loops += 1
            continue
        if accounts.has_edge(child, parent):
            data = accounts[child][parent]
            data["replies"] += 1
            data["quoting"] += 1 if quoted_of[edge["child"]] else 0
        else:
            accounts.add_edge(
                child, parent, replies=1, quoting=1 if quoted_of[edge["child"]] else 0
            )
    return accounts, self_loops


def personalized_pagerank(
    accounts: nx.DiGraph, seed_ids: list[str], weight: str
) -> dict[str, float]:
    """PageRank restarted on the seed.

    Edges with zero weight under this weighting are removed rather than kept at
    weight zero, so "the quote-weighted graph" means the graph of replies that
    quote, not a graph with invisible edges in it.
    """
    graph = nx.DiGraph()
    graph.add_nodes_from(accounts.nodes)
    for u, v, data in accounts.edges(data=True):
        if data[weight] > 0:
            graph.add_edge(u, v, weight=data[weight])

    present = [s for s in seed_ids if s in graph]
    if not present:
        # Restarting on nothing would silently return uniform PageRank, which
        # would look like a result. It is not one.
        raise ValueError("no seed account appears in the graph; cannot propagate")

    personalization = {node: 0.0 for node in graph.nodes}
    for s in present:
        personalization[s] = 1.0 / len(present)
    return nx.pagerank(graph, alpha=DAMPING, personalization=personalization, weight="weight")


def detect_communities(accounts: nx.DiGraph) -> tuple[list[list[str]], float]:
    """Louvain communities on the undirected, reply-weighted account graph."""
    undirected = nx.Graph()
    undirected.add_nodes_from(accounts.nodes)
    for u, v, data in accounts.edges(data=True):
        weight = data["replies"] + undirected.get_edge_data(u, v, {}).get("weight", 0)
        undirected.add_edge(u, v, weight=weight)

    communities = nx.community.louvain_communities(
        undirected, weight="weight", seed=LOUVAIN_SEED
    )
    partition = [sorted(c) for c in communities]
    partition.sort(key=lambda c: (-len(c), c[0]))
    modularity = (
        nx.community.modularity(undirected, [set(c) for c in partition], weight="weight")
        if undirected.number_of_edges()
        else 0.0
    )
    return partition, modularity


def community_stats(
    accounts: nx.DiGraph, partition: list[list[str]], seeds: set[str], cores: dict[str, int]
) -> list[dict[str, Any]]:
    """Per-community structure. Sizes and edge ratios only — no account ids."""
    membership = {node: i for i, community in enumerate(partition) for node in community}
    stats = []
    for index, community in enumerate(partition):
        members = set(community)
        internal = external = 0
        for u, v in accounts.edges():
            if u in members and v in members:
                internal += 1
            elif u in members or v in members:
                external += 1
        total = internal + external
        stats.append(
            {
                "index": index,
                "size": len(community),
                "internal_edges": internal,
                "external_edges": external,
                "external_edge_ratio": (external / total) if total else 0.0,
                "contains_seed_member": bool(members & seeds),
                "max_core_number": max((cores[m] for m in community), default=0),
            }
        )
    assert len(membership) == accounts.number_of_nodes()
    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--events", required=True, type=Path)
    parser.add_argument("--seed", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path, help="private per-account artifact")
    parser.add_argument("--aggregate-out", required=True, type=Path, help="publishable aggregate")
    parser.add_argument("--list", action="append", dest="lists")
    parser.add_argument("--generated-at", default=None)
    args = parser.parse_args()

    seed_doc = json.loads(args.seed.read_text(encoding="utf-8"))
    seed_ids = [m["sender_id"] for m in seed_doc["members"]]
    seed_set = set(seed_ids)
    clauses_of = {m["sender_id"]: m["clauses"] for m in seed_doc["members"]}

    state = replay(args.events, set(args.lists) if args.lists else None)
    graph = build(state.messages)
    accounts, self_loops = build_account_graph(graph)

    ppr_replies = personalized_pagerank(accounts, seed_ids, "replies")
    ppr_quoting = personalized_pagerank(accounts, seed_ids, "quoting")

    partition, modularity = detect_communities(accounts)
    membership = {node: i for i, community in enumerate(partition) for node in community}
    cores = nx.core_number(nx.Graph(accounts.to_undirected()))
    stats = community_stats(accounts, partition, seed_set, cores)

    ordered = sorted(accounts.nodes)
    correlation, _ = (
        spearmanr([ppr_replies[a] for a in ordered], [ppr_quoting[a] for a in ordered])
        if len(ordered) > 2
        else (float("nan"), None)
    )

    rank_replies = _ranks(ppr_replies)
    rank_quoting = _ranks(ppr_quoting)

    generated_at = args.generated_at or datetime.now(timezone.utc).isoformat(
        timespec="seconds"
    ).replace("+00:00", "Z")

    private_artifact = {
        "schema_version": SCHEMA_VERSION,
        "derived": True,
        "publication": "private",
        "generated_at": generated_at,
        "generator": GENERATOR,
        "seed_rule_version": seed_doc["seed_rule_version"],
        "damping": DAMPING,
        "graph": {
            "accounts": accounts.number_of_nodes(),
            "edges": accounts.number_of_edges(),
            "self_reply_edges_dropped": self_loops,
            "seed_accounts_in_graph": len(seed_set & set(accounts.nodes)),
        },
        "accounts": [
            {
                "sender_id": account,
                "seeded": account in seed_set,
                "clauses": clauses_of.get(account, []),
                "ppr_replies": ppr_replies[account],
                "ppr_quoting": ppr_quoting[account],
                "rank_replies": rank_replies[account],
                "rank_quoting": rank_quoting[account],
                "community": membership[account],
                "core_number": cores[account],
                "replies_received": accounts.in_degree(account, weight="replies"),
                "replies_sent": accounts.out_degree(account, weight="replies"),
            }
            for account in sorted(ordered, key=lambda a: -ppr_replies[a])
        ],
        "weighting_agreement": {"spearman": _finite(correlation), "n": len(ordered)},
    }

    unconnected = [c for c in stats if not c["contains_seed_member"]]
    aggregate_artifact = {
        "schema_version": SCHEMA_VERSION,
        "derived": True,
        "publication": "aggregate_public",
        "generated_at": generated_at,
        "generator": GENERATOR,
        "seed_rule_version": seed_doc["seed_rule_version"],
        "accounts": {
            "total": accounts.number_of_nodes(),
            "seeded": len(seed_set & set(accounts.nodes)),
            "no_datatracker_record": seed_doc["counts"]["no_datatracker_record"],
            "resolved_but_unseeded": seed_doc["counts"]["records_available"]
            - seed_doc["counts"]["seeded"],
        },
        "graph": {
            "accounts": accounts.number_of_nodes(),
            "edges": accounts.number_of_edges(),
            "density": nx.density(accounts),
            "self_reply_edges_dropped": self_loops,
        },
        "modularity": modularity,
        "communities": [
            {k: v for k, v in c.items() if k != "index"} | {"index": c["index"]} for c in stats
        ],
        "communities_without_seed_member": {
            "count": len(unconnected),
            "accounts": sum(c["size"] for c in unconnected),
        },
        "weighting_agreement": {"spearman": _finite(correlation), "n": len(ordered)},
    }

    for path, artifact in ((args.out, private_artifact), (args.aggregate_out, aggregate_artifact)):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")

    print(
        json.dumps(
            {
                "private_out": str(args.out),
                "aggregate_out": str(args.aggregate_out),
                "accounts": accounts.number_of_nodes(),
                "edges": accounts.number_of_edges(),
                "seed_accounts_in_graph": len(seed_set & set(accounts.nodes)),
                "communities": len(partition),
                "modularity": round(modularity, 4),
                "communities_without_seed_member": len(unconnected),
                "spearman_replies_vs_quoting": _finite(correlation),
            },
            indent=2,
        )
    )
    return 0


def _ranks(scores: dict[str, float]) -> dict[str, int]:
    """Dense rank, 1 = highest. Ties broken by sender_id for determinism."""
    order = sorted(scores, key=lambda a: (-scores[a], a))
    return {account: i + 1 for i, account in enumerate(order)}


def _finite(value: float) -> float | None:
    return None if value != value else round(float(value), 6)


if __name__ == "__main__":
    raise SystemExit(main())
