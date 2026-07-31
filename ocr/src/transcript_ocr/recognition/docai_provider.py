"""Google Cloud Document AI provider for deterministic page OCR."""

from __future__ import annotations

import io
import os
import time
from dataclasses import dataclass, field

from PIL import Image

from ..config.constants import (
    DOCAI_CONFIDENCE_THRESHOLD,
    DOCAI_MAX_BYTES,
)
from ..shared.console import warning


class DocAIError(Exception):
    """Raised on a Document AI transport, configuration, or API failure."""


@dataclass
class DocAIResult:
    """Structured output from Document AI Enterprise OCR."""

    raw_text: str
    paragraphs: list[str] = field(default_factory=list)
    paragraph_regions: list["DocAIParagraph"] = field(default_factory=list)
    low_confidence_words: list[str] = field(default_factory=list)
    mean_confidence: float = 0.0


@dataclass(frozen=True)
class DocAIParagraph:
    """One OCR paragraph with ephemeral normalized source-page geometry."""

    text: str
    bounds: tuple[float, float, float, float] | None = None


# Lazy-loaded Document AI client singleton
_docai_client = None


def _get_docai_client():
    """Return a cached Document AI client (initialized once)."""
    global _docai_client
    if _docai_client is None:
        from google.cloud import documentai

        location = os.getenv("DOCUMENT_AI_LOCATION")
        if not location:
            raise DocAIError("DOCUMENT_AI_LOCATION is required for Document AI")
        client_options = {"api_endpoint": f"{location}-documentai.googleapis.com"}
        _docai_client = documentai.DocumentProcessorServiceClient(
            client_options=client_options
        )
    return _docai_client


def _prepare_image_for_docai(image: Image.Image) -> bytes:
    """
    Encode the fixed grayscale OCR derivative as lossless PNG bytes.

    No contrast enhancement, morphology, binarization, border crop, resize, or
    sharpening is permitted here.  Geometry and historical ink evidence must
    remain identical to the derivative produced by preprocessing.

    Args:
        image: 8-bit grayscale PIL image produced by ``preprocess_image``.

    Returns:
        PNG-encoded bytes ready for Document AI

    Raises:
        DocAIError: If output bytes exceed DOCAI_MAX_BYTES (safety net)
    """
    processed = image.convert("L")
    buf = io.BytesIO()
    processed.save(buf, format="PNG", optimize=True)
    png_bytes = buf.getvalue()

    if len(png_bytes) > DOCAI_MAX_BYTES:
        size_mb = len(png_bytes) / (1024 * 1024)
        raise DocAIError(
            f"Prepared image is {size_mb:.1f}MB, exceeds {DOCAI_MAX_BYTES / (1024*1024):.0f}MB limit"
        )

    return png_bytes


def _extract_paragraph_regions(document) -> list[DocAIParagraph]:
    """Extract paragraph text and normalized geometry without persisting OCR."""
    paragraphs: list[DocAIParagraph] = []
    if not document.pages:
        return paragraphs

    page = document.pages[0]
    full_text = document.text

    for para in page.paragraphs:
        if not para.layout.text_anchor.text_segments:
            continue
        para_text_parts = []
        for seg in para.layout.text_anchor.text_segments:
            start = int(seg.start_index) if seg.start_index else 0
            end = int(seg.end_index) if seg.end_index else 0
            para_text_parts.append(full_text[start:end])
        para_text = "".join(para_text_parts).strip()
        if para_text:
            polygon = getattr(para.layout, "bounding_poly", None)
            vertices = list(getattr(polygon, "normalized_vertices", []) or [])
            bounds = None
            if vertices:
                xs = [float(getattr(vertex, "x", 0.0) or 0.0) for vertex in vertices]
                ys = [float(getattr(vertex, "y", 0.0) or 0.0) for vertex in vertices]
                bounds = (min(xs), min(ys), max(xs), max(ys))
            paragraphs.append(DocAIParagraph(text=para_text, bounds=bounds))

    return paragraphs


def _extract_paragraphs(document) -> list[str]:
    """Compatibility text-only view of Document AI paragraph records."""
    return [paragraph.text for paragraph in _extract_paragraph_regions(document)]


