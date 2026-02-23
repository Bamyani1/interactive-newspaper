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


_POSITION_RE = re.compile(
    r"\b((?:[\w-]+\s+)?(?:Editor(?:\s+in\s+Chief)?|Staff\s+Writer|Reporter|"
    r"Columnist|Reviewer|Contributing\s+Writer|Associate\s+Editor|"
    r"Managing\s+Editor|(?:News|Features?|Arts?|Sports?|Photo(?:graphy)?)\s+Editor|"
    r"Business\s+Manager|Transcript\s+\w[\w\s]*))\s*$",
    re.IGNORECASE,
)


def _split_author_position(author: str) -> tuple[str, str]:
    """Split 'Jay Wuebbold Sports Editor' → ('Jay Wuebbold', 'Sports Editor')."""
    if not author:
        return author, ""
    match = _POSITION_RE.search(author)
    if match:
        position = match.group(1).strip()
        name = author[: match.start()].strip().rstrip(",").strip()
        if name:
            return name, position
    return author, ""


_BYLINE_RE = re.compile(
    r"^(?:By\s+)(.+?)(?:\s*/\s*|\s*,\s*)?((?:Transcript|Staff|Editor|Reporter|Columnist|Reviewer|Guest|Contributing)[\w\s]*)?$",
    re.IGNORECASE | re.MULTILINE,
)


def _extract_byline_from_body(headline: str, author: str, body: str) -> tuple[str, str]:
    """If author is empty, try to extract byline from first lines of body."""
    del headline
    if author:
        return author, body
    lines = body.split("\n")
    for i, line in enumerate(lines[:3]):
        match = _BYLINE_RE.match(line.strip())
        if match:
            author = _normalize_byline(line.strip())
            lines.pop(i)
            body = "\n".join(lines).strip()
            break
    return author, body


normalize_byline = _normalize_byline
split_author_position = _split_author_position
extract_byline_from_body = _extract_byline_from_body

__all__ = [
    "_extract_byline_from_body",
    "_normalize_byline",
    "_split_author_position",
    "extract_byline_from_body",
    "normalize_byline",
    "split_author_position",
]
