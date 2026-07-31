"""Byline normalization helpers."""

from __future__ import annotations

import re


def _normalize_byline(author: str) -> str:
    """Normalize author field by stripping any 'By ' prefix."""
    if not author:
        return author
    stripped = author.strip()
    without_by = re.sub(r"^By\s+", "", stripped, flags=re.IGNORECASE)
    return without_by if without_by else ""


def _dedup_byline_from_body(author: str, body: str) -> str:
    """If body starts with 'By <author>', remove it to prevent duplication."""
    if not author or not body:
        return body
    # Normalize for comparison
    author_clean = re.sub(r"^By\s+", "", author, flags=re.IGNORECASE).strip().lower()
    if not author_clean:
        return body
    lines = body.split("\n", 1)
    first_line = lines[0].strip()
    first_clean = re.sub(r"^By\s+", "", first_line, flags=re.IGNORECASE).strip().lower()
    if first_clean == author_clean:
        return lines[1].lstrip("\n") if len(lines) > 1 else ""
    return body


normalize_byline = _normalize_byline
dedup_byline_from_body = _dedup_byline_from_body

__all__ = [
    "_dedup_byline_from_body",
    "_normalize_byline",
    "dedup_byline_from_body",
    "normalize_byline",
]
