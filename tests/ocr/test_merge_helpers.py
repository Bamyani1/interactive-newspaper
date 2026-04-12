"""Unit tests for merge helper logic in modular OCR package."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.contracts.content_models import ArticleImage
from transcript_ocr.contracts.diagnostics_models import PipelineReport
from transcript_ocr.merging.merge_sanitizer import choose_merged_category, reconcile_image_alignment


def test_choose_merged_category_majority():
    assert choose_merged_category(["News", "News", "Sports"]) == "News"


def test_choose_merged_category_tie_uses_priority():
    assert choose_merged_category(["Campus News", "Opinion"]) == "Opinion"


def test_reconcile_image_alignment_drops_empty_files_and_collects_orphans():
    images, files, orphans = reconcile_image_alignment(
        [ArticleImage(caption="caption A"), ArticleImage(caption="caption orphan")],
        ["images/a.jpg", ""],
    )
    assert files == ["images/a.jpg"]
    assert [img.caption for img in images] == ["caption A"]
    assert orphans == ["caption orphan"]


def test_reconcile_image_alignment_creates_placeholder_for_file_only():
    images, files, orphans = reconcile_image_alignment([], ["images/a.jpg"])
    assert files == ["images/a.jpg"]
    assert len(images) == 1
    assert images[0].caption == ""
    assert orphans == []


def test_merge_sets_diagnostics_on_empty_input():
    """When no articles exist, merge returns None but still populates report.merge_pass."""
    report = PipelineReport()
    from transcript_ocr.merging.llm_merge import merge_edition_articles

    result = merge_edition_articles(client=None, page_results=[], report=report)
    assert result is None
    assert report.merge_pass is not None
    assert report.merge_pass.error == ""
    assert report.merge_pass.time_seconds >= 0
