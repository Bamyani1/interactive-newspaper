"""Unit tests for detection region filtering rules."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.detection.region_filters import should_keep_region


def test_region_kept_when_area_and_aspect_valid():
    assert should_keep_region(0, 0, 300, 300, 1000, 1000)


def test_region_rejected_when_too_small():
    assert not should_keep_region(0, 0, 50, 50, 1000, 1000)


def test_region_rejected_when_aspect_extreme():
    assert not should_keep_region(0, 0, 1000, 100, 1000, 1000)
