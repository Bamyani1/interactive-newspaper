"""Unit tests for proper noun consistency checks and corrections."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.contracts.content_models import Article, MergedArticle
from transcript_ocr.postprocessing.proper_noun_corrections import (
    _build_corrections,
    _check_edition_proper_nouns,
    _check_proper_noun_consistency,
    _apply_edition_proper_noun_corrections,
    _extract_names,
    _levenshtein,
)


# --- _levenshtein tests ---


def test_levenshtein_identical():
    assert _levenshtein("hello", "hello") == 0


def test_levenshtein_one_edit():
    assert _levenshtein("Monahan", "Mohahan") == 1


def test_levenshtein_two_edits():
    assert _levenshtein("Smith", "Smyth") == 1


def test_levenshtein_empty():
    assert _levenshtein("", "abc") == 3


# --- _extract_names tests ---


def test_extract_multi_word_names():
    counts = _extract_names("John Smith went to see John Smith and Jane Doe")
    assert counts["John Smith"] == 2
    assert counts["Jane Doe"] == 1


def test_extract_names_ignores_single_words():
    """Single words must NOT be extracted — they caused false corrections like Pat → Pub."""
    counts = _extract_names(
        "Pat spoke. Monahan spoke about Ohio. University life was discussed."
    )
    assert "Pat" not in counts
    assert "Monahan" not in counts
    assert "Ohio" not in counts
    assert "University" not in counts


# --- _build_corrections tests ---


def test_build_corrections_detects_close_names():
    """Multi-word names with edit distance 1-2 should produce a correction."""
    name_counts = {"John Monahan": 5, "John Mohahan": 1}
    corrections = _build_corrections(name_counts)
    assert corrections.get("John Mohahan") == "John Monahan"


def test_build_corrections_requires_frequency_difference():
    """Equal-frequency names should not produce corrections."""
    name_counts = {"John Monahan": 2, "John Mohahan": 2}
    corrections = _build_corrections(name_counts)
    assert len(corrections) == 0


def test_build_corrections_allows_multi_word_single_occurrence():
    """Multi-word names should be compared even if they appear once."""
    name_counts = {"John Smith": 3, "John Smiith": 1}
    corrections = _build_corrections(name_counts)
    assert corrections.get("John Smiith") == "John Smith"


# --- _check_proper_noun_consistency (page-level) tests ---


def test_page_level_detects_multi_word():
    articles = [
        Article(headline="A", body="John Smith said today. John Smith went home."),
        Article(headline="B", body="John Smiith also attended."),
    ]
    corrections = _check_proper_noun_consistency(articles)
    assert "John Smiith" in corrections
    assert corrections["John Smiith"] == "John Smith"


# --- _check_edition_proper_nouns (edition-level) tests ---


def test_edition_level_cross_article():
    """Edition-level check catches cross-article OCR name errors (multi-word only)."""
    articles = [
        MergedArticle(
            headline="Article One",
            body="the bill was introduced by John Monahan. John Monahan spoke at length.",
            source_pages=["1"],
        ),
        MergedArticle(
            headline="Article Two",
            body="at the hearing, John Mohahan was present.",
            source_pages=["7"],
        ),
    ]
    corrections = _check_edition_proper_nouns(articles)
    assert corrections.get("John Mohahan") == "John Monahan"


def test_edition_level_ignores_single_word_variants():
    """Single-word variants like Mohahan/Monahan must NOT be corrected."""
    articles = [
        MergedArticle(
            headline="News",
            body="Monahan introduced the bill. Monahan spoke at length. Monahan concluded.",
            source_pages=["1"],
        ),
        MergedArticle(
            headline="Update",
            body="Mohahan was present at the hearing.",
            source_pages=["7"],
        ),
    ]
    corrections = _check_edition_proper_nouns(articles)
    assert "Mohahan" not in corrections


def test_edition_level_no_false_positives():
    """Distinct names should not be corrected."""
    articles = [
        MergedArticle(headline="A", body="Jim Anderson spoke today.", source_pages=["1"]),
        MergedArticle(headline="B", body="Bob Patterson was present.", source_pages=["2"]),
    ]
    corrections = _check_edition_proper_nouns(articles)
    assert len(corrections) == 0


# --- _apply_edition_proper_noun_corrections tests ---


def test_apply_corrections_to_body_and_headline():
    articles = [
        MergedArticle(
            headline="John Mohahan Introduces Bill",
            body="John Mohahan spoke at length.",
            source_pages=["1"],
        ),
    ]
    corrections = {"John Mohahan": "John Monahan"}
    result = _apply_edition_proper_noun_corrections(articles, corrections)
    assert result[0].headline == "John Monahan Introduces Bill"
    assert result[0].body == "John Monahan spoke at length."


def test_apply_empty_corrections_returns_same():
    articles = [
        MergedArticle(headline="Test", body="Body text.", source_pages=["1"]),
    ]
    result = _apply_edition_proper_noun_corrections(articles, {})
    assert result[0].headline == "Test"
    assert result[0].body == "Body text."
