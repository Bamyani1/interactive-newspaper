"""Unit tests for merge helper logic in modular OCR package."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.contracts.content_models import ArticleImage, MergeDecisions
from transcript_ocr.merging.llm_merge import _build_deterministic_decisions
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


# --- _build_deterministic_decisions tests ---

def _make_article(headline="Headline", author="", writer_position="", page="1"):
    return {
        "headline": headline,
        "author": author,
        "writer_position": writer_position,
        "page_label": page,
        "body": "Body text",
        "images": [],
        "image_files": [],
        "continuation": {},
    }


def test_deterministic_decisions_pre_merged_groups():
    """Pre-merged groups produce multi-article MergeInstructions."""
    articles = [
        _make_article("Short", author="Alice", page="1"),
        _make_article("A Much Longer Headline For The Story", author="Bob", page="14"),
        _make_article("Standalone Article", author="Carol", page="3"),
    ]
    pre_merged = [[0, 1]]
    result = _build_deterministic_decisions(articles, pre_merged)

    assert isinstance(result, MergeDecisions)
    assert len(result.groups) == 2  # 1 merged group + 1 singleton

    merged_group = next(g for g in result.groups if len(g.article_ids) > 1)
    assert set(merged_group.article_ids) == {0, 1}
    # Picks longest headline (>20 chars)
    assert merged_group.merged_headline == "A Much Longer Headline For The Story"
    # First non-empty author
    assert merged_group.merged_author == "Alice"
    assert merged_group.confidence == 1.0

    singleton = next(g for g in result.groups if len(g.article_ids) == 1)
    assert singleton.article_ids == [2]
    assert singleton.merged_headline == "Standalone Article"


def test_deterministic_decisions_empty_premerge_all_singletons():
    """No pre-merged groups → every article is a singleton."""
    articles = [_make_article(f"Article {i}") for i in range(3)]
    result = _build_deterministic_decisions(articles, [])

    assert len(result.groups) == 3
    for i, group in enumerate(result.groups):
        assert group.article_ids == [i]
        assert group.confidence == 1.0


def test_deterministic_decisions_picks_longest_non_stub_headline():
    """Short stub headlines (<= 20 chars) are skipped in favor of longer ones."""
    articles = [
        _make_article("Stub", page="1"),
        _make_article("The Full Story About Something Important", page="14"),
    ]
    result = _build_deterministic_decisions(articles, [[0, 1]])

    merged_group = result.groups[0]
    assert merged_group.merged_headline == "The Full Story About Something Important"


def test_deterministic_decisions_falls_back_to_first_headline_if_all_short():
    """If all headlines are short, picks the first one."""
    articles = [
        _make_article("First", page="1"),
        _make_article("Second", page="2"),
    ]
    result = _build_deterministic_decisions(articles, [[0, 1]])

    assert result.groups[0].merged_headline == "First"


def test_deterministic_decisions_three_page_chain():
    """A 3-article chain merges into one group correctly."""
    articles = [
        _make_article("AFROTC Review Continues", author="Jane Doe", writer_position="Staff Writer", page="10"),
        _make_article("AFROTC Review (Continued)", page="15"),
        _make_article("AFROTC Review Concludes Here", page="22"),
    ]
    pre_merged = [[0, 1, 2]]
    result = _build_deterministic_decisions(articles, pre_merged)

    assert len(result.groups) == 1
    group = result.groups[0]
    assert set(group.article_ids) == {0, 1, 2}
    assert group.merged_author == "Jane Doe"
    assert group.merged_writer_position == "Staff Writer"
