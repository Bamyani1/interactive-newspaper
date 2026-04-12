"""Deterministic pre-merge grouping."""

from __future__ import annotations

from collections import Counter

from .continuation import _headline_similar


def _deterministic_merge(article_data: list[dict]) -> list[list[int]]:
    """Pre-merge articles with explicit continuation markers."""
    n = len(article_data)
    merged_into: dict[int, int] = {}

    source_counts: Counter[tuple[str, str]] = Counter()
    target_counts: Counter[tuple[str, str]] = Counter()
    for idx in range(n):
        cont_on = article_data[idx]["continuation"].get("continues_on")
        if cont_on:
            source_counts[(article_data[idx]["page_label"], cont_on)] += 1
        cont_from = article_data[idx]["continuation"].get("continued_from")
        if cont_from:
            target_counts[(article_data[idx]["page_label"], cont_from)] += 1

    for i in range(n):
        cont_on = article_data[i]["continuation"].get("continues_on")
        if not cont_on:
            continue
        page_pair = (article_data[i]["page_label"], cont_on)
        if source_counts[page_pair] > 1 or target_counts[(cont_on, article_data[i]["page_label"])] > 1:
            continue
        for j in range(n):
            if i == j:
                continue
            if article_data[j]["page_label"] != cont_on:
                continue
            cont_from = article_data[j]["continuation"].get("continued_from")
            if cont_from and cont_from == article_data[i]["page_label"]:
                leader_i = merged_into.get(i, i)
                leader_j = merged_into.get(j, j)
                if leader_i != leader_j:
                    for k, v in list(merged_into.items()):
                        if v == leader_j:
                            merged_into[k] = leader_i
                    merged_into[j] = leader_i
                    if i not in merged_into:
                        merged_into[i] = leader_i

    for j in range(n):
        if j in merged_into:
            continue
        cont_from = article_data[j]["continuation"].get("continued_from")
        if not cont_from:
            continue
        best_match = None
        for i in range(n):
            if i == j:
                continue
            if article_data[i]["page_label"] != cont_from:
                continue
            if i in merged_into and merged_into[i] != i:
                continue
            if _headline_similar(article_data[i]["headline"], article_data[j]["headline"]):
                best_match = i
                break
        if best_match is not None:
            leader = merged_into.get(best_match, best_match)
            merged_into[j] = leader
            if best_match not in merged_into:
                merged_into[best_match] = leader

    # Pass 3: Forward-looking one-sided merges.
    # Source has continues_on=X but target on page X has no continued_from.
    # Match by headline similarity.
    for i in range(n):
        if i in merged_into:
            continue
        cont_on = article_data[i]["continuation"].get("continues_on")
        if not cont_on or cont_on == "?":
            continue
        best_match = None
        for j in range(n):
            if i == j or j in merged_into:
                continue
            if article_data[j]["page_label"] != cont_on:
                continue
            if _headline_similar(article_data[i]["headline"], article_data[j]["headline"]):
                best_match = j
                break
        if best_match is not None:
            leader = merged_into.get(i, i)
            merged_into[best_match] = leader
            if i not in merged_into:
                merged_into[i] = leader

    groups: dict[int, list[int]] = {}
    for idx, leader in merged_into.items():
        groups.setdefault(leader, [leader] if leader not in groups else groups[leader])
        if idx not in groups[leader]:
            groups[leader].append(idx)

    return [sorted(g) for g in groups.values() if len(g) > 1]


def deterministic_premerge(article_data: list[dict]) -> list[list[int]]:
    return _deterministic_merge(article_data)


__all__ = ["_deterministic_merge", "deterministic_premerge"]
