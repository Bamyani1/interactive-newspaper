"""Google Cloud Document AI provider for deterministic page OCR."""

from __future__ import annotations

import io
import os
import re
import time
from dataclasses import dataclass, field

import numpy as np
from PIL import Image

from ..config.constants import (
    DOCAI_CLAHE_CLIP_LIMIT,
    DOCAI_CLAHE_TILE_SIZE,
    DOCAI_CONFIDENCE_THRESHOLD,
    DOCAI_MAX_BYTES,
)
from ..shared.console import warning


class DocAIError(Exception):
    """Raised on any Document AI failure — API error, quota, or empty response."""


@dataclass
class DocAIResult:
    """Structured output from Document AI Layout Parser."""

    raw_text: str
    paragraphs: list[str] = field(default_factory=list)
    continuation_markers: list[str] = field(default_factory=list)
    low_confidence_words: list[str] = field(default_factory=list)
    mean_confidence: float = 0.0


# Regex patterns for continuation markers (small italic text at column bottoms)
_CONTINUATION_PATTERNS = [
    re.compile(r"Continued\s+on\s+(?:page\s+)?(\w+)", re.IGNORECASE),
    re.compile(r"See\s+(?:page\s+)?(\w+)", re.IGNORECASE),
    re.compile(r"\(p\.\s*(\w+)\)", re.IGNORECASE),
    re.compile(r"Cont(?:inued)?\.?\s+(?:on\s+)?(?:page\s+)?(\w+)", re.IGNORECASE),
    re.compile(r"Continued\s+from\s+(?:page\s+)?(\w+)", re.IGNORECASE),
    re.compile(r"Turn\s+to\s+(?:page\s+)?(\w+)", re.IGNORECASE),
]

# Lazy-loaded Document AI client singleton
_docai_client = None


def _get_docai_client():
    """Return a cached Document AI client (initialized once)."""
    global _docai_client
    if _docai_client is None:
        from google.cloud import documentai

        location = os.getenv("DOCUMENT_AI_LOCATION", "us")
        client_options = {"api_endpoint": f"{location}-documentai.googleapis.com"}
        _docai_client = documentai.DocumentProcessorServiceClient(
            client_options=client_options
        )
    return _docai_client


