"""Regression guard for detect_image_regions filter-counter initialization."""

from __future__ import annotations

import inspect
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.detection.yolo_provider import detect_image_regions


def test_detect_image_regions_initializes_counters_outside_branch():
    source = inspect.getsource(detect_image_regions)
    anchor = source.index("total_detections = len(result.boxes)")
    section = source[anchor : anchor + 700]
    assert "filtered_by_class = 0" in section
    assert "filtered_by_area = 0" in section
    assert "filtered_by_aspect = 0" in section
    assert section.index("filtered_by_class = 0") < section.index("if total_detections > 0:")
