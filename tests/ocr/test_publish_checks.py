"""Checks an edition must pass before process-edition.sh promotes it."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.export.publish_checks import publish_check_failures  # noqa: E402

IMAGE = "images/abc.webp"


def _edition(
    tmp_path: Path,
    *,
    articles=None,
    ads=None,
    pages=None,
    cost: float | None = 0.4,
    assets=(IMAGE,),
) -> Path:
    edition = tmp_path / "1983-09-22"
    edition.mkdir(parents=True)
    payload = {
        "edition_date": "1983-09-22",
        "articles": articles
        if articles is not None
        else [
            {
                "headline": "Council meets",
                "body": "The council met.",
                "image_files": [IMAGE],
            },
            {"headline": "Game won", "body": "The team won.", "image_files": []},
        ],
        "ads": ads or [],
        "other_content": [],
    }
    (edition / "edition.json").write_text(json.dumps(payload))
    provenance = {
        "pages": pages
        or [
            {"canvas": 1, "state": "passed_content"},
            {"canvas": 2, "state": "confirmed_blank"},
        ]
    }
    if cost is not None:
        provenance["estimated_cost_usd"] = cost
    (edition / "provenance.json").write_text(json.dumps(provenance))
    (edition / "asset-manifest.json").write_text(
        json.dumps({"assets": [{"public_path": p} for p in assets]})
    )
    return edition


def test_a_clean_edition_passes_both_stages(tmp_path):
    edition = _edition(tmp_path)
    assert publish_check_failures(edition, stage="candidate", max_cost_usd=1.5) == []
    assert publish_check_failures(edition, stage="post-upload", max_cost_usd=1.5) == []


def test_every_page_must_be_read(tmp_path):
    edition = _edition(
        tmp_path,
        pages=[
            {"canvas": 1, "state": "passed_content"},
            {"canvas": 2, "state": "failed"},
        ],
    )
    assert publish_check_failures(edition, stage="candidate", max_cost_usd=1.5) == [
        "page 2 was not read (failed)"
    ]


def test_an_edition_with_no_pages_fails(tmp_path):
    edition = _edition(tmp_path)
    (edition / "provenance.json").write_text(
        json.dumps({"pages": [], "estimated_cost_usd": 0.1})
    )
    assert publish_check_failures(edition, stage="candidate", max_cost_usd=1.5) == [
        "provenance lists no pages"
    ]


def test_cost_must_be_recorded_and_under_the_cap(tmp_path):
    assert publish_check_failures(
        _edition(tmp_path / "a", cost=None), stage="candidate", max_cost_usd=1.5
    ) == ["no estimated cost recorded"]
    assert publish_check_failures(
        _edition(tmp_path / "b", cost=2.0), stage="candidate", max_cost_usd=1.5
    ) == ["cost $2.0000 is over the $1.50 cap"]


def test_an_article_with_no_body_and_no_image_is_empty(tmp_path):
    edition = _edition(
        tmp_path,
        articles=[{"headline": "Lonely headline", "body": "  ", "image_files": []}],
    )
    assert publish_check_failures(edition, stage="candidate", max_cost_usd=1.5) == [
        "article 1 is empty: 'Lonely headline'"
    ]


def test_two_articles_with_the_same_headline_and_body_are_duplicates(tmp_path):
    article = {"headline": "Game won", "body": "The team  won.", "image_files": []}
    edition = _edition(
        tmp_path, articles=[article, {**article, "body": "the team won."}]
    )
    assert publish_check_failures(edition, stage="candidate", max_cost_usd=1.5) == [
        "article 2 duplicates article 1: 'Game won'"
    ]


def test_after_upload_every_image_is_in_the_asset_manifest(tmp_path):
    edition = _edition(
        tmp_path,
        ads=[
            {"business_name": "Shop", "body": "Sale", "image_files": ["images/ad.webp"]}
        ],
    )
    assert publish_check_failures(edition, stage="candidate", max_cost_usd=1.5) == []
    assert publish_check_failures(edition, stage="post-upload", max_cost_usd=1.5) == [
        "image images/ad.webp is not in asset-manifest.json"
    ]


def test_cli_exits_1_and_names_each_failure(tmp_path, monkeypatch, capsys):
    from transcript_ocr.cli.check_publishable import main

    edition = _edition(tmp_path, cost=0.9)
    monkeypatch.setenv("OCR_MAX_EDITION_USD", "0.5")
    assert main([str(edition), "--stage", "candidate"]) == 1
    assert (
        "UNPUBLISHABLE: cost $0.9000 is over the $0.50 cap" in capsys.readouterr().out
    )
    monkeypatch.delenv("OCR_MAX_EDITION_USD")
    assert main([str(edition), "--stage", "candidate"]) == 0
