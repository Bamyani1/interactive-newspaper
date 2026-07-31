"""Manifest-driven page inventory tests."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.ingestion.manifest import discover_page_inventory


def _manifest(page_count: int) -> dict:
    return {
        "sequences": [
            {
                "canvases": [
                    {
                        "@id": f"canvas-{index}",
                        "label": f"Page {index}",
                        "width": 100,
                        "height": 200,
                        "images": [
                            {
                                "resource": {
                                    "service": {"@id": f"https://example/{index}"}
                                }
                            }
                        ],
                    }
                    for index in range(1, page_count + 1)
                ]
            }
        ]
    }


def _page(path: Path) -> None:
    Image.new("L", (10, 20), 255).save(path)


def test_manifest_canvases_define_expected_denominator(tmp_path):
    (tmp_path / "manifest.json").write_text(json.dumps(_manifest(3)))
    _page(tmp_path / "0001_Page 1.jpg")
    _page(tmp_path / "0003_Page 3.png")

    inventory = discover_page_inventory(tmp_path)

    assert inventory.authoritative
    assert inventory.expected_pages == 3
    assert inventory.found_pages == 2
    assert inventory.missing_page_indexes == (2,)
    assert [Path(path).name for path in inventory.local_paths] == [
        "0001_Page 1.jpg",
        "0003_Page 3.png",
    ]
    assert inventory.pages[0].image_service_id == "https://example/1"


def test_duplicate_local_images_for_canvas_are_rejected(tmp_path):
    (tmp_path / "manifest.json").write_text(json.dumps(_manifest(1)))
    _page(tmp_path / "0001_Page 1.jpg")
    _page(tmp_path / "0001_Page 1.png")

    with pytest.raises(ValueError, match="multiple local images"):
        discover_page_inventory(tmp_path)


def test_manifest_rejects_unmapped_extra_page(tmp_path):
    (tmp_path / "manifest.json").write_text(json.dumps(_manifest(1)))
    _page(tmp_path / "0001_Page 1.jpg")
    _page(tmp_path / "0002_Page 2.jpg")

    with pytest.raises(ValueError, match="do not map"):
        discover_page_inventory(tmp_path)


def test_multiframe_tiff_outputs_map_to_consecutive_canvases(tmp_path):
    (tmp_path / "manifest.json").write_text(json.dumps(_manifest(3)))
    _page(tmp_path / "0001_Page 1_frame_0001.png")
    _page(tmp_path / "0001_Page 1_frame_0002.png")
    _page(tmp_path / "0001_Page 1_frame_0003.png")

    inventory = discover_page_inventory(tmp_path)

    assert [Path(page.local_path or "").name for page in inventory.pages] == [
        "0001_Page 1_frame_0001.png",
        "0001_Page 1_frame_0002.png",
        "0001_Page 1_frame_0003.png",
    ]


def test_legacy_inventory_naturally_sorts_without_manifest(tmp_path):
    _page(tmp_path / "Page 10.jpg")
    _page(tmp_path / "Page 2.jpg")

    inventory = discover_page_inventory(tmp_path)

    assert not inventory.authoritative
    assert inventory.expected_pages == 2
    assert [Path(path).name for path in inventory.local_paths] == [
        "Page 2.jpg",
        "Page 10.jpg",
    ]
