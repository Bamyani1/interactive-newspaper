import pytest
from PIL import Image

from transcript_ocr.detection import visual_provider


def test_hybrid_is_default(monkeypatch):
    monkeypatch.setenv("OCR_ENVIRONMENT", "development")
    monkeypatch.setattr(
        "transcript_ocr.detection.hybrid_provider.detect_image_regions",
        lambda image, diag=None: [(1, 2, 3, 4)],
    )
    assert visual_provider.detect_image_regions(Image.new("RGB", (10, 10))) == [(1, 2, 3, 4)]


def test_hosted_detector_requires_license_gate(monkeypatch):
    monkeypatch.setenv("OCR_ENVIRONMENT", "production")
    monkeypatch.delenv("OCR_DETECTOR_LICENSES_ACCEPTED", raising=False)
    with pytest.raises(RuntimeError, match="license terms"):
        visual_provider.detect_image_regions(Image.new("RGB", (10, 10)))
