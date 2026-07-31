"""Private review evidence must survive without changing the public schema."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.application.content_rescue import _apply_review, _build_candidates
from transcript_ocr.application.edition_pipeline import (
    _build_review_hints,
    _unmerged_edition,
)
from transcript_ocr.contracts.content_models import (
    ARTICLE_CATEGORIES,
    Article,
    ContentReviewDecision,
    ContentReviewResponse,
    OtherContent,
    PageContent,
)


def test_category_fallback_is_private_and_reaches_final_review() -> None:
    article = Article(headline="Wire item", body="Historical text", category="unsupported")
    page = PageContent(articles=[article], page_number="4")
    edition = _unmerged_edition([("0004_Page 4.jpg", page)])

    assert article.category == "News"
    assert article._category_fallback_used
    assert set(Article.model_json_schema()["properties"]["category"]["enum"]) == set(
        ARTICLE_CATEGORIES
    )
    assert "category_fallback_used" not in article.model_dump()

    hints = _build_review_hints(edition)
    payload = edition.model_dump()
    candidates, _item_map = _build_candidates(payload, hints)
    assert candidates[0]["item_id"] == "article-0"
    assert candidates[0]["reasons"] == ["category_fallback"]


def test_unresolved_visual_hint_is_not_written_but_is_reviewed() -> None:
    item = OtherContent(title="", body="images/example.jpg")
    item._review_unresolved = True
    item._source_pages_internal = ["2"]
    page = PageContent(articles=[], other_content=[item], page_number="2")
    edition = _unmerged_edition([("0002_Page 2.jpg", page)])

    hints = _build_review_hints(edition)
    payload = edition.model_dump()
    assert "classification_state" not in payload["other_content"][0]

    candidates, _item_map = _build_candidates(payload, hints)
    assert candidates[0]["item_id"] == "other-0"
    assert candidates[0]["reasons"] == ["explicit_unresolved_state"]


def test_promotion_to_article_requires_and_preserves_source_pages() -> None:
    base = {
        "articles": [],
        "ads": [],
        "other_content": [{"title": "Caption", "body": "Printed source text"}],
    }
    response = ContentReviewResponse(
        decisions=[
            ContentReviewDecision(
                item_id="other-0",
                target_type="article",
                category="News",
                confidence=0.95,
            )
        ]
    )

    without_pages = {key: list(value) for key, value in base.items()}
    changed, _ = _apply_review(without_pages, {"other-0": ("other", 0)}, response)
    assert changed == 0
    assert without_pages["articles"] == []

    with_pages = {key: list(value) for key, value in base.items()}
    changed, _ = _apply_review(
        with_pages,
        {"other-0": ("other", 0)},
        response,
        {"other-0": {"source_pages": ["2"]}},
    )
    assert changed == 1
    assert with_pages["articles"][0]["source_pages"] == ["2"]
