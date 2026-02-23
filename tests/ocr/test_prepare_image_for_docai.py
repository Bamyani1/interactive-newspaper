"""Unit tests for _prepare_image_for_docai() preprocessing pipeline."""

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

from transcript_ocr.recognition.docai_provider import DocAIError, _prepare_image_for_docai


def _make_clean_image(width: int = 300, height: int = 400) -> Image.Image:
    """Create a synthetic grayscale page with white background and a black text region."""
    arr = np.full((height, width), 240, dtype=np.uint8)
    # Simulate text region in center
    arr[50:350, 30:270] = 50
    return Image.fromarray(arr, mode="L")


def _make_noisy_image(width: int = 300, height: int = 400, noise_density: float = 0.05) -> Image.Image:
    """Create a grayscale image with salt-and-pepper noise."""
    rng = np.random.default_rng(42)
    arr = np.full((height, width), 200, dtype=np.uint8)
    # Add salt noise (bright speckles on medium background)
    salt_mask = rng.random((height, width)) < noise_density
    arr[salt_mask] = 255
    # Add pepper noise (dark speckles)
    pepper_mask = rng.random((height, width)) < noise_density
    arr[pepper_mask] = 0
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


def test_output_is_not_binary():
    """Output should not be binarized (pixel values should span a range, not just 0/255)."""
    image = _make_clean_image()
    png_bytes = _prepare_image_for_docai(image)

    decoded = Image.open(io.BytesIO(png_bytes))
    arr = np.array(decoded)
    unique_values = np.unique(arr)
    assert len(unique_values) > 2, (
        "Output should be grayscale (many values), not binary (only 0 and 255)"
    )


# ---------------------------------------------------------------------------
# CLAHE effect
# ---------------------------------------------------------------------------

def test_clahe_increases_local_contrast():
    """
    CLAHE should increase variance in locally uniform regions.
    We test this by checking that output pixel variance >= input pixel variance.
    """
    # Create image with very low contrast (uniform gray with tiny variation)
    arr = np.full((200, 200), 128, dtype=np.uint8)
    arr[50:150, 50:150] = 130  # tiny difference
    image = Image.fromarray(arr, mode="L")

    png_bytes = _prepare_image_for_docai(image)
    decoded = Image.open(io.BytesIO(png_bytes))
    out_arr = np.array(decoded)

    input_std = arr.std()
    output_std = out_arr.std()
    # CLAHE should increase contrast (larger standard deviation)
    assert output_std >= input_std, (
        f"Expected CLAHE to increase contrast: input_std={input_std:.2f}, output_std={output_std:.2f}"
    )


# ---------------------------------------------------------------------------
# Morphological noise removal
# ---------------------------------------------------------------------------

def test_morphological_noise_reduction():
    """Salt/pepper noise should be reduced in the output."""
    noisy = _make_noisy_image(noise_density=0.08)
    png_bytes = _prepare_image_for_docai(noisy)
    decoded = Image.open(io.BytesIO(png_bytes))

    noisy_arr = np.array(noisy)
    clean_arr = np.array(decoded)

    # Count extreme pixel values (noise indicator)
    noisy_extremes = np.sum((noisy_arr == 0) | (noisy_arr == 255))
    clean_extremes = np.sum((clean_arr == 0) | (clean_arr == 255))

    assert clean_extremes <= noisy_extremes, (
        f"Expected noise reduction: noisy_extremes={noisy_extremes}, clean_extremes={clean_extremes}"
    )


# ---------------------------------------------------------------------------
# Border crop
# ---------------------------------------------------------------------------

def test_border_crop_removes_scanner_edges():
    """Image with black scanner borders should be cropped smaller than input."""
    bordered = _make_bordered_image(width=400, height=500, border=40)
    original_size = bordered.size  # (400, 500)

    png_bytes = _prepare_image_for_docai(bordered)
    decoded = Image.open(io.BytesIO(png_bytes))
    cropped_size = decoded.size

    # Cropped image should be smaller in both dimensions
    assert cropped_size[0] < original_size[0], "Width should be reduced after border crop"
    assert cropped_size[1] < original_size[1], "Height should be reduced after border crop"


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
