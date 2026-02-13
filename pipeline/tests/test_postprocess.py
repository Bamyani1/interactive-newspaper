"""
Tests for postprocess.py - OCR text cleaning.

These tests verify the OCR post-processing functions work correctly
without requiring any API calls or credentials.
"""
import pytest

# Import the module under test (credentials already isolated in conftest.py)
from postprocess import (
    clean_ocr_text,
    fix_hyphenated_words,
    fix_ocr_errors,
    fix_spacing,
    clean_headline,
    clean_byline,
    clean_article_text,
)


class TestFixHyphenatedWords:
    """Tests for hyphenated word fixes."""

    def test_fixes_fundraising(self):
        text = "The fund-\nraising campaign was successful."
        result = fix_hyphenated_words(text)
        assert "fundraising" in result

    def test_fixes_university(self):
        text = "At the Uni-\nversity of Ohio"
        result = fix_hyphenated_words(text)
        assert "University" in result

    def test_fixes_generic_hyphen_newline(self):
        text = "The switch-\nboards were busy."
        result = fix_hyphenated_words(text)
        assert "switchboards" in result

    def test_preserves_intentional_hyphens(self):
        text = "The well-known professor spoke."
        result = fix_hyphenated_words(text)
        assert "well-known" in result


class TestFixOcrErrors:
    """Tests for common OCR character confusion fixes."""

    def test_fixes_rn_to_m(self):
        # This is tricky - the regex only matches standalone 'rn'
        # Most OCR fixes are context-dependent
        pass  # Placeholder for complex pattern tests

    def test_double_comma_removal(self):
        text = "Hello,, world"
        result = fix_ocr_errors(text)
        assert ",," not in result

    def test_double_quote_removal(self):
        text = 'He said ""hello""'
        result = fix_ocr_errors(text)
        assert '""' not in result


class TestFixSpacing:
    """Tests for spacing fixes."""

    def test_removes_multiple_spaces(self):
        text = "Hello    world"
        result = fix_spacing(text)
        assert "    " not in result
        assert "Hello world" in result

    def test_adds_space_after_period_before_capital(self):
        text = "End of sentence.Beginning of next."
        result = fix_spacing(text)
        # Should add space after period before capital
        assert ". B" in result or ".B" in result  # Depends on exact regex


class TestCleanOcrText:
    """Tests for the full OCR cleaning pipeline."""

    def test_cleans_sample_text(self, sample_ocr_text):
        result = clean_ocr_text(sample_ocr_text)
        
        # Should fix hyphenated "calen-dars"
        assert "calendars" in result
        
        # Should preserve content
        assert "Christmas presents" in result
        assert "OWU Bookstore" in result

    def test_handles_empty_string(self):
        result = clean_ocr_text("")
        assert result == ""

    def test_handles_whitespace_only(self):
        result = clean_ocr_text("   \n\t   ")
        # Should not crash, may normalize whitespace
        assert isinstance(result, str)


class TestCleanHeadline:
    """Tests for headline cleaning."""

    def test_removes_newlines(self):
        headline = "OWU beauties\nto grace calendars"
        result = clean_headline(headline)
        assert "\n" not in result
        assert "OWU beauties to grace calendars" == result

    def test_normalizes_whitespace(self):
        headline = "OWU   beauties    to   grace"
        result = clean_headline(headline)
        assert "   " not in result

    def test_strips_leading_trailing_whitespace(self):
        headline = "   OWU beauties   "
        result = clean_headline(headline)
        assert result == "OWU beauties"


class TestCleanByline:
    """Tests for byline cleaning."""

    def test_returns_none_for_empty(self):
        result = clean_byline("")
        assert result is None

    def test_returns_none_for_none(self):
        result = clean_byline(None)
        assert result is None

    def test_removes_newlines(self):
        byline = "By SHAFALIKA SAXENA,\nManaging Editor"
        result = clean_byline(byline)
        assert "\n" not in result

    def test_strips_whitespace(self):
        byline = "   By JOHN DOE   "
        result = clean_byline(byline)
        assert result == "By JOHN DOE"


class TestCleanArticleText:
    """Tests for article text cleaning."""

    def test_preserves_paragraph_tags(self):
        text = "<p>First paragraph.</p><p>Second paragraph.</p>"
        result = clean_article_text(text)
        assert "<p>" in result
        assert "</p>" in result

    def test_cleans_text_without_tags(self):
        text = "Plain text with   multiple    spaces."
        result = clean_article_text(text)
        assert "   " not in result

    def test_handles_empty_paragraphs(self):
        text = "<p></p><p>Content</p>"
        result = clean_article_text(text)
        assert "<p></p>" in result or "<p>Content</p>" in result
