"""Tests for reputation propagation and cluster detection.

The properties worth pinning down are the ones that would be quietly wrong: that
score flows the direction an endorsement does, that restarting on an empty seed
fails loudly instead of returning uniform PageRank, and that a self-reply is not
counted as engagement.
"""

from __future__ import annotations

import pytest

from laocoon.reputation import (
    build_account_graph,
    community_stats,
    detect_communities,
    personalized_pagerank,
)

SEED = "sha256:" + "5" * 64
A = "sha256:" + "a" * 64
B = "sha256:" + "b" * 64
C = "sha256:" + "c" * 64


def node(message_id: str, sender: str, quoted: int = 0) -> dict:
    return {
        "message_id": message_id,
        "list_name": "testlist",
        "uid": 1,
        "sender_id": sender,
        "sent_at": "2026-08-01T00:00:00.000Z",
        "subject": "s",
        "thread_id": message_id,
        "depth": 0,
        "in_degree": 0,
        "out_degree": 0,
        "body": {"chars": 10, "quoted_lines": quoted, "unquoted_lines": 1},
    }


def graph(nodes: list[dict], edges: list[tuple[str, str]]) -> dict:
    return {
        "nodes": nodes,
        "edges": [{"child": c, "parent": p, "via": "in_reply_to"} for c, p in edges],
    }


def test_edges_point_from_the_replier_to_the_author_they_replied_to():
    accounts, _ = build_account_graph(
        graph([node("m1", A), node("m2", B)], [("m2", "m1")])
    )
    assert accounts.has_edge(B, A)
    assert not accounts.has_edge(A, B)


def test_repeated_replies_accumulate_weight():
    accounts, _ = build_account_graph(
        graph(
            [node("m1", A), node("m2", B), node("m3", B)],
            [("m2", "m1"), ("m3", "m1")],
        )
    )
    assert accounts[B][A]["replies"] == 2


def test_quoting_is_counted_separately_from_replying():
    accounts, _ = build_account_graph(
        graph(
            [node("m1", A), node("m2", B, quoted=4), node("m3", B, quoted=0)],
            [("m2", "m1"), ("m3", "m1")],
        )
    )
    assert accounts[B][A]["replies"] == 2
    assert accounts[B][A]["quoting"] == 1


def test_a_self_reply_is_dropped_and_counted():
    accounts, self_loops = build_account_graph(
        graph([node("m1", A), node("m2", A)], [("m2", "m1")])
    )
    assert self_loops == 1
    assert accounts.number_of_edges() == 0


def test_score_flows_from_the_seed_to_who_it_engaged_with():
    # SEED replies to A's message, so A gains standing; C is off on their own.
    accounts, _ = build_account_graph(
        graph(
            [node("m1", A), node("m2", SEED), node("m3", C), node("m4", C)],
            [("m2", "m1"), ("m4", "m3")],
        )
    )
    scores = personalized_pagerank(accounts, [SEED], "replies")
    assert scores[A] > scores[C]


def test_restarting_on_a_seed_that_never_posted_fails_loudly():
    # Returning uniform PageRank here would look like a result and be worthless.
    accounts, _ = build_account_graph(graph([node("m1", A), node("m2", B)], [("m2", "m1")]))
    with pytest.raises(ValueError, match="no seed account"):
        personalized_pagerank(accounts, [SEED], "replies")


def test_the_quoting_weighting_ignores_replies_that_quote_nothing():
    accounts, _ = build_account_graph(
        graph(
            [node("m1", A), node("m2", B, quoted=0), node("m3", SEED, quoted=3)],
            [("m2", "m1"), ("m3", "m1")],
        )
    )
    quoting = personalized_pagerank(accounts, [SEED], "quoting")
    replies = personalized_pagerank(accounts, [SEED], "replies")
    # B contributes under `replies` but has no quoting edge at all.
    assert quoting[B] < replies[B] or quoting[B] == pytest.approx(replies[B], abs=1e-9)
    assert quoting[A] > 0


def test_communities_are_deterministic():
    g = graph(
        [node(f"m{i}", s) for i, s in enumerate([A, A, B, B, C, C], start=1)],
        [("m2", "m3"), ("m4", "m1"), ("m6", "m5")],
    )
    accounts, _ = build_account_graph(g)
    first, mod1 = detect_communities(accounts)
    second, mod2 = detect_communities(accounts)
    assert first == second
    assert mod1 == pytest.approx(mod2)


def test_a_community_that_only_talks_to_itself_has_a_zero_external_ratio():
    accounts, _ = build_account_graph(
        graph(
            [node("m1", A), node("m2", B), node("m3", C), node("m4", C)],
            [("m2", "m1"), ("m4", "m3")],
        )
    )
    partition, _ = detect_communities(accounts)
    stats = community_stats(accounts, partition, {A}, {A: 1, B: 1, C: 1})
    for entry in stats:
        assert entry["external_edge_ratio"] == 0.0
    assert sum(1 for e in stats if e["contains_seed_member"]) == 1