def _prepare_image_for_docai(image: Image.Image) -> bytes:
    """
    Apply Document-AI–specific preprocessing and convert to PNG bytes.

    Steps (order matters):
    1. CLAHE — fixes uneven illumination on aged/yellowed newsprint
    2. Morphological opening — removes salt/pepper noise without thinning ink strokes
    3. Border crop — strips scanner black edges
    4. PNG encode — lossless, efficient for grayscale text

    Args:
        image: Grayscale PIL Image (already deskewed + contrast-enhanced by preprocess_image)

    Returns:
        PNG-encoded bytes ready for Document AI

    Raises:
        DocAIError: If output bytes exceed DOCAI_MAX_BYTES (safety net)
    """
    import cv2

    # Convert PIL grayscale to numpy array for cv2 operations
    arr = np.array(image.convert("L"), dtype=np.uint8)

    # 1. CLAHE: adaptive local contrast equalization
    #    clipLimit prevents over-amplifying noise in uniform regions
    clahe = cv2.createCLAHE(
        clipLimit=DOCAI_CLAHE_CLIP_LIMIT,
        tileGridSize=DOCAI_CLAHE_TILE_SIZE,
    )
    arr = clahe.apply(arr)

    # 2. Morphological opening: erode then dilate with a small kernel
    #    Removes isolated bright speckles (salt noise) on dark text backgrounds
    #    A 2x2 kernel is small enough to preserve ink strokes
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    arr = cv2.morphologyEx(arr, cv2.MORPH_OPEN, kernel)

    # 3. Border crop: strip black scanner edges via adaptive thresholding
    #    Otsu threshold → find bounding rect of content → crop to it with margin
    _, binary = cv2.threshold(arr, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # Content pixels are white (255) — find their bounding box
    coords = cv2.findNonZero(binary)
    if coords is not None:
        x, y, w, h = cv2.boundingRect(coords)
        # Add 20px margin (clipped to image bounds)
        margin = 20
        x1 = max(0, x - margin)
        y1 = max(0, y - margin)
        x2 = min(arr.shape[1], x + w + margin)
        y2 = min(arr.shape[0], y + h + margin)
        arr = arr[y1:y2, x1:x2]

    # Convert back to PIL and encode as PNG
    processed = Image.fromarray(arr, mode="L")
    buf = io.BytesIO()
    processed.save(buf, format="PNG", optimize=True)
    png_bytes = buf.getvalue()

    if len(png_bytes) > DOCAI_MAX_BYTES:
        size_mb = len(png_bytes) / (1024 * 1024)
        raise DocAIError(
            f"Prepared image is {size_mb:.1f}MB, exceeds {DOCAI_MAX_BYTES / (1024*1024):.0f}MB limit"
        )

    return png_bytes


def _extract_paragraphs(document) -> list[str]:
    """Extract paragraph-level text segments from a Document AI Document."""
    paragraphs: list[str] = []
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
            paragraphs.append(para_text)

    return paragraphs


def _extract_continuation_markers(text: str) -> list[str]:
    """Find all continuation marker strings in the page text."""
    markers: list[str] = []
    for pattern in _CONTINUATION_PATTERNS:
        for match in pattern.finditer(text):
            markers.append(match.group(0).strip())
    return markers


def _detect_truncated_continuation(text: str) -> bool:
    """
    Detect whether the tail of a page's DocAI text looks like a truncated
    continuation marker (e.g. "Cont", "Continued on pa...") that the
    regex-based extractor would have missed.

    Pure diagnostic — does NOT alter the extracted marker list. When this
    fires, the operator gets a warning on stderr indicating that the
    regex-based marker extraction may have lost a cross-page continuation
    signal. See docs/issues/0014.
    """
    if not text:
        return False
    tail = text[-64:].rstrip()
    if not tail:
        return False
    # Heuristic: the tail starts a continuation phrase but doesn't end with a
    # page number or terminal punctuation, and no full marker was matched in
    # the tail. We only check the tail because truncation by definition cuts
    # the end of the text, not the middle.
    truncation_heads = (
        "cont",
        "see pa",
        "see pag",
        "turn to",
    )
    tail_lower = tail.lower()
    # Look for a partial phrase at or near the very end (last ~32 chars)
    near_end = tail_lower[-32:]
    for head in truncation_heads:
        if head in near_end:
            # If any real marker was already matched by the regex, don't flag.
            fully_matched = False
            for pattern in _CONTINUATION_PATTERNS:
                for match in pattern.finditer(text[-128:]):
                    if head in match.group(0).lower():
                        fully_matched = True
                        break
                if fully_matched:
                    break
            if not fully_matched:
                return True
    return False


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
    code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    if code is not None:
        try:
            code_int = int(code)
            # 4xx errors are permanent (bad request, too large, etc.)
            if 400 <= code_int < 500 and code_int != 429:
                return False
            return code_int in {429, 500, 503}
        except (ValueError, TypeError):
            pass
    exc_str = str(exc).lower()
    # 400-level errors are permanent — don't retry
    if "400" in exc_str or "bad request" in exc_str:
        return False
    return any(
        term in exc_str
        for term in ["429", "timeout", "unavailable", "resource exhausted", "server error"]
    )


def extract_page_text(image: Image.Image) -> DocAIResult:
    """
    Run Document AI Layout Parser OCR on a preprocessed page image.

    This is the public entry point. Applies _prepare_image_for_docai() then
    calls the Document AI API to get deterministic character-level OCR.

    Args:
        image: Grayscale PIL Image (output of preprocess_image())

    Returns:
        DocAIResult with raw text, column blocks, continuation markers,
        low-confidence words, and mean confidence score

    Raises:
        DocAIError: On any API failure, quota error, or empty text response
    """
    from google.cloud import documentai

    project_id = os.getenv("GOOGLE_CLOUD_PROJECT")
    processor_id = os.getenv("DOCUMENT_AI_PROCESSOR_ID")
    location = os.getenv("DOCUMENT_AI_LOCATION", "us")

    if not project_id or not processor_id:
        raise DocAIError(
            "GOOGLE_CLOUD_PROJECT and DOCUMENT_AI_PROCESSOR_ID must be set for DocAI"
        )

    processor_name = (
        f"projects/{project_id}/locations/{location}/processors/{processor_id}"
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
    max_retries = 3
    for attempt in range(max_retries + 1):
        try:
            result = client.process_document(request=request)
            break
        except Exception as exc:
            if _is_transient_docai_error(exc) and attempt < max_retries:
                delay = 2 * (2 ** attempt)  # 2s, 4s, 8s
                warning(f"DocAI error ({exc}), retrying in {delay}s (attempt {attempt + 1}/{max_retries})")
                time.sleep(delay)
            else:
                raise DocAIError(f"Document AI API error: {exc}") from exc

    document = result.document
    raw_text = document.text or ""

    if not raw_text.strip():
        raise DocAIError("Document AI returned empty text — page may be blank or unreadable")

    paragraphs = _extract_paragraphs(document)
    continuation_markers = _extract_continuation_markers(raw_text)
    if _detect_truncated_continuation(raw_text):
        warning(
            "DocAI page text appears truncated near a continuation marker — "
            "cross-page merge may miss a continuation link on this page."
        )
    low_confidence_words, mean_confidence = _extract_token_confidences(document)

    return DocAIResult(
        raw_text=raw_text,
        paragraphs=paragraphs,
        continuation_markers=continuation_markers,
        low_confidence_words=low_confidence_words,
        mean_confidence=mean_confidence,
    )


__all__ = ["DocAIError", "DocAIResult", "_prepare_image_for_docai", "extract_page_text"]
