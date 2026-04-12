"""Ad reclassification and page postprocessing orchestration."""

from __future__ import annotations

import re

from ..contracts.content_models import Ad, Article, PageContent
from ..contracts.diagnostics_models import PageDiagnostics, StageTimer
from ..shared.console import substep
from .byline_cleanup import _split_author_position, _normalize_byline

_AD_SIGNALS = [
    r"\$\d",
    r"(?i)\bsubscri(?:be|ption)\b",
    r"(?i)\bcall\s+\d{3}[\s-]\d{4}\b",
    r"(?i)\bcoupon\b",
    r"(?i)\bfree\s+(?:trial|delivery|shipping)\b",
    r"(?i)\border\s+(?:now|today)\b",
    r"(?i)\bsave\s+\$?\d",
    r"(?i)\bspecial\s+offer\b",
]


def postprocess_page_content(
    page_content: PageContent,
    diag: PageDiagnostics | None = None,
) -> PageContent:
    """Apply local post-processing fixes to OCR page content."""
    timer = StageTimer().start()

    articles = []
    for art in page_content.articles:
        author = _normalize_byline(art.author)
        position = art.writer_position
        if not position:
            author, position = _split_author_position(author)
        articles.append(
            Article(
                headline=art.headline,
                author=author,
                writer_position=position,
                category=art.category,
                continues_on=art.continues_on,
                continued_from=art.continued_from,
                body=art.body.replace("\\n", "\n"),
                images=art.images,
                image_files=art.image_files,
            )
        )

    final_articles = []
    new_ads = list(page_content.ads)
    for art in articles:
        signal_count = sum(1 for pat in _AD_SIGNALS if re.search(pat, art.body))
        if signal_count >= 2 and not art.author:
            substep(f"Reclassified as ad: '{art.headline[:50]}' ({signal_count} ad signals)")
            new_ads.append(
                Ad(
                    business_name=art.headline or "Untitled Ad",
                    body=art.body,
                    image_files=art.image_files,
                )
            )
            if diag is not None:
                diag.postprocessing.ad_reclassifications.append(
                    {
                        "headline": art.headline[:80],
                        "signal_count": signal_count,
                    }
                )
        else:
            final_articles.append(art)

    if diag is not None:
        diag.timings["postprocess"] = timer.stop()

    return PageContent(
        articles=final_articles,
        other_content=page_content.other_content,
        ads=new_ads,
        page_number=page_content.page_number,
        publication_info=page_content.publication_info,
    )


__all__ = ["_AD_SIGNALS", "postprocess_page_content"]