def _extract_token_confidences(document) -> tuple[list[str], float]:
    """
    Return (low_confidence_words, mean_confidence) from Document AI tokens.

    A word is "low confidence" if its layout.confidence < DOCAI_CONFIDENCE_THRESHOLD.
    """
    if not document.pages:
        return [], 0.0

    page = document.pages[0]
    full_text = document.text
    confidences: list[float] = []
    low_conf_words: list[str] = []

    for token in page.tokens:
        conf = token.layout.confidence if token.layout.confidence else 0.0
        confidences.append(conf)
        if conf < DOCAI_CONFIDENCE_THRESHOLD:
            # Extract the word text
            segs = token.layout.text_anchor.text_segments
            if segs:
                start = int(segs[0].start_index) if segs[0].start_index else 0
                end = int(segs[0].end_index) if segs[0].end_index else 0
                word = full_text[start:end].strip()
                if word:
                    low_conf_words.append(word)

    mean_conf = sum(confidences) / len(confidences) if confidences else 0.0
    return low_conf_words, mean_conf


def _is_transient_docai_error(exc: Exception) -> bool:
    """Check if a DocAI exception is transient and worth retrying."""
    if isinstance(exc, (TimeoutError, ConnectionError)):
        return True
    code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    if callable(code):
        code = code()
    if hasattr(code, "value"):
        code = code.value
    if isinstance(code, tuple):
        code = code[0]
    if code is not None:
        try:
            code_int = int(code)
            # 4xx errors are permanent (bad request, too large, etc.)
            if 400 <= code_int < 500 and code_int != 429:
                return False
            return code_int == 429 or 500 <= code_int < 600
        except (ValueError, TypeError):
            pass
    exc_str = str(exc).lower()
    # 400-level errors are permanent — don't retry
    if "400" in exc_str or "bad request" in exc_str:
        return False
    return any(
        term in exc_str
        for term in [
            "429",
            "500",
            "502",
            "503",
            "504",
            "timeout",
            "deadline exceeded",
            "unavailable",
            "resource exhausted",
            "server error",
        ]
    )


def extract_page_text(image: Image.Image) -> DocAIResult:
    """
    Run Document AI Enterprise OCR on a preprocessed page image.

    This is the public entry point. Applies _prepare_image_for_docai() then
    calls the Document AI API to get deterministic character-level OCR.

    Args:
        image: Grayscale PIL Image (output of preprocess_image())

    Returns:
        DocAIResult with raw text, column blocks, continuation markers,
        low-confidence words, and mean confidence score

    Raises:
        DocAIError: On configuration, transport, quota, or API failure
    """
    from google.cloud import documentai

    project_id = os.getenv("GOOGLE_CLOUD_PROJECT")
    processor_id = os.getenv("DOCUMENT_AI_PROCESSOR_ID")
    location = os.getenv("DOCUMENT_AI_LOCATION")

    if not project_id or not processor_id or not location:
        raise DocAIError(
            "GOOGLE_CLOUD_PROJECT, DOCUMENT_AI_PROCESSOR_ID, and "
            "DOCUMENT_AI_LOCATION must be set for DocAI"
        )

    processor_name = (
        f"projects/{project_id}/locations/{location}/processors/{processor_id}"
        "/processorVersions/stable"
    )

    # Prepare image bytes
    png_bytes = _prepare_image_for_docai(image)

    raw_document = documentai.RawDocument(
        content=png_bytes,
        mime_type="image/png",
    )

    request = documentai.ProcessRequest(
        name=processor_name,
        raw_document=raw_document,
    )

    client = _get_docai_client()
    max_attempts = 3
    for attempt in range(max_attempts):
        try:
            result = client.process_document(request=request, timeout=240)
            break
        except Exception as exc:
            if _is_transient_docai_error(exc) and attempt + 1 < max_attempts:
                delay = 2 * (2 ** attempt)  # 2s, 4s, 8s
                warning(
                    f"DocAI error ({exc}), retrying in {delay}s "
                    f"(attempt {attempt + 2}/{max_attempts})"
                )
                time.sleep(delay)
            else:
                raise DocAIError(f"Document AI API error: {exc}") from exc

    document = result.document
    raw_text = document.text or ""

    paragraph_regions = _extract_paragraph_regions(document)
    paragraphs = [paragraph.text for paragraph in paragraph_regions]
    low_confidence_words, mean_confidence = _extract_token_confidences(document)

    return DocAIResult(
        raw_text=raw_text,
        paragraphs=paragraphs,
        paragraph_regions=paragraph_regions,
        low_confidence_words=low_confidence_words,
        mean_confidence=mean_confidence,
    )


__all__ = [
    "DocAIError",
    "DocAIParagraph",
    "DocAIResult",
    "_prepare_image_for_docai",
    "extract_page_text",
]
