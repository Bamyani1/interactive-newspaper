"""Evidence-preserving page text normalization."""

from __future__ import annotations

from ..contracts.content_models import PageContent
from ..contracts.diagnostics_models import PageDiagnostics, StageTimer
from .byline_cleanup import _dedup_byline_from_body, _normalize_byline


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
        body = _dedup_byline_from_body(author, body)
        articles.append(article.model_copy(update={"author": author, "body": body}))
    if diag is not None:
        diag.timings["postprocess"] = timer.stop()
    return page_content.model_copy(update={"articles": articles})


__all__ = ["postprocess_page_content"]
