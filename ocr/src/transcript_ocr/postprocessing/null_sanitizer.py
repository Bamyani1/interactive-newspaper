"""Sanitize literal "null" strings from Gemini structured output."""

from __future__ import annotations

from ..contracts.content_models import PageContent

_NULL_STRINGS = {"null", "none", "n/a", "undefined", "nil"}

_ARTICLE_STRING_FIELDS = ("author", "writer_position", "continues_on", "continued_from", "category")
_AD_STRING_FIELDS = ("business_name",)


def _sanitize_null_strings(page_content: PageContent) -> PageContent:
    """Replace literal 'null'/'None'/'N/A' strings with empty strings on optional fields.

    Runs after Gemini parse, before deduplication. Mutates in place and returns
    the same object for convenience.
    """
    for article in page_content.articles:
        for field in _ARTICLE_STRING_FIELDS:
            value = getattr(article, field, "")
            if isinstance(value, str) and value.strip().lower() in _NULL_STRINGS:
                setattr(article, field, "")

    for ad in page_content.ads:
        for field in _AD_STRING_FIELDS:
            value = getattr(ad, field, "")
            if isinstance(value, str) and value.strip().lower() in _NULL_STRINGS:
                setattr(ad, field, "")

    return page_content


__all__ = ["_sanitize_null_strings"]
