"""Unit tests for null string sanitization."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.contracts.content_models import Ad, Article, PageContent
from transcript_ocr.postprocessing.null_sanitizer import _sanitize_null_strings


def _make_page(articles=None, ads=None):
    return PageContent(
        articles=articles or [],
        ads=ads or [],
        other_content=[],
        page_number="1",
    )


def test_sanitizes_null_string_on_author():
    page = _make_page(articles=[
        Article(headline="Test", body="body", author="null"),
    ])
    result = _sanitize_null_strings(page)
    assert result.articles[0].author == ""


def test_sanitizes_none_string_on_writer_position():
    page = _make_page(articles=[
        Article(headline="Test", body="body", writer_position="None"),
    ])
    result = _sanitize_null_strings(page)
    assert result.articles[0].writer_position == ""


def test_sanitizes_na_string_on_continues_on():
    page = _make_page(articles=[
        Article(headline="Test", body="body", continues_on="N/A"),
    ])
    result = _sanitize_null_strings(page)
    assert result.articles[0].continues_on == ""


def test_sanitizes_undefined_string():
    page = _make_page(articles=[
        Article(headline="Test", body="body", author="undefined"),
    ])
    result = _sanitize_null_strings(page)
    assert result.articles[0].author == ""


def test_sanitizes_nil_string():
    page = _make_page(articles=[
        Article(headline="Test", body="body", continued_from="nil"),
    ])
    result = _sanitize_null_strings(page)
    assert result.articles[0].continued_from == ""


def test_preserves_real_values():
    page = _make_page(articles=[
        Article(
            headline="Test",
            body="body",
            author="By John Smith",
            writer_position="Staff Writer",
            continues_on="5",
            continued_from="1",
        ),
    ])
    result = _sanitize_null_strings(page)
    assert result.articles[0].author == "By John Smith"
    assert result.articles[0].writer_position == "Staff Writer"
    assert result.articles[0].continues_on == "5"
    assert result.articles[0].continued_from == "1"


def test_sanitizes_case_insensitive():
    page = _make_page(articles=[
        Article(headline="Test", body="body", author="NULL", writer_position="Null"),
    ])
    result = _sanitize_null_strings(page)
    assert result.articles[0].author == ""
    assert result.articles[0].writer_position == ""


def test_sanitizes_with_whitespace():
    page = _make_page(articles=[
        Article(headline="Test", body="body", author=" null "),
    ])
    result = _sanitize_null_strings(page)
    assert result.articles[0].author == ""


def test_sanitizes_ad_fields():
    page = _make_page(ads=[
        Ad(business_name="null", body="ad text"),
    ])
    result = _sanitize_null_strings(page)
    assert result.ads[0].business_name == ""


def test_multiple_articles():
    page = _make_page(articles=[
        Article(headline="A", body="body a", author="null", writer_position="Editor"),
        Article(headline="B", body="body b", author="Jane", writer_position="None"),
    ])
    result = _sanitize_null_strings(page)
    assert result.articles[0].author == ""
    assert result.articles[0].writer_position == "Editor"
    assert result.articles[1].author == "Jane"
    assert result.articles[1].writer_position == ""
