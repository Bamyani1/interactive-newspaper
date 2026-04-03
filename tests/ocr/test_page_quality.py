"""Unit tests for pre-OCR page quality check."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from PIL import Image

from transcript_ocr.preprocessing.image_preprocessor import check_page_quality


def test_normal_page_no_flags():
    """A normal page with mixed pixel values should have no flags."""
    img = Image.new("L", (1000, 1000), color=128)
    # Add some variation so it's not blank
    pixels = img.load()
    for x in range(0, 500):
        for y in range(0, 500):
            pixels[x, y] = 30
    result = check_page_quality(img)
    assert not result.is_blank
    assert not result.is_low_res
    assert not result.is_inverted
    assert not result.should_skip
    assert result.message == ""


def test_blank_page_triggers_skip():
    """A uniform white image should be detected as blank."""
    img = Image.new("L", (1000, 1000), color=255)
    result = check_page_quality(img)
    assert result.is_blank
    assert result.should_skip
    assert "Blank" in result.message


def test_low_res_returns_warning_no_skip():
    """Low resolution should warn but not skip."""
    img = Image.new("L", (200, 200), color=128)
    # Add variation so it's not blank
    pixels = img.load()
    for x in range(0, 100):
        for y in range(0, 100):
            pixels[x, y] = 30
    result = check_page_quality(img)
    assert result.is_low_res
    assert not result.should_skip
    assert "Low resolution" in result.message


def test_inverted_scan_warns_no_skip():
    """Mostly dark image with enough variation should warn about inversion."""
    import random
    random.seed(42)
    img = Image.new("L", (1000, 1000), color=20)
    pixels = img.load()
    # Add significant variation (>5% different) so it's not blank
    for x in range(0, 1000):
        for y in range(0, 100):  # 10% of pixels are light
            pixels[x, y] = random.randint(100, 250)
    result = check_page_quality(img)
    assert result.is_inverted
    assert not result.should_skip
    assert "inverted" in result.message.lower()


def test_rgba_input_handled():
    """RGBA images with variation should not crash or falsely blank."""
    import random
    random.seed(42)
    img = Image.new("RGBA", (1000, 1000), color=(128, 128, 128, 255))
    pixels = img.load()
    for x in range(0, 500):
        for y in range(0, 500):
            pixels[x, y] = (30, 30, 30, 255)
    result = check_page_quality(img)
    assert not result.should_skip


def test_blank_ratio_boundary():
    """Exactly 95% uniform should NOT be flagged as blank (condition is > 0.95)."""
    # Create image where exactly 95% of pixels are the same
    img = Image.new("L", (100, 100), color=200)
    pixels = img.load()
    # Change 500 out of 10000 pixels (5%) to be different
    count = 0
    for x in range(100):
        for y in range(100):
            if count < 500:
                pixels[x, y] = 50
                count += 1
    result = check_page_quality(img)
    assert not result.is_blank


def test_low_res_blank_detected_as_blank():
    """A low-res blank page should be caught by blank detection (runs first)."""
    img = Image.new("L", (200, 200), color=255)
    result = check_page_quality(img)
    assert result.is_blank
    assert result.should_skip
