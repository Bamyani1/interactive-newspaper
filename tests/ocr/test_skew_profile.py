"""Deterministic tests for the fixed skew search policy."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

import transcript_ocr.preprocessing.skew as skew


def _score_rotation(target: float, observed: list[float]):
    def fake_rotate(_binary, angle, **_kwargs):
        observed.append(angle)
        score = 100.0 - abs(angle - target)
        return np.array([[score, 0.0], [0.0, 0.0]])

    return fake_rotate


def test_searches_exactly_minus_two_to_plus_two_by_tenths(monkeypatch):
    observed: list[float] = []
    monkeypatch.setattr(skew.ndimage, "rotate", _score_rotation(0.7, observed))

    estimate = skew.estimate_skew_angle(Image.new("L", (10, 10), 255))

    assert observed == [index / 10.0 for index in range(-20, 21)]
    assert estimate.measured_angle == 0.7
    assert estimate.applied_angle == 0.7
    assert not estimate.hit_search_boundary


def test_point_one_degree_is_not_applied(monkeypatch):
    monkeypatch.setattr(skew.ndimage, "rotate", _score_rotation(0.1, []))
    estimate = skew.estimate_skew_angle(Image.new("L", (10, 10), 255))
    assert estimate.measured_angle == 0.1
    assert estimate.applied_angle == 0.0


def test_boundary_maximum_is_not_applied(monkeypatch):
    monkeypatch.setattr(skew.ndimage, "rotate", _score_rotation(-2.0, []))
    estimate = skew.estimate_skew_angle(Image.new("L", (10, 10), 255))
    assert estimate.measured_angle == -2.0
    assert estimate.applied_angle == 0.0
    assert estimate.hit_search_boundary
