"""Text-normalization helpers used across OCR stages."""

from __future__ import annotations

import re

_WS_RE = re.compile(r"\s+")


def normalize_whitespace(text: str) -> str:
    return _WS_RE.sub(" ", (text or "").strip())


def normalize_for_compare(text: str) -> str:
    return normalize_whitespace(text).lower()


__all__ = ["normalize_for_compare", "normalize_whitespace"]
