"""Text-normalization helpers used across OCR stages."""

from __future__ import annotations

import re

_WS_RE = re.compile(r"\s+")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def normalize_whitespace(text: str) -> str:
    return _WS_RE.sub(" ", (text or "").strip())


def normalize_for_compare(text: str) -> str:
    return normalize_whitespace(text).lower()


def split_sentences(text: str) -> list[str]:
    """Split text into sentences using basic punctuation rules."""
    parts = _SENTENCE_SPLIT_RE.split(text.strip())
    return [s.strip() for s in parts if s.strip()]


__all__ = ["normalize_for_compare", "normalize_whitespace", "split_sentences"]
