"""Unit tests for byline cleanup functions."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.postprocessing.byline_cleanup import (
    _dedup_byline_from_body,
    _normalize_byline,
)


# --- _normalize_byline ---


def test_normalize_strips_by_prefix():
    assert _normalize_byline("By John Smith") == "John Smith"


def test_normalize_all_caps():
    assert _normalize_byline("BY JOHN SMITH") == "JOHN SMITH"


def test_normalize_empty():
    assert _normalize_byline("") == ""


def test_normalize_no_by_prefix():
    assert _normalize_byline("John Smith") == "John Smith"


# --- _dedup_byline_from_body ---


def test_dedup_removes_matching_byline():
    result = _dedup_byline_from_body("John Smith", "John Smith\nThe article body.")
    assert result == "The article body."


def test_dedup_removes_with_by_prefix():
    result = _dedup_byline_from_body("John Smith", "By John Smith\nThe article body.")
    assert result == "The article body."


def test_dedup_preserves_non_matching():
    result = _dedup_byline_from_body("John Smith", "The article starts here.\nMore text.")
    assert result == "The article starts here.\nMore text."


def test_dedup_empty_author():
    body = "Some text."
    assert _dedup_byline_from_body("", body) == body


def test_dedup_empty_body():
    assert _dedup_byline_from_body("John Smith", "") == ""


def test_dedup_does_not_match_partial():
    """'Ed' author should NOT match 'Education reform...' body."""
    result = _dedup_byline_from_body("Ed", "Education reform has begun.\nMore text.")
    assert "Education reform" in result


def test_dedup_single_line_body():
    """Single-line body matching author should return empty, not crash."""
    result = _dedup_byline_from_body("John Smith", "John Smith")
    assert result == ""
