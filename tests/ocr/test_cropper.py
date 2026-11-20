"""Published crops keep a small margin; only the model's evidence crops get 10%."""

from __future__ import annotations

import inspect
import sys
from pathlib import Path

from PIL import Image

OCR_SRC = Path(__file__).resolve().parents[2] / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.application import page_pipeline  # noqa: E402
from transcript_ocr.image_linking.cropper import crop_and_save_images, crop_regions  # noqa: E402

# (y_min, x_min, y_max, x_max): a 200 x 100 box well inside the page.
REGION = (200, 300, 300, 500)


def _page() -> Image.Image:
    return Image.new("RGB", (1000, 1000), "white")


def test_published_crop_uses_two_percent_margin(tmp_path: Path) -> None:
    saved = crop_and_save_images(_page(), [REGION], str(tmp_path), "Page 01")

    with Image.open(tmp_path / saved[0]) as crop:
        assert crop.size == (208, 104)


def test_evidence_crop_keeps_ten_percent_margin() -> None:
    crops = crop_regions(_page(), [REGION])

    assert crops[0].size == (240, 120)


def test_page_pipeline_does_not_widen_published_crops() -> None:
    source = inspect.getsource(page_pipeline.structure_and_link_page)
    call = source[source.index("crop_and_save_images(") :]
    call = call[: call.index(")")]

    assert "padding_frac" not in call
