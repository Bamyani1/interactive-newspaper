"""Tests for page-level article body normalization."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.contracts.content_models import Article, PageContent  # noqa: E402
from transcript_ocr.postprocessing.page_normalization import (  # noqa: E402
    postprocess_page_content,
)


def _body_after(body: str, author: str = "") -> str:
    article = Article(
        headline="Ohio Prospects Up",
        author=author,
        category="Campus News",
        continues_on="",
        continued_from="",
        body=body,
    )
    page = postprocess_page_content(PageContent(articles=[article]))
    return page.articles[0].body


def test_single_newline_between_paragraphs_becomes_a_blank_line():
    body = (
        'Edel said the rate rose.\nBut some Eastern states fell.\n"It helps," he said.'
    )

    assert _body_after(body) == (
        'Edel said the rate rose.\n\nBut some Eastern states fell.\n\n"It helps," he said.'
    )


def test_line_wrap_inside_a_sentence_becomes_a_space():
    assert _body_after("Goaltender Mike Kirn\nturned aside 42 shots.") == (
        "Goaltender Mike Kirn turned aside 42 shots."
    )


def test_blank_line_wraps_inside_a_sentence_are_rejoined():
    body = "it could not fit in the\n\nexhibit. He was surprised it was ac-\n\ncepted."

    assert _body_after(body) == (
        "it could not fit in the exhibit. He was surprised it was ac-\ncepted."
    )


def test_hyphen_line_break_and_existing_blank_lines_are_kept():
    body = "the admis-\nsions office.\n\nA second paragraph."

    assert _body_after(body) == body


def test_byline_is_still_removed_before_normalizing():
    assert _body_after("By Jane Doe\nThe play opens tonight.", author="Jane Doe") == (
        "The play opens tonight."
    )
