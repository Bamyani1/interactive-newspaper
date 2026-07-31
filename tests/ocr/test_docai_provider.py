"""Tests for the lossless Document AI OCR transport and failure policy."""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.recognition.docai_provider import (  # noqa: E402
    DocAIError,
    DocAIParagraph,
    DocAIResult,
    _get_docai_client,
    _is_transient_docai_error,
    extract_page_text,
)
from transcript_ocr.recognition.page_extractor import _format_docai_text  # noqa: E402
import transcript_ocr.recognition.docai_provider as docai_provider  # noqa: E402


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
    para_layout.bounding_poly.normalized_vertices = [
        SimpleNamespace(x=0.10, y=0.20),
        SimpleNamespace(x=0.40, y=0.20),
        SimpleNamespace(x=0.40, y=0.30),
        SimpleNamespace(x=0.10, y=0.30),
    ]
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
    assert result.paragraph_regions == [
        DocAIParagraph(text=text, bounds=(0.10, 0.20, 0.40, 0.30))
    ]
    # Document AI is an OCR transport only. The raw marker remains available
    # to Gemini, but local regexes do not make continuation decisions.
    assert "Continued on page 5" in result.raw_text
    assert result.mean_confidence > 0.0
    request = client.process_document.call_args.kwargs["request"]
    assert request.name == (
        "projects/proj-123/locations/us/processors/proc-456/processorVersions/stable"
    )
    assert client.process_document.call_args.kwargs["timeout"] == 240


def test_page_prompt_formats_geometry_as_non_historical_metadata():
    result = DocAIResult(
        raw_text="First paragraph.",
        paragraphs=["First paragraph."],
        paragraph_regions=[
            DocAIParagraph(
                text="First paragraph.",
                bounds=(0.125, 0.25, 0.5, 0.75),
            )
        ],
    )

    formatted = _format_docai_text(result)

    assert "NON-HISTORICAL OCR LAYOUT METADATA" in formatted
    assert "[0.12500, 0.25000, 0.50000, 0.75000]" in formatted
    assert formatted.endswith("First paragraph.")


# ---------------------------------------------------------------------------
# Hard failure paths
# ---------------------------------------------------------------------------

def test_extract_page_text_api_error_raises_docai_error(monkeypatch):
    """API error → DocAIError raised (not swallowed)."""
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "proj-123")
    monkeypatch.setenv("DOCUMENT_AI_PROCESSOR_ID", "proc-456")
    monkeypatch.setenv("DOCUMENT_AI_LOCATION", "us")

    client = MagicMock()
    client.process_document.side_effect = RuntimeError("quota exceeded")

    with patch("transcript_ocr.recognition.docai_provider._get_docai_client", return_value=client), \
         patch("transcript_ocr.recognition.docai_provider._prepare_image_for_docai", return_value=b"fakepng"):
        image = Image.new("L", (100, 100), color=200)
        with pytest.raises(DocAIError, match="Document AI API error"):
            extract_page_text(image)


def test_extract_page_text_empty_response_is_valid(monkeypatch):
    """An empty OCR response remains valid for visual-only or blank pages."""
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "proj-123")
    monkeypatch.setenv("DOCUMENT_AI_PROCESSOR_ID", "proc-456")
    monkeypatch.setenv("DOCUMENT_AI_LOCATION", "us")

    document = _make_mock_document("")
    client = _make_mock_client(document)

    with patch("transcript_ocr.recognition.docai_provider._get_docai_client", return_value=client), \
         patch("transcript_ocr.recognition.docai_provider._prepare_image_for_docai", return_value=b"fakepng"):
        image = Image.new("L", (100, 100), color=200)
        result = extract_page_text(image)

    assert result.raw_text == ""
    assert result.paragraphs == []


def test_extract_page_text_missing_env_raises_docai_error(monkeypatch):
    """Missing env vars → DocAIError raised immediately."""
    monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)
    monkeypatch.delenv("DOCUMENT_AI_PROCESSOR_ID", raising=False)
    monkeypatch.delenv("DOCUMENT_AI_LOCATION", raising=False)

    image = Image.new("L", (100, 100), color=200)
    with pytest.raises(DocAIError, match="GOOGLE_CLOUD_PROJECT"):
        extract_page_text(image)


