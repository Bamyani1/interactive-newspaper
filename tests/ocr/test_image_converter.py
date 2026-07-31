"""Unit tests for Phase 0 TIF-to-PNG converter."""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

import numpy as np
import pytest
from PIL import Image

from transcript_ocr.preprocessing.image_converter import (
    LosslessConversionError,
    convert_edition_images,
)


def _make_tif(directory: str, name: str, width: int = 1000, height: int = 1500) -> str:
    """Create a synthetic grayscale TIF for testing."""
    path = os.path.join(directory, name)
    img = Image.new("L", (width, height), color=200)
    pixels = img.load()
    # Add text-like variation so it's not a blank uniform image
    for x in range(0, width, 10):
        for y in range(0, height, 10):
            pixels[x, y] = 40
    img.save(path, format="TIFF")
    return path


def test_converts_tif_to_png(tmp_path):
    """TIF should be converted to PNG with correct properties."""
    tif_path = _make_tif(str(tmp_path), "Page 01.tif")
    assert os.path.exists(tif_path)

    count = convert_edition_images(str(tmp_path))

    png_path = str(tmp_path / "Page 01.png")
    assert count == 1
    assert os.path.exists(png_path)
    assert not os.path.exists(tif_path)

    img = Image.open(png_path)
    assert img.mode == "L"
    assert img.size == (1000, 1500)


def test_output_under_8mb(tmp_path):
    """Converted PNG should be well under 8 MB for a realistic image."""
    _make_tif(str(tmp_path), "Page 01.tif", width=3000, height=4800)
    convert_edition_images(str(tmp_path))

    png_path = str(tmp_path / "Page 01.png")
    size_mb = os.path.getsize(png_path) / (1024 * 1024)
    assert size_mb < 8.0, f"PNG is {size_mb:.1f} MB, expected < 8 MB"


def test_deletes_original_tif(tmp_path):
    """Original TIF should be deleted after successful conversion."""
    tif_path = _make_tif(str(tmp_path), "Page 01.tif")
    convert_edition_images(str(tmp_path))

    assert not os.path.exists(tif_path)


def test_mismatched_existing_png_keeps_tif(tmp_path):
    """An unrelated existing PNG must never authorize source deletion."""
    tif_path = _make_tif(str(tmp_path), "Page 01.tif")

    # Pre-create a PNG (simulates prior conversion)
    png_path = str(tmp_path / "Page 01.png")
    Image.new("L", (1000, 1500), color=128).save(png_path, format="PNG")

    with pytest.raises(LosslessConversionError, match="does not match"):
        convert_edition_images(str(tmp_path))

    assert os.path.exists(png_path)
    assert os.path.exists(tif_path)


def test_matching_existing_png_is_verified_before_tif_delete(tmp_path):
    tif_path = _make_tif(str(tmp_path), "Page 01.tif")
    with Image.open(tif_path) as source:
        source.save(tmp_path / "Page 01.png", format="PNG")

    count = convert_edition_images(str(tmp_path))

    assert count == 0
    assert not os.path.exists(tif_path)


def test_returns_zero_when_no_tifs(tmp_path):
    """Should return 0 when no TIF files are present."""
    # Create a PNG (not a TIF)
    Image.new("L", (100, 100), color=128).save(str(tmp_path / "page.png"), format="PNG")

    count = convert_edition_images(str(tmp_path))
    assert count == 0


def test_empty_directory(tmp_path):
    """Should handle empty directory gracefully."""
    count = convert_edition_images(str(tmp_path))
    assert count == 0


def test_multiple_tifs_converted(tmp_path):
    """All TIFs in directory should be converted."""
    _make_tif(str(tmp_path), "Page 01.tif")
    _make_tif(str(tmp_path), "Page 02.tiff")
    _make_tif(str(tmp_path), "Page 03.tif")

    count = convert_edition_images(str(tmp_path))

    assert count == 3
    assert os.path.exists(str(tmp_path / "Page 01.png"))
    assert os.path.exists(str(tmp_path / "Page 02.png"))
    assert os.path.exists(str(tmp_path / "Page 03.png"))
    # No TIFs remain
    tifs = [f for f in os.listdir(str(tmp_path)) if f.lower().endswith((".tif", ".tiff"))]
    assert tifs == []


def test_rgba_tif_preserves_source_pixels(tmp_path):
    """Source-master conversion must not discard color or alpha."""
    path = str(tmp_path / "Page 01.tif")
    Image.new("RGBA", (1000, 1500), color=(128, 64, 32, 255)).save(path, format="TIFF")

    convert_edition_images(str(tmp_path))

    img = Image.open(str(tmp_path / "Page 01.png"))
    assert img.mode == "RGBA"
    assert img.getpixel((0, 0)) == (128, 64, 32, 255)


def test_rgb_pixels_are_identical_after_conversion(tmp_path):
    source_path = tmp_path / "Page 01.tif"
    pixels = np.arange(12 * 8 * 3, dtype=np.uint8).reshape((8, 12, 3))
    Image.fromarray(pixels, mode="RGB").save(source_path, format="TIFF")

    convert_edition_images(str(tmp_path))

    with Image.open(tmp_path / "Page 01.png") as converted:
        assert converted.mode == "RGB"
        assert np.array_equal(np.asarray(converted), pixels)


def test_converts_every_multiframe_tiff_page(tmp_path):
    source_path = tmp_path / "0001_Page 1.tif"
    frames = [
        Image.new("L", (20, 30), color=20),
        Image.new("L", (20, 30), color=120),
        Image.new("L", (20, 30), color=220),
    ]
    frames[0].save(source_path, save_all=True, append_images=frames[1:], format="TIFF")

    count = convert_edition_images(str(tmp_path))

    assert count == 1
    assert not source_path.exists()
    for index, expected in enumerate((20, 120, 220), start=1):
        output = tmp_path / f"0001_Page 1_frame_{index:04d}.png"
        assert output.exists()
        with Image.open(output) as image:
            assert image.getpixel((0, 0)) == expected


def test_failed_lossless_encoding_keeps_source_and_cleans_parts(tmp_path):
    source_path = tmp_path / "Page 01.tif"
    Image.new("CMYK", (20, 30), color=(10, 20, 30, 40)).save(
        source_path, format="TIFF"
    )

    with pytest.raises(LosslessConversionError):
        convert_edition_images(str(tmp_path))

    assert source_path.exists()
    assert list(tmp_path.glob("*.part")) == []


def test_skips_jpg_files(tmp_path):
    """JPG files should not be converted — pipeline handles them natively."""
    jpg_path = str(tmp_path / "Page 01.jpg")
    Image.new("L", (1000, 1500), color=200).save(jpg_path, format="JPEG")

    count = convert_edition_images(str(tmp_path))
    assert count == 0
    assert os.path.exists(jpg_path)  # JPG left untouched
