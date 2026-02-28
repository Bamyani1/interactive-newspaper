"""Continuation/overflow parsing helpers."""

from __future__ import annotations

import re

_CONTINUATION_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"\(continued (?:on|from) page \w[\w-]*\)",
        r"\bsee \w[\w\s]{0,40}, page \w[\w-]*\b",
        r"\bsee \w[\w\s]{0,40} on page \w[\w-]*\b",
        r"\b(?:please )?turn to page \w[\w-]*\b",
        r"\bcontinued on next page\b",
        r"\bcontinued from (?:previous|preceding) page\b",
        r"\bcontinued (?:on|from) (?:page )?\w[\w-]*\b",
        r"\bcon't\.?\s+on\s+(?:p(?:age)?\.?\s+)?\w[\w-]*\b",
        r"\bcon't\.?\s+from\s+(?:p(?:age)?\.?\s+)?\w[\w-]*\b",
        r"[\(-]\s*p\.?\s*\d+\s*\)?\s*$",
        r"\bsee page \w[\w-]*\b",
        # OCR-fuzzy: missing "p" in (p. X) — e.g. "(. 1)"
        r"\(\.\s*\d+\s*\)",
        # OCR-fuzzy: common typos of "Continued" — e.g. "Continuted from p. 1"
        r"\b[Cc]ontin[a-z]*(?:ed|ued)\s+(?:on|from)\s+(?:p(?:age)?\.?\s+)?\w[\w-]*\b",
        # Broader: parenthesized continuation reference with OCR corruption
        r"\(\s*(?:Continued|Con't\.?|From)\s+(?:on|from)?\s*(?:p(?:age)?\.?\s+)?\w[\w-]*\s*\)",
    ]
]


def _extract_continuation_info(body: str) -> dict[str, str | None]:
    """Parse an article body for continuation references."""
    info: dict[str, str | None] = {"continues_on": None, "continued_from": None}
    match = re.search(
        r"(?:continued on|con't\.?\s+on|see|turn to)\s+(?:p(?:age)?\.?\s+)?(\d+)",
        body,
        re.IGNORECASE,
    )
    if match:
        info["continues_on"] = match.group(1)

    match = re.search(
        r"(?:continued|con't\.?)\s+from\s+(?:p(?:age)?\.?\s+)?(\d+)",
        body,
        re.IGNORECASE,
    )
    if match:
        info["continued_from"] = match.group(1)

    if not info["continues_on"]:
        match = re.search(r"[\(-]\s*p\.?\s*(\d+)\s*\)?\s*$", body, re.IGNORECASE)
        if match:
            info["continues_on"] = match.group(1)

    # Fallback: garbled "(. X)" where "p" was lost by OCR
    if not info["continues_on"]:
        match = re.search(r"\(\.\s*(\d+)\s*\)", body)
        if match:
            info["continues_on"] = match.group(1)

    return info


def _strip_continuation_markers(text: str) -> str:
    """Remove continuation markers (various newspaper styles) from article text."""
    for pattern in _CONTINUATION_PATTERNS:
        text = pattern.sub("", text)
    text = re.sub(r"\(\s*(?:Page)?\s*\)", "", text, flags=re.IGNORECASE)
    return re.sub(r" +", " ", text).strip()


def _headline_similar(h1: str, h2: str) -> bool:
    """Check if two headlines are similar enough for one-sided merge."""
    if not h1 or not h2:
        return False
    a = re.sub(r"^(continued|con't\.?)\s*[-:—]?\s*", "", h1, flags=re.IGNORECASE).strip().lower()
    b = re.sub(r"^(continued|con't\.?)\s*[-:—]?\s*", "", h2, flags=re.IGNORECASE).strip().lower()
    if not a or not b:
        return False
    return a in b or b in a


extract_continuation_info = _extract_continuation_info
strip_continuation_markers = _strip_continuation_markers
headline_similar = _headline_similar

__all__ = [
    "_extract_continuation_info",
    "_headline_similar",
    "_strip_continuation_markers",
    "extract_continuation_info",
    "headline_similar",
    "strip_continuation_markers",
]
