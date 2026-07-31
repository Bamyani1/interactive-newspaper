"""Atomic image download helper tests."""

from __future__ import annotations

import io
import sys
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.ingestion.download import download_image_atomic


def _png_bytes(size=(12, 18)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, (10, 20, 30)).save(buffer, format="PNG")
    return buffer.getvalue()


def test_download_validates_then_atomically_commits(tmp_path):
    payload = _png_bytes()
    target = tmp_path / "page.png"

    receipt = download_image_atomic(
        "https://example/page",
        target,
        expected_dimensions=(12, 18),
        opener=lambda _url, timeout: io.BytesIO(payload),
    )

    assert target.read_bytes() == payload
    assert receipt.byte_count == len(payload)
    assert receipt.dimensions == (12, 18)
    assert receipt.mode == "RGB"
    assert len(receipt.sha256) == 64
    assert not (tmp_path / "page.png.part").exists()


def test_invalid_download_does_not_replace_existing_target(tmp_path):
    target = tmp_path / "page.png"
    original = _png_bytes((4, 4))
    target.write_bytes(original)

    with pytest.raises(Exception):
        download_image_atomic(
            "https://example/page",
            target,
            opener=lambda _url, timeout: io.BytesIO(b"not an image"),
        )

    assert target.read_bytes() == original
    assert not (tmp_path / "page.png.part").exists()


def test_checksum_mismatch_is_rejected_before_commit(tmp_path):
    target = tmp_path / "page.png"
    with pytest.raises(ValueError, match="SHA-256"):
        download_image_atomic(
            "https://example/page",
            target,
            expected_sha256="0" * 64,
            opener=lambda _url, timeout: io.BytesIO(_png_bytes()),
        )

    assert not target.exists()
    assert not (tmp_path / "page.png.part").exists()
