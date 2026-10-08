"""Evidence-preserving page text normalization."""

from __future__ import annotations

import re

from ..contracts.content_models import PageContent
from ..contracts.diagnostics_models import PageDiagnostics, StageTimer
from .byline_cleanup import _dedup_byline_from_body, _normalize_byline

_NEWLINES = re.compile(r"\n+")
_SENTENCE_END = tuple(".!?:;\"')]\u201d\u2019")


def _paragraph_breaks(body: str) -> str:
    """Make each paragraph break a blank line, which later stages and the site
    split on. A line break inside a sentence, blank or not, is a leftover line
    wrap; one after a hyphen stays a single newline for the site to rejoin."""

    def replace(match: re.Match[str]) -> str:
        before = body[: match.start()].rstrip()
        after = body[match.end() :].lstrip()
        if before.endswith("-"):
            return "\n"
        if not before.endswith(_SENTENCE_END) and after[:1].islower():
            return " "
        return "\n\n"

    return _NEWLINES.sub(replace, body)


def postprocess_page_content(
    page_content: PageContent,
    diag: PageDiagnostics | None = None,
) -> PageContent:
    """Normalize byline placement without changing article/ad classification."""
    timer = StageTimer().start()
    articles = []
    for article in page_content.articles:
        author = _normalize_byline(article.author)
        body = (article.body or "").replace("\\n", "\n")
        body = _paragraph_breaks(_dedup_byline_from_body(author, body))
        articles.append(article.model_copy(update={"author": author, "body": body}))
    if diag is not None:
        diag.timings["postprocess"] = timer.stop()
    return page_content.model_copy(update={"articles": articles})


__all__ = ["postprocess_page_content"]
