"""Unit tests for continuation marker parsing and stripping."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.merging.continuation import (
    _extract_continuation_info,
    _strip_continuation_markers,
)


# --- _strip_continuation_markers tests ---


def test_strip_standard_continued_on():
    text = "Article text (continued on page 5)"
    assert _strip_continuation_markers(text) == "Article text"


def test_strip_continued_from():
    text = "(Continued from page 1) The article continues here"
    result = _strip_continuation_markers(text)
    assert "Continued from page 1" not in result
    assert "article continues here" in result


def test_strip_garbled_page_reference():
    """OCR-corrupted (. 1) should be stripped — missing 'p'."""
    text = "Article text ends here (. 1)"
    result = _strip_continuation_markers(text)
    assert "(. 1)" not in result
    assert "Article text ends here" in result


def test_strip_garbled_continued_typo():
    """'Continuted' is a common OCR typo for 'Continued'."""
    text = "Article body Continuted from p. 1"
    result = _strip_continuation_markers(text)
    assert "Continuted" not in result


def test_strip_continued_typo_on():
    """'Continnued on page 5' — doubled 'n' typo."""
    text = "Article body Continnued on page 5"
    result = _strip_continuation_markers(text)
    assert "Continnued" not in result


def test_strip_parenthesized_continuation():
    text = "End of text (Continued on p. 7)"
    result = _strip_continuation_markers(text)
    assert "(Continued on p. 7)" not in result


def test_strip_cont_abbreviation():
    text = "Article text con't. on p. 3"
    result = _strip_continuation_markers(text)
    assert "con't" not in result


def test_strip_see_page():
    text = "For more details see page 12"
    result = _strip_continuation_markers(text)
    assert "see page 12" not in result


def test_strip_multiple_markers():
    text = "(Continued from page 1) Body text (continued on page 5)"
    result = _strip_continuation_markers(text)
    assert "Continued from page 1" not in result
    assert "continued on page 5" not in result
    assert "Body text" in result


def test_preserves_clean_text():
    text = "This is a normal article body with no markers."
    assert _strip_continuation_markers(text) == text


# --- _extract_continuation_info tests ---


def test_extract_continues_on():
    info = _extract_continuation_info("End of article. Continued on page 5")
    assert info["continues_on"] == "5"


def test_extract_continued_from():
    info = _extract_continuation_info("Continued from page 1. The story goes on.")
    assert info["continued_from"] == "1"


def test_extract_garbled_dot_page():
    """Garbled (. 1) should extract page number via fallback."""
    info = _extract_continuation_info("Article text ends here (. 1)")
    assert info["continues_on"] == "1"


def test_extract_garbled_dot_page_with_spaces():
    info = _extract_continuation_info("Article text ends here (.  3)")
    assert info["continues_on"] == "3"


def test_extract_p_dot_reference():
    info = _extract_continuation_info("See more (p. 7)")
    assert info["continues_on"] == "7"


def test_extract_no_markers():
    info = _extract_continuation_info("A perfectly normal article body.")
    assert info["continues_on"] is None
    assert info["continued_from"] is None


def test_extract_both_directions():
    info = _extract_continuation_info(
        "Continued from page 1. More text here. Continued on page 5"
    )
    assert info["continued_from"] == "1"
    assert info["continues_on"] == "5"
