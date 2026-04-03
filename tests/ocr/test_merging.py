"""Unit tests for merge seam repair logic."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.merging.llm_merge import _validate_merge_seam


def _mock_client_returning(text: str):
    """Create a mock Gemini client that returns the given text."""
    client = MagicMock()
    response = MagicMock()
    response.text = text
    client.models = MagicMock()
    # gemini_generate_with_retry calls client directly, so we patch at that level
    return client, response


def test_single_body_returns_unchanged():
    """Single-element list should pass through unchanged."""
    result = _validate_merge_seam(MagicMock(), ["Only one body."])
    assert result == ["Only one body."]


def test_clean_seam_not_repaired():
    """Bodies ending with terminal punctuation should not trigger repair."""
    bodies = [
        "First paragraph ends properly.",
        "Second paragraph starts here."
    ]
    # Should not even call Gemini since seam is clean
    client = MagicMock()
    result = _validate_merge_seam(client, bodies)
    assert len(result) == 2
    assert result[0] == "First paragraph ends properly."
    assert result[1] == "Second paragraph starts here."


def test_broken_seam_lowercase_triggers_repair():
    """Lowercase start after non-terminal end triggers Gemini seam repair."""
    bodies = [
        "would have to",
        "such regulations would apply"
    ]
    with patch("transcript_ocr.merging.llm_merge.gemini_generate_with_retry") as mock_gen:
        mock_response = MagicMock()
        mock_response.text = "would have to such regulations would apply"
        mock_gen.return_value = mock_response

        result = _validate_merge_seam(MagicMock(), bodies)
        assert mock_gen.called
        # Repair was applied
        assert any("would have to such" in b for b in result)


def test_broken_seam_uppercase_triggers_repair():
    """Uppercase start after non-terminal end should ALSO trigger repair.

    This is the key fix — the old code only triggered on lowercase starts.
    'would have to Such regulations' was missed because 'S' is uppercase.
    """
    bodies = [
        "would have to",
        "Such regulations would apply"
    ]
    with patch("transcript_ocr.merging.llm_merge.gemini_generate_with_retry") as mock_gen:
        mock_response = MagicMock()
        mock_response.text = "would have to such regulations would apply"
        mock_gen.return_value = mock_response

        result = _validate_merge_seam(MagicMock(), bodies)
        # The key assertion: Gemini was called even though next body starts uppercase
        assert mock_gen.called


def test_seam_with_quote_ending_not_repaired():
    """Body ending with closing quote should not trigger repair."""
    bodies = [
        'He said "this is the end."',
        "The next article starts here."
    ]
    client = MagicMock()
    result = _validate_merge_seam(client, bodies)
    assert len(result) == 2


def test_seam_valid_response_preserves_bodies():
    """When Gemini says VALID, bodies should be preserved unchanged."""
    bodies = [
        "End of paragraph without period",
        "Start of next paragraph"
    ]
    with patch("transcript_ocr.merging.llm_merge.gemini_generate_with_retry") as mock_gen:
        mock_response = MagicMock()
        mock_response.text = "VALID"
        mock_gen.return_value = mock_response

        result = _validate_merge_seam(MagicMock(), bodies)
        assert len(result) == 2
        assert result[0] == "End of paragraph without period"
        assert result[1] == "Start of next paragraph"


def test_gemini_failure_preserves_bodies():
    """If Gemini call throws an exception, bodies should be preserved."""
    bodies = [
        "End without punctuation",
        "start of next part"
    ]
    with patch("transcript_ocr.merging.llm_merge.gemini_generate_with_retry") as mock_gen:
        mock_gen.side_effect = Exception("API error")

        result = _validate_merge_seam(MagicMock(), bodies)
        assert len(result) == 2
        assert result[0] == "End without punctuation"
        assert result[1] == "start of next part"


def test_empty_bodies_skipped():
    """Empty bodies in the list should be passed through."""
    bodies = ["Some text.", "", "More text."]
    result = _validate_merge_seam(MagicMock(), bodies)
    # Empty body gets appended, then filtered by the [b for b if b.strip()] at end
    assert all(b.strip() for b in result)


def test_deterministic_merge_multi_article_continuation():
    """When 2 articles on page 1 continue to page 5, match by headline similarity."""
    from transcript_ocr.merging.deterministic_merge import _deterministic_merge

    article_data = [
        {"page_label": "1", "headline": "Campus Protest Grows", "body": "Students gathered at the quad...",
         "continuation": {"continues_on": "5", "continued_from": None}},
        {"page_label": "1", "headline": "Student Demands Issued", "body": "A list of demands was presented...",
         "continuation": {"continues_on": "5", "continued_from": None}},
        {"page_label": "5", "headline": "Campus Protest", "body": "The protest continued into the evening...",
         "continuation": {"continues_on": None, "continued_from": "1"}},
        {"page_label": "5", "headline": "Student Demands", "body": "The demands included tuition freeze...",
         "continuation": {"continues_on": None, "continued_from": "1"}},
    ]
    groups = _deterministic_merge(article_data)
    # Should produce 2 groups: [0,2] and [1,3]
    assert len(groups) == 2
    group_sets = [set(g) for g in groups]
    assert {0, 2} in group_sets
    assert {1, 3} in group_sets
