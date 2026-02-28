"""Proper noun consistency checks/corrections."""

from __future__ import annotations

import re
from collections import Counter

from ..contracts.content_models import Article, MergedArticle
from ..contracts.diagnostics_models import PageDiagnostics
from ..shared.console import warning, substep


def _levenshtein(s1: str, s2: str) -> int:
    """Compute Levenshtein edit distance between two strings."""
    if len(s1) < len(s2):
        return _levenshtein(s2, s1)
    if len(s2) == 0:
        return len(s1)
    prev = list(range(len(s2) + 1))
    for i, c1 in enumerate(s1):
        curr = [i + 1]
        for j, c2 in enumerate(s2):
            curr.append(min(prev[j + 1] + 1, curr[j] + 1, prev[j] + (0 if c1 == c2 else 1)))
        prev = curr
    return prev[-1]


def _extract_names(text: str) -> Counter[str]:
    """Extract multi-word proper noun candidates from text.

    Only matches multi-word names (e.g., "John Smith") — single-word detection
    was removed because it produced 100% false positives (e.g., "Pat" → "Pub").
    """
    counts: Counter[str] = Counter()

    # Multi-word proper nouns (e.g., "John Smith")
    for match in re.finditer(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b", text):
        counts[match.group(0)] += 1

    return counts


def _build_corrections(name_counts: dict[str, int], diag: PageDiagnostics | None = None) -> dict[str, str]:
    """Build correction map from name frequency counts using Levenshtein distance."""
    corrections: dict[str, str] = {}
    name_list = sorted(name_counts.keys())
    for i in range(len(name_list)):
        for j in range(i + 1, len(name_list)):
            dist = _levenshtein(name_list[i], name_list[j])
            if 1 <= dist <= 2:
                warning(f"Proper noun warning: '{name_list[i]}' vs '{name_list[j]}' (edit distance {dist})")
                if diag is not None:
                    diag.postprocessing.proper_noun_warnings.append(
                        {
                            "name_a": name_list[i],
                            "name_b": name_list[j],
                            "distance": dist,
                        }
                    )
                count_i = name_counts[name_list[i]]
                count_j = name_counts[name_list[j]]
                if count_i >= 2 * count_j:
                    corrections[name_list[j]] = name_list[i]
                elif count_j >= 2 * count_i:
                    corrections[name_list[i]] = name_list[j]

    return corrections


def _check_proper_noun_consistency(
    articles: list[Article],
    diag: PageDiagnostics | None = None,
) -> dict[str, str]:
    """Detect likely OCR misspellings of proper nouns and build correction map."""
    name_counts: dict[str, int] = {}
    for art in articles:
        for name, count in _extract_names(art.body).items():
            name_counts[name] = name_counts.get(name, 0) + count

    return _build_corrections(name_counts, diag=diag)


def _check_edition_proper_nouns(articles: list[MergedArticle]) -> dict[str, str]:
    """Cross-article proper noun consistency check across an entire edition.

    Runs after merge on all MergedArticles, catching OCR errors like
    "John Mohahan" (page 7) vs "John Monahan" (page 1) that per-page checks miss.
    """
    name_counts: dict[str, int] = {}
    for art in articles:
        text = f"{art.headline} {art.body}"
        for name, count in _extract_names(text).items():
            name_counts[name] = name_counts.get(name, 0) + count

    return _build_corrections(name_counts)


def _apply_proper_noun_corrections(
    articles: list[Article],
    corrections: dict[str, str],
    diag: PageDiagnostics | None = None,
) -> list[Article]:
    """Replace OCR-misspelled proper nouns in article bodies."""
    corrected_articles = []
    for art in articles:
        body = art.body
        for variant, canonical in corrections.items():
            pattern = re.compile(r"\b" + re.escape(variant) + r"\b")
            new_body = pattern.sub(canonical, body)
            if new_body != body:
                count = body.count(variant)
                substep(f"Corrected '{variant}' → '{canonical}' ({count}x)")
                if diag is not None:
                    diag.postprocessing.proper_noun_corrections.append(
                        {
                            "original": variant,
                            "corrected": canonical,
                            "count": count,
                        }
                    )
                body = new_body
        corrected_articles.append(
            Article(
                headline=art.headline,
                author=art.author,
                writer_position=art.writer_position,
                category=art.category,
                continues_on=art.continues_on,
                continued_from=art.continued_from,
                body=body,
                images=art.images,
                image_files=art.image_files,
            )
        )
    return corrected_articles


def _apply_edition_proper_noun_corrections(
    articles: list[MergedArticle],
    corrections: dict[str, str],
) -> list[MergedArticle]:
    """Apply proper noun corrections across merged edition articles."""
    if not corrections:
        return articles

    corrected = []
    for art in articles:
        body = art.body
        headline = art.headline
        for variant, canonical in corrections.items():
            pattern = re.compile(r"\b" + re.escape(variant) + r"\b")
            new_body = pattern.sub(canonical, body)
            new_headline = pattern.sub(canonical, headline)
            if new_body != body or new_headline != headline:
                count = body.count(variant) + headline.count(variant)
                substep(f"Edition-level correction: '{variant}' → '{canonical}' ({count}x)")
                body = new_body
                headline = new_headline
        corrected.append(
            MergedArticle(
                headline=headline,
                author=art.author,
                writer_position=art.writer_position,
                category=art.category,
                continues_on=art.continues_on,
                continued_from=art.continued_from,
                body=body,
                images=art.images,
                image_files=art.image_files,
                source_pages=art.source_pages,
            )
        )
    return corrected


apply_proper_noun_consistency = _apply_proper_noun_corrections

__all__ = [
    "_apply_edition_proper_noun_corrections",
    "_apply_proper_noun_corrections",
    "_build_corrections",
    "_check_edition_proper_nouns",
    "_check_proper_noun_consistency",
    "_levenshtein",
    "apply_proper_noun_consistency",
]
