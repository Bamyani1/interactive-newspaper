"""Unit tests for merge boundary text cleanup."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.merging.boundary_cleanup import clean_merge_boundary


def test_joins_truncated_word():
    """'secretari' + 'al services' -> 'secretarial services'."""
    seg1 = "including secretari"
    seg2 = "al services for the project."
    result = clean_merge_boundary(seg1, seg2)
    assert result == "including\n\nsecretarial services for the project."


def test_removes_duplicate_sentence_at_seam():
    """Same sentence at end of seg1 and start of seg2 -> deduplicated."""
    seg1 = "First paragraph.\n\nThe court decided the case."
    seg2 = "The court decided the case.\n\nNext paragraph."
    result = clean_merge_boundary(seg1, seg2)
    assert result.count("The court decided the case.") == 1
    assert "First paragraph." in result
    assert "Next paragraph." in result


def test_preserves_clean_boundary():
    """No changes when boundary is clean."""
    seg1 = "First article section ends here."
    seg2 = "Second article section starts here."
    result = clean_merge_boundary(seg1, seg2)
    assert result == "First article section ends here.\n\nSecond article section starts here."


def test_handles_empty_segments():
    assert clean_merge_boundary("", "Some text.") == "Some text."
    assert clean_merge_boundary("Some text.", "") == "Some text."
    assert clean_merge_boundary("", "") == ""


def test_joins_word_split_across_boundary():
    """'s' at end + 'everal' at start when seg1 ends without punctuation."""
    seg1 = "He published s"
    seg2 = "everal articles on Arabia."
    result = clean_merge_boundary(seg1, seg2)
    assert "several" in result.lower()
