"""Focused tests for the default newspaper-specific visual detector."""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.contracts.diagnostics_models import PageDiagnostics  # noqa: E402
from transcript_ocr.detection import (  # noqa: E402
    american_stories_provider,
    hybrid_provider,
    visual_provider,
    yolo_provider,
)
from transcript_ocr.detection.american_stories_provider import (  # noqa: E402
    AmericanStoriesDetection,
)
from transcript_ocr.detection.yolo_provider import DocLayoutDetection  # noqa: E402


def test_visual_router_defaults_to_hybrid(monkeypatch: pytest.MonkeyPatch):
    expected = [(1, 2, 3, 4)]
    monkeypatch.setattr(
        "transcript_ocr.detection.hybrid_provider.detect_image_regions",
        lambda image, diag=None: expected,
    )

    assert visual_provider.detect_image_regions(Image.new("L", (20, 20))) == expected


def test_visual_router_ignores_legacy_mode_override(monkeypatch: pytest.MonkeyPatch):
    expected = [(5, 6, 7, 8)]
    monkeypatch.setenv("OCR_VISUAL_DETECTOR", "doclayout")
    monkeypatch.setattr(
        "transcript_ocr.detection.hybrid_provider.detect_image_regions",
        lambda image, diag=None: expected,
    )

    assert visual_provider.detect_image_regions(Image.new("L", (20, 20))) == expected


def test_doclayout_fallback_requests_only_table_class(monkeypatch: pytest.MonkeyPatch):
    observed: list[set[str]] = []
    expected = DocLayoutDetection(0, 0, 0, 0, [])

    def fake_detection(image, accepted_classes):
        observed.append(accepted_classes)
        return expected

    monkeypatch.setattr(yolo_provider, "detect_doclayout_regions", fake_detection)

    assert yolo_provider.detect_table_regions(Image.new("L", (20, 20))) is expected
    assert observed == [{"table"}]


def test_hybrid_adds_only_non_overlapping_doclayout_tables(monkeypatch: pytest.MonkeyPatch):
    primary = AmericanStoriesDetection(
        total_detections=4,
        filtered_by_class=2,
        filtered_by_area=0,
        filtered_by_aspect=0,
        regions=[(0, 0, 100, 100)],
    )
    tables = DocLayoutDetection(
        total_detections=8,
        filtered_by_class=6,
        filtered_by_area=0,
        filtered_by_aspect=0,
        regions=[(5, 5, 95, 95), (200, 200, 400, 500)],
    )
    monkeypatch.setattr(hybrid_provider, "detect_american_stories_regions", lambda image: primary)
    monkeypatch.setattr(hybrid_provider, "detect_table_regions", lambda image: tables)
    diag = PageDiagnostics()

    regions = hybrid_provider.detect_image_regions(Image.new("L", (1000, 1000)), diag=diag)

    assert regions == [(0, 0, 100, 100), (200, 200, 400, 500)]
    assert diag.cv_info.detector == "hybrid"
    assert diag.cv_info.american_stories_regions == 1
    assert diag.cv_info.doclayout_table_regions == 1
    assert diag.cv_info.doclayout_table_boxes == [(200, 200, 400, 500)]


def test_letterbox_preserves_ratio_and_centers_padding():
    image = np.zeros((100, 200, 3), dtype=np.uint8)
    padded, ratio, padding = american_stories_provider._letterbox(image, 1280)

    assert padded.shape == (1280, 1280, 3)
    assert ratio == 6.4
    assert padding == (0.0, 320.0)


def test_yolov8_decode_is_class_agnostic_nms():
    output = np.zeros((1, 14, 3), dtype=np.float32)
    output[0, :4, 0] = [100, 100, 80, 80]
    output[0, 4 + 2, 0] = 0.9
    output[0, :4, 1] = [102, 102, 80, 80]
    output[0, 4 + 8, 1] = 0.8
    output[0, :4, 2] = [300, 300, 40, 40]
    output[0, 4 + 0, 2] = 0.7

    decoded = american_stories_provider._decode_predictions(output, 0.1, 0.1)

    assert [item[2] for item in decoded] == [2, 0]
    assert [item[1] for item in decoded] == pytest.approx([0.9, 0.7])


def test_american_stories_maps_model_box_back_to_page(monkeypatch: pytest.MonkeyPatch):
    output = np.zeros((1, 14, 1), dtype=np.float32)
    # Original page is 1000x2000. At r=.64 with x-padding 320 this maps
    # back to x=100..900, y=200..600.
    output[0, :4, 0] = [640, 256, 512, 256]
    output[0, 4 + 2, 0] = 0.9

    class FakeSession:
        def get_inputs(self):
            return [SimpleNamespace(name="images")]

        def run(self, outputs, inputs):
            assert inputs["images"].shape == (1, 3, 1280, 1280)
            return [output]

    monkeypatch.setattr(
        american_stories_provider,
        "_get_american_stories_session",
        lambda: FakeSession(),
    )

    detection = american_stories_provider.detect_american_stories_regions(
        Image.new("L", (1000, 2000), 255)
    )

    assert detection.regions == [(200, 100, 600, 900)]
