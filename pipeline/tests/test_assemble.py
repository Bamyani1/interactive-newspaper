"""
Tests for assemble.py - Article assembly and merging logic.

These tests verify the assembly functions work correctly
without requiring any API calls or credentials.
"""
import pytest
import sys
from pathlib import Path

# Import functions from assemble.py
from assemble import (
    slugify,
    generate_article_id,
    normalize_category,
    is_lead_story,
    should_feature,
)


class TestSlugify:
    """Tests for URL slug generation."""

    def test_basic_headline(self):
        result = slugify("OWU beauties to grace calendars")
        assert result == "owu-beauties-to-grace-calendars"

    def test_removes_special_characters(self):
        result = slugify("What's next? A new era!")
        assert "'" not in result
        assert "?" not in result
        assert "!" not in result

    def test_handles_multiple_spaces(self):
        result = slugify("Multiple   spaces   here")
        assert "--" not in result
        assert "multiple-spaces-here" == result

    def test_truncates_long_headlines(self):
        """Slugify truncates to 50 chars internally."""
        long_headline = "A" * 100
        result = slugify(long_headline)
        assert len(result) <= 50

    def test_handles_empty_string(self):
        result = slugify("")
        assert result == ""

    def test_handles_unicode(self):
        result = slugify("Café résumé naïve")
        # Should handle or strip accented characters
        assert isinstance(result, str)


class TestGenerateArticleId:
    """Tests for article ID generation."""

    def test_includes_edition_date(self):
        result = generate_article_id("1986-10-17", "Test Headline", 1, 0)
        assert "1986-10-17" in result

    def test_includes_page_number(self):
        result = generate_article_id("1986-10-17", "Test Headline", 3, 0)
        assert "-p3-" in result

    def test_includes_slugified_headline(self):
        result = generate_article_id("1986-10-17", "OWU Beauties", 1, 0)
        assert "owu-beauties" in result

    def test_handles_empty_headline(self):
        result = generate_article_id("1986-10-17", "", 1, 5)
        # Should use fallback with index
        assert "article-5" in result


class TestNormalizeCategory:
    """Tests for category normalization."""

    def test_news_category(self):
        assert normalize_category("News") == "News"

    def test_direct_valid_categories(self):
        valid = ["News", "Sports", "Features", "Opinion", "Arts", "Campus Life", "Ads"]
        for cat in valid:
            assert normalize_category(cat) == cat

    def test_editorial_maps_to_opinion(self):
        assert normalize_category("Editorial") == "Opinion"

    def test_letters_maps_to_opinion(self):
        assert normalize_category("Letters") == "Opinion"

    def test_entertainment_maps_to_arts(self):
        assert normalize_category("Entertainment") == "Arts"

    def test_culture_maps_to_arts(self):
        assert normalize_category("Culture") == "Arts"

    def test_campus_maps_to_campus_life(self):
        assert normalize_category("Campus") == "Campus Life"

    def test_lifestyle_maps_to_features(self):
        assert normalize_category("Lifestyle") == "Features"

    def test_advertisement_maps_to_ads(self):
        assert normalize_category("Advertisement") == "Ads"

    def test_unknown_falls_back_to_news(self):
        result = normalize_category("unknown_category")
        assert result == "News"


class TestIsLeadStory:
    """Tests for lead story detection heuristics."""

    def test_ads_are_never_lead(self):
        article = {
            "category": "Ads",
            "fullText": "x" * 2000,
        }
        page_articles = [article]
        assert is_lead_story(article, page_articles) is False

    def test_longest_article_is_lead(self):
        long_article = {
            "category": "News",
            "fullText": "x" * 1500,  # Must be > MIN_LEAD_STORY_LENGTH (1000)
        }
        short_article = {
            "category": "News",
            "fullText": "Short text",
        }
        page_articles = [long_article, short_article]
        assert is_lead_story(long_article, page_articles) is True
        assert is_lead_story(short_article, page_articles) is False

    def test_short_articles_not_lead(self):
        article = {
            "category": "News",
            "fullText": "Short",
        }
        page_articles = [article]
        assert is_lead_story(article, page_articles) is False


class TestShouldFeature:
    """Tests for featured article criteria."""

    def test_ads_are_never_featured(self):
        article = {
            "category": "Ads",
            "fullText": "x" * 1500,
            "relatedImages": ["image.jpg"],
        }
        assert should_feature(article) is False

    def test_article_with_image_and_length_is_featured(self):
        article = {
            "category": "Features",
            "fullText": "x" * 800,  # Must be > MIN_FEATURED_LENGTH
            "relatedImages": ["image.jpg"],
        }
        assert should_feature(article) is True

    def test_article_without_image_not_featured(self):
        article = {
            "category": "Features",
            "fullText": "x" * 800,
            "relatedImages": [],
        }
        assert should_feature(article) is False

    def test_short_article_not_featured(self):
        article = {
            "category": "Features",
            "fullText": "Short",
            "relatedImages": ["image.jpg"],
        }
        assert should_feature(article) is False
