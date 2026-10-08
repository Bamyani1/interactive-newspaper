"""Check that page structuring kept every OCR block's text, in order."""

from __future__ import annotations

import re

from ..contracts.content_models import PageContent

_WORD_RE = re.compile(r"[a-z0-9]+")
# Calibrated on saved 1983-11-03 and 1989-11-29 page outputs: every intact
# block kept at least 0.78 of its word pairs; a dropped sentence left 0.60,
# a scrambled story 0.23. Short blocks (jump lines, folios) are skipped.
_MIN_BLOCK_WORDS = 10
_MIN_PAIR_COVERAGE = 0.7


def _words(text: str) -> list[str]:
    return _WORD_RE.findall(re.sub(r"-\s*\n\s*", "", text or "").lower())


def _page_text(content: PageContent) -> str:
    parts = [content.publication_info]
    for article in content.articles:
        parts += [article.headline, article.author, article.body]
        parts += [image.caption for image in article.images]
    for ad in content.ads:
        parts += [ad.business_name, ad.body]
    for item in content.other_content:
        parts += [item.title, item.body]
    return "\n".join(part or "" for part in parts)


def uncovered_blocks(block_texts: list[str], content: PageContent) -> list[str]:
    """OCR blocks of 10+ words whose adjacent word pairs mostly never appear in
    the structured page: text dropped or scrambled, or a spliced input block."""
    words = _words(_page_text(content))
    pairs = set(zip(words, words[1:]))
    flagged = []
    for text in block_texts:
        block = _words(text)
        if len(block) < _MIN_BLOCK_WORDS:
            continue
        block_pairs = list(zip(block, block[1:]))
        kept = sum(pair in pairs for pair in block_pairs) / len(block_pairs)
        if kept < _MIN_PAIR_COVERAGE:
            flagged.append(text)
    return flagged


__all__ = ["uncovered_blocks"]
