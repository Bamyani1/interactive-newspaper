"""Executable checks for the public OCR image policy."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path

import pytest
from PIL import Image, features


ROOT = Path(__file__).resolve().parents[2]
UPLOADER = ROOT / "scripts" / "db" / "upload-images.mjs"
GC_SCRIPT = ROOT / "scripts" / "db" / "gc-r2-assets.mjs"
DATE = "1990-02-21"


def _edition_with_image(editions: Path, reference: str) -> Path:
    edition_dir = editions / DATE
    (edition_dir / "images").mkdir(parents=True)
    payload = {
        "edition_date": DATE,
        "publication_info": "",
        "articles": [
            {
                "headline": "Test",
                "author": "",
                "writer_position": "",
                "category": "News",
                "body": "Source text.",
                "images": [{"caption": "", "position": ""}],
                "image_files": [reference],
                "continues_on": "",
                "continued_from": "",
                "source_pages": ["1"],
            }
        ],
        "ads": [],
        "other_content": [],
    }
    (edition_dir / "edition.json").write_text(json.dumps(payload), encoding="utf-8")
    return edition_dir


def _dry_run(editions: Path) -> str:
    result = subprocess.run(
        [
            "node",
            str(UPLOADER),
            "--date",
            DATE,
            "--editions-dir",
            str(editions),
            "--dry-run",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout


def test_asset_is_never_enlarged_and_meets_public_limits(tmp_path: Path) -> None:
    editions = tmp_path / "editions"
    edition_dir = _edition_with_image(editions, "images/source.png")
    image = Image.new("RGB", (2400, 1600))
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            pixels[x, y] = ((x * 17 + y * 3) % 256, (x * 5 + y * 11) % 256, (x + y) % 256)
    image.save(edition_dir / "images" / "source.png", format="PNG")

    output = _dry_run(editions)
    match = re.search(r"\((\d+) bytes, (\d+)x(\d+)\)", output)
    assert match, output
    size, width, height = map(int, match.groups())
    assert size < 500 * 1024
    assert max(width, height) <= 2000
    assert width <= 2400 and height <= 1600


@pytest.mark.skipif(not features.check("webp"), reason="Pillow has no WebP support")
def test_content_addressed_webp_is_not_lossily_reencoded(tmp_path: Path) -> None:
    editions = tmp_path / "editions"
    edition_dir = _edition_with_image(editions, "images/pending.webp")
    pending = edition_dir / "images" / "pending.webp"
    Image.new("RGB", (500, 300), (24, 90, 140)).save(
        pending, format="WEBP", quality=85
    )
    digest = hashlib.sha256(pending.read_bytes()).hexdigest()
    source = pending.with_name(f"{digest}.webp")
    pending.rename(source)
    payload_path = edition_dir / "edition.json"
    payload = json.loads(payload_path.read_text(encoding="utf-8"))
    payload["articles"][0]["image_files"] = [f"images/{digest}.webp"]
    payload_path.write_text(json.dumps(payload), encoding="utf-8")

    output = _dry_run(editions)
    assert f"-> images/{digest}.webp" in output


def test_r2_gc_uses_unreferenced_since_not_object_age() -> None:
    source = GC_SCRIPT.read_text(encoding="utf-8")
    assert 'gcStateKey = "ocr-assets-gc/unreferenced.json"' in source
    assert "unreferenced_since" in source
    assert "unreferencedSince <= cutoff" in source
    assert "object.LastModified" not in source


def test_r2_gc_is_fail_closed_key_scoped_and_publication_locked() -> None:
    source = GC_SCRIPT.read_text(encoding="utf-8")
    publisher = (ROOT / "scripts" / "ocr" / "process-edition.sh").read_text(
        encoding="utf-8"
    )

    assert "has no asset manifest" in source
    assert "no public edition manifests were found" in source
    assert source.count(r"^ocr-assets\/[a-f0-9]{64}\.webp$") >= 2
    assert 'join(assetLockParent, "assets.lock")' in source
    assert 'ASSET_LOCK_DIR="$LOCK_PARENT/assets.lock"' in publisher
    acquisitions = [match.start() for match in re.finditer(r"^\s*acquire_asset_lock$", publisher, re.MULTILINE)]
    promotions = [
        match.start()
        for match in re.finditer(
            r'^\s*promote_candidate \|\| fail 40 "promotion"',
            publisher,
            re.MULTILINE,
        )
    ]
    assert len(acquisitions) == len(promotions) == 2
    assert acquisitions[0] < promotions[0] < acquisitions[1] < promotions[1]