def test_extract_page_text_retries_transient_5xx_with_same_request(monkeypatch):
    """A transient 5xx uses the bounded retry budget without changing config."""
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "proj-123")
    monkeypatch.setenv("DOCUMENT_AI_PROCESSOR_ID", "proc-456")
    monkeypatch.setenv("DOCUMENT_AI_LOCATION", "us")

    class _TransientError(RuntimeError):
        status_code = 502

    document = _make_mock_document("Recovered text")
    success = MagicMock(document=document)
    client = MagicMock()
    client.process_document.side_effect = [_TransientError("bad gateway"), success]

    with patch(
        "transcript_ocr.recognition.docai_provider._get_docai_client",
        return_value=client,
    ), patch(
        "transcript_ocr.recognition.docai_provider._prepare_image_for_docai",
        return_value=b"fakepng",
    ), patch("transcript_ocr.recognition.docai_provider.time.sleep") as sleep:
        result = extract_page_text(Image.new("L", (100, 100), color=200))

    assert result.raw_text == "Recovered text"
    assert client.process_document.call_count == 2
    first = client.process_document.call_args_list[0].kwargs
    second = client.process_document.call_args_list[1].kwargs
    assert first["request"].name == second["request"].name
    assert first["timeout"] == second["timeout"] == 240
    sleep.assert_called_once_with(2)


def test_extract_page_text_exhausts_three_transient_attempts(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "proj-123")
    monkeypatch.setenv("DOCUMENT_AI_PROCESSOR_ID", "proc-456")
    monkeypatch.setenv("DOCUMENT_AI_LOCATION", "us")

    class _TransientError(RuntimeError):
        status_code = 503

    client = MagicMock()
    client.process_document.side_effect = _TransientError("unavailable")
    with patch(
        "transcript_ocr.recognition.docai_provider._get_docai_client",
        return_value=client,
    ), patch(
        "transcript_ocr.recognition.docai_provider._prepare_image_for_docai",
        return_value=b"fakepng",
    ), patch("transcript_ocr.recognition.docai_provider.time.sleep") as sleep:
        with pytest.raises(DocAIError, match="unavailable"):
            extract_page_text(Image.new("L", (100, 100), color=200))

    assert client.process_document.call_count == 3
    assert [call.args[0] for call in sleep.call_args_list] == [2, 4]


@pytest.mark.parametrize("status_code", [400, 403])
def test_extract_page_text_does_not_retry_permanent_4xx(monkeypatch, status_code):
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "proj-123")
    monkeypatch.setenv("DOCUMENT_AI_PROCESSOR_ID", "proc-456")
    monkeypatch.setenv("DOCUMENT_AI_LOCATION", "us")

    class _PermanentError(RuntimeError):
        pass

    failure = _PermanentError("permanent client error")
    failure.status_code = status_code
    client = MagicMock()
    client.process_document.side_effect = failure
    with patch(
        "transcript_ocr.recognition.docai_provider._get_docai_client",
        return_value=client,
    ), patch(
        "transcript_ocr.recognition.docai_provider._prepare_image_for_docai",
        return_value=b"fakepng",
    ), patch("transcript_ocr.recognition.docai_provider.time.sleep") as sleep:
        with pytest.raises(DocAIError, match="permanent client error"):
            extract_page_text(Image.new("L", (100, 100), color=200))

    assert client.process_document.call_count == 1
    sleep.assert_not_called()


def test_transient_status_accepts_callable_enum_shape():
    class _Code:
        value = (503, "unavailable")

    class _Failure(RuntimeError):
        def code(self):
            return _Code()

    assert _is_transient_docai_error(_Failure("remote failure")) is True


def test_docai_client_uses_explicit_regional_endpoint(monkeypatch):
    monkeypatch.setenv("DOCUMENT_AI_LOCATION", "eu")
    client = MagicMock()
    docai_provider._docai_client = None
    try:
        with patch(
            "google.cloud.documentai.DocumentProcessorServiceClient",
            return_value=client,
        ) as constructor:
            assert _get_docai_client() is client
        constructor.assert_called_once_with(
            client_options={"api_endpoint": "eu-documentai.googleapis.com"}
        )
    finally:
        docai_provider._docai_client = None
