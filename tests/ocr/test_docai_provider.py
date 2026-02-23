"""Tests for DocAI provider — happy path, failures, and continuation detection."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.recognition.docai_provider import (
    DocAIError,
    DocAIResult,
    _extract_continuation_markers,
    extract_page_text,
)


def _make_mock_document(text: str, token_confidences: list[float] | None = None):
    """Build a minimal mock google.cloud.documentai Document."""
    token_confidences = token_confidences or [0.95, 0.92, 0.88]

    # Text segment pointing at the full text
    seg = MagicMock()
    seg.start_index = 0
    seg.end_index = len(text)

    # Paragraph layout
    para_layout = MagicMock()
    para_layout.text_anchor.text_segments = [seg]
    para = MagicMock()
    para.layout = para_layout

    # Page
    page = MagicMock()
    page.paragraphs = [para]

    # Tokens
    tokens = []
    for i, conf in enumerate(token_confidences):
        tok_seg = MagicMock()
        tok_seg.start_index = i
        tok_seg.end_index = i + 1
        tok_layout = MagicMock()
        tok_layout.confidence = conf
        tok_layout.text_anchor.text_segments = [tok_seg]
        tok = MagicMock()
        tok.layout = tok_layout
        tokens.append(tok)
    page.tokens = tokens

    doc = MagicMock()
    doc.text = text
    doc.pages = [page]
    return doc


def _make_mock_client(document):
    """Return a mock DocumentProcessorServiceClient that returns document."""
    result = MagicMock()
    result.document = document
    client = MagicMock()
    client.process_document.return_value = result
    return client


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------

def test_extract_page_text_happy_path(monkeypatch, tmp_path):
    """DocAI returns text → DocAIResult is populated correctly."""
    text = "Headline News\nSome article body.\nContinued on page 5"
    document = _make_mock_document(text, token_confidences=[0.95, 0.80, 0.75])
    client = _make_mock_client(document)

    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "proj-123")
    monkeypatch.setenv("DOCUMENT_AI_PROCESSOR_ID", "proc-456")
    monkeypatch.setenv("DOCUMENT_AI_LOCATION", "us")

    # Patch the lazy client singleton and _prepare_image_for_docai
    with patch("transcript_ocr.recognition.docai_provider._get_docai_client", return_value=client), \
         patch("transcript_ocr.recognition.docai_provider._prepare_image_for_docai", return_value=b"fakepng"):
        image = Image.new("L", (100, 100), color=200)
        result = extract_page_text(image)

    assert isinstance(result, DocAIResult)
    assert result.raw_text == text
    assert len(result.paragraphs) == 1
    assert "Continued on page 5" in result.continuation_markers[0]
    assert result.mean_confidence > 0.0


# ---------------------------------------------------------------------------
# Hard failure paths
# ---------------------------------------------------------------------------

def test_extract_page_text_api_error_raises_docai_error(monkeypatch):
    """API error → DocAIError raised (not swallowed)."""
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "proj-123")
    monkeypatch.setenv("DOCUMENT_AI_PROCESSOR_ID", "proc-456")

    client = MagicMock()
    client.process_document.side_effect = RuntimeError("quota exceeded")

    with patch("transcript_ocr.recognition.docai_provider._get_docai_client", return_value=client), \
         patch("transcript_ocr.recognition.docai_provider._prepare_image_for_docai", return_value=b"fakepng"):
        image = Image.new("L", (100, 100), color=200)
        with pytest.raises(DocAIError, match="Document AI API error"):
            extract_page_text(image)


def test_extract_page_text_empty_response_raises_docai_error(monkeypatch):
    """Empty text response → DocAIError raised."""
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "proj-123")
    monkeypatch.setenv("DOCUMENT_AI_PROCESSOR_ID", "proc-456")

    document = _make_mock_document("")
    client = _make_mock_client(document)

    with patch("transcript_ocr.recognition.docai_provider._get_docai_client", return_value=client), \
         patch("transcript_ocr.recognition.docai_provider._prepare_image_for_docai", return_value=b"fakepng"):
        image = Image.new("L", (100, 100), color=200)
        with pytest.raises(DocAIError, match="empty text"):
            extract_page_text(image)


def test_extract_page_text_missing_env_raises_docai_error(monkeypatch):
    """Missing env vars → DocAIError raised immediately."""
    monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)
    monkeypatch.delenv("DOCUMENT_AI_PROCESSOR_ID", raising=False)

    image = Image.new("L", (100, 100), color=200)
    with pytest.raises(DocAIError, match="GOOGLE_CLOUD_PROJECT"):
        extract_page_text(image)


# ---------------------------------------------------------------------------
# Continuation detection
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text,expected_fragment", [
    ("Some text.\nContinued on page 3\nMore text.", "Continued on page 3"),
    ("Story continues.\n(p. 7)\nAnother story.", "(p. 7)"),
    ("See page 12 for details.", "See page 12"),
    ("Cont. on page 4", "Cont. on page 4"),
    ("Continued from page 2\nThe story picks up.", "Continued from page 2"),
])
def test_continuation_markers_detected(text, expected_fragment):
    """Continuation markers in various formats are extracted correctly."""
    markers = _extract_continuation_markers(text)
    assert any(expected_fragment.lower() in m.lower() for m in markers), (
        f"Expected '{expected_fragment}' in markers {markers}"
    )


def test_no_continuation_markers_in_plain_text():
    """Text without any continuation markers returns empty list."""
    text = "Regular article body. No continuations here. The end."
    markers = _extract_continuation_markers(text)
    assert markers == []
