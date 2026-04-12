"""Unit tests for Phase 0 TIF-to-PNG converter."""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from PIL import Image

from transcript_ocr.preprocessing.image_converter import convert_edition_images


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


def test_idempotent_skips_and_deletes_tif(tmp_path):
    """If PNG already exists, conversion is skipped but TIF is still deleted."""
    tif_path = _make_tif(str(tmp_path), "Page 01.tif")

    # Pre-create a PNG (simulates prior conversion)
    png_path = str(tmp_path / "Page 01.png")
    Image.new("L", (1000, 1500), color=128).save(png_path, format="PNG")

    count = convert_edition_images(str(tmp_path))

    assert count == 0  # No new conversion
    assert os.path.exists(png_path)  # PNG untouched
    assert not os.path.exists(tif_path)  # TIF deleted


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


def test_rgba_tif_converted_to_grayscale(tmp_path):
    """RGBA TIF should be converted to grayscale PNG."""
    path = str(tmp_path / "Page 01.tif")
    Image.new("RGBA", (1000, 1500), color=(128, 64, 32, 255)).save(path, format="TIFF")

    convert_edition_images(str(tmp_path))

    img = Image.open(str(tmp_path / "Page 01.png"))
    assert img.mode == "L"


def test_skips_jpg_files(tmp_path):
    """JPG files should not be converted — pipeline handles them natively."""
    jpg_path = str(tmp_path / "Page 01.jpg")
    Image.new("L", (1000, 1500), color=200).save(jpg_path, format="JPEG")

    count = convert_edition_images(str(tmp_path))
    assert count == 0
    assert os.path.exists(jpg_path)  # JPG left untouched
