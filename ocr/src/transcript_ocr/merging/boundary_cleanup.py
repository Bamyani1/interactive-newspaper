"""Post-merge text cleanup at article body join points."""

from __future__ import annotations

import re


def _normalize_for_compare(text: str) -> str:
    """Collapse whitespace for sentence comparison."""
    return re.sub(r"\s+", " ", text.strip()).lower()


def _last_sentence(text: str) -> str:
    """Extract the last sentence from text."""
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    return sentences[-1].strip() if sentences else ""


def _first_sentence(text: str) -> str:
    """Extract the first sentence from text."""
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    return sentences[0].strip() if sentences else ""


def clean_merge_boundary(seg1: str, seg2: str) -> str:
    """Clean up text at the join point between two merged article segments.

    Handles:
    1. Truncated word joining (seg1 ends mid-word, seg2 starts with rest)
    2. Duplicate sentence removal at seam
    """
    if not seg1 and not seg2:
        return ""
    if not seg1:
        return seg2
    if not seg2:
        return seg1

    seg1 = seg1.rstrip()
    seg2 = seg2.lstrip()

    # After stripping, either may be empty
    if not seg1:
        return seg2
    if not seg2:
        return seg1

    # --- Truncated word joining ---
    # If seg1 ends without sentence-terminal punctuation AND seg2 starts lowercase,
    # try joining the last word of seg1 with the first word of seg2.
    last_char = seg1[-1]
    first_char = seg2[0]

    if last_char not in '.!?"\'\u201d\u2019)' and first_char.islower():
        seg1_words = seg1.rsplit(None, 1)
        seg2_words = seg2.split(None, 1)
        if seg2_words:
            if len(seg1_words) == 2:
                prefix = seg1_words[0]
                last_word = seg1_words[1]
                first_word = seg2_words[0]
                rest = seg2_words[1] if len(seg2_words) > 1 else ""
                joined = last_word + first_word
                seg1 = prefix
                seg2 = (joined + " " + rest).strip() if rest else joined
            elif len(seg1_words) == 1:
                # Single word — join entirely with first word of seg2
                joined = seg1_words[0] + seg2_words[0]
                rest = seg2_words[1] if len(seg2_words) > 1 else ""
                seg1 = ""
                seg2 = (joined + " " + rest).strip() if rest else joined

    # --- Duplicate sentence removal at seam ---
    last_sent = _last_sentence(seg1)
    first_sent = _first_sentence(seg2)
    if last_sent and first_sent and _normalize_for_compare(last_sent) == _normalize_for_compare(first_sent):
        # Remove the duplicate from seg2
        idx = seg2.find(first_sent)
        if idx != -1:
            seg2 = seg2[idx + len(first_sent):].lstrip()

    return (seg1 + "\n\n" + seg2).strip()


__all__ = ["clean_merge_boundary"]
