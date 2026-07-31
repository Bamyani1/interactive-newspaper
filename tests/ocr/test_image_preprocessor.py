"""Locked source-master and OCR-derivative preprocessing tests."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

import transcript_ocr.preprocessing.image_preprocessor as preprocessor
from transcript_ocr.preprocessing.skew import SkewEstimate


def _no_skew(_image: Image.Image) -> SkewEstimate:
    return SkewEstimate(0.0, 0.0, False)


def test_source_master_preserves_native_color_and_flattens_alpha():
    image = Image.new("RGBA", (2, 1), (10, 20, 30, 255))
    image.putpixel((1, 0), (0, 0, 0, 0))

    master = preprocessor.normalize_source_master(image)

    assert master.mode == "RGB"
    assert master.size == (2, 1)
    assert master.getpixel((0, 0)) == (10, 20, 30)
    assert master.getpixel((1, 0)) == (255, 255, 255)


def test_ocr_derivative_is_only_grayscale_when_no_skew(monkeypatch):
    image = Image.new("RGB", (8, 6), (20, 80, 140))
    image.putpixel((0, 0), (250, 100, 10))
    monkeypatch.setattr(preprocessor, "estimate_skew_angle", _no_skew)

    derivative = preprocessor.preprocess_image(image)

    expected = ImageOps.grayscale(image)
    assert derivative.mode == "L"
    assert derivative.size == image.size
    assert np.array_equal(np.asarray(derivative), np.asarray(expected))


def test_prepare_paths_keeps_source_and_ocr_branches_explicit(tmp_path, monkeypatch):
    source = tmp_path / "input.png"
    Image.new("RGB", (32, 24), (30, 90, 150)).save(source)
    monkeypatch.setattr(preprocessor, "estimate_skew_angle", _no_skew)

    paths = preprocessor.prepare_page_image_paths(
        source,
        tmp_path / "work",
        page_key="page-01",
    )

    assert paths.source_master_path.endswith("page-01.source.png")
    assert paths.ocr_derivative_path.endswith("page-01.ocr.png")
    assert paths.source_dimensions == (32, 24)
    assert paths.ocr_dimensions == (32, 24)
    with Image.open(paths.source_master_path) as master:
        assert master.mode == "RGB"
        assert master.getpixel((0, 0)) == (30, 90, 150)
    with Image.open(paths.ocr_derivative_path) as derivative:
        assert derivative.mode == "L"
    assert list((tmp_path / "work").glob("*.part")) == []


def test_exif_orientation_is_applied_to_source_master(tmp_path):
    source = tmp_path / "oriented.jpg"
    image = Image.new("RGB", (12, 8), (100, 80, 60))
    exif = image.getexif()
    exif[274] = 6
    image.save(source, exif=exif)

    with Image.open(source) as opened:
        master = preprocessor.normalize_source_master(opened)

    assert master.size == (8, 12)
    assert 274 not in master.getexif()


def test_boundary_skew_is_warned_and_not_rotated(monkeypatch):
    image = Image.new("L", (20, 10), 255)
    monkeypatch.setattr(
        preprocessor,
        "estimate_skew_angle",
        lambda _image: SkewEstimate(2.0, 0.0, True),
    )
    warnings: list[str] = []
    monkeypatch.setattr(preprocessor, "warning", warnings.append)

    derivative, estimate = preprocessor.create_ocr_derivative(image)

    assert estimate.hit_search_boundary
    assert derivative.size == image.size
    assert warnings and "boundary" in warnings[0]


def test_applied_skew_uses_expanded_white_canvas(monkeypatch):
    image = Image.new("L", (20, 10), 255)
    image.putpixel((10, 5), 0)
    monkeypatch.setattr(
        preprocessor,
        "estimate_skew_angle",
        lambda _image: SkewEstimate(0.2, 0.2, False),
    )

    derivative, _estimate = preprocessor.create_ocr_derivative(image)

    assert derivative.mode == "L"
    assert derivative.width > image.width or derivative.height > image.height
    assert derivative.getpixel((0, 0)) == 255
