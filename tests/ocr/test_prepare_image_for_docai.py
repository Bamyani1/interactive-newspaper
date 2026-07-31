"""Unit tests for lossless Document AI PNG transport."""

from __future__ import annotations

import io
import sys
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.recognition.docai_provider import (  # noqa: E402
    DocAIError,
    _prepare_image_for_docai,
)


def _make_clean_image(width: int = 300, height: int = 400) -> Image.Image:
    """Create a synthetic grayscale page with white background and a black text region."""
    arr = np.full((height, width), 240, dtype=np.uint8)
    # Simulate text region in center
    arr[50:350, 30:270] = 50
    return Image.fromarray(arr, mode="L")


def _make_bordered_image(width: int = 400, height: int = 500, border: int = 40) -> Image.Image:
    """Create a grayscale image with black scanner borders."""
    arr = np.full((height, width), 240, dtype=np.uint8)
    # Simulate black scanner border on all sides
    arr[:border, :] = 0
    arr[-border:, :] = 0
    arr[:, :border] = 0
    arr[:, -border:] = 0
    # Content in center
    arr[border + 20:height - border - 20, border + 20:width - border - 20] = 200
    return Image.fromarray(arr, mode="L")


# ---------------------------------------------------------------------------
# Output format tests
# ---------------------------------------------------------------------------

def test_output_is_png_bytes():
    """Output bytes are valid PNG (not TIFF, JPEG, etc.)."""
    image = _make_clean_image()
    png_bytes = _prepare_image_for_docai(image)

    assert isinstance(png_bytes, bytes)
    # PNG magic bytes: \x89PNG\r\n\x1a\n
    assert png_bytes[:4] == b"\x89PNG", "Output must be PNG format"


def test_output_is_grayscale():
    """Decoded PNG must be single-channel grayscale (mode 'L')."""
    image = _make_clean_image()
    png_bytes = _prepare_image_for_docai(image)

    decoded = Image.open(io.BytesIO(png_bytes))
    assert decoded.mode == "L", f"Expected mode 'L', got '{decoded.mode}'"


def test_output_pixels_are_exactly_preserved():
    """PNG transport must not enhance, denoise, binarize, or otherwise edit pixels."""
    image = _make_clean_image()
    png_bytes = _prepare_image_for_docai(image)

    decoded = Image.open(io.BytesIO(png_bytes))
    np.testing.assert_array_equal(np.asarray(decoded), np.asarray(image.convert("L")))


# ---------------------------------------------------------------------------
# No enhancement or denoising
# ---------------------------------------------------------------------------

def test_low_contrast_pixels_remain_unchanged():
    """Low-contrast historical ink is not changed by CLAHE or other enhancement."""
    arr = np.full((200, 200), 128, dtype=np.uint8)
    arr[50:150, 50:150] = 130
    image = Image.fromarray(arr, mode="L")

    png_bytes = _prepare_image_for_docai(image)
    decoded = np.asarray(Image.open(io.BytesIO(png_bytes)))
    np.testing.assert_array_equal(decoded, arr)


# ---------------------------------------------------------------------------
# Geometry preservation
# ---------------------------------------------------------------------------

def test_scanner_edges_and_dimensions_are_preserved():
    """Scanner edges remain evidence; Document AI transport never crops them."""
    bordered = _make_bordered_image(width=400, height=500, border=40)

    png_bytes = _prepare_image_for_docai(bordered)
    decoded = Image.open(io.BytesIO(png_bytes))

    assert decoded.size == bordered.size
    np.testing.assert_array_equal(np.asarray(decoded), np.asarray(bordered))


# ---------------------------------------------------------------------------
# Safety check
# ---------------------------------------------------------------------------

def test_safety_check_raises_on_oversized_output():
    """If PNG bytes exceed DOCAI_MAX_BYTES, DocAIError is raised."""
    image = _make_clean_image()

    # Patch DOCAI_MAX_BYTES to 1 byte to force the safety check
    with patch("transcript_ocr.recognition.docai_provider.DOCAI_MAX_BYTES", 1):
        with pytest.raises(DocAIError, match="exceeds"):
            _prepare_image_for_docai(image)


# ---------------------------------------------------------------------------
# RGBA input compatibility
# ---------------------------------------------------------------------------

def test_rgba_input_is_handled():
    """Preprocessing should work even if image is accidentally passed as RGBA."""
    rgba = Image.new("RGBA", (100, 100), color=(200, 200, 200, 255))
    # Should not raise
    png_bytes = _prepare_image_for_docai(rgba)
    assert png_bytes[:4] == b"\x89PNG"
