"""Conservative, evidence-preserving OCR deduplication."""

from __future__ import annotations

from ..contracts.content_models import Ad, Article, OtherContent, PageContent
from ..contracts.diagnostics_models import DeduplicationInfo, PageDiagnostics, StageTimer
from ..shared.text import normalize_whitespace


def _dedup_article_body(body: str) -> str:
    """Remove only consecutive exactly-equal normalized paragraphs.

    Repeated sentences and non-consecutive refrains can be legitimate newspaper
    text, so they are deliberately preserved.
    """
    paragraphs = [part.strip() for part in (body or "").split("\n\n") if part.strip()]
    kept: list[str] = []
    previous = ""
    for paragraph in paragraphs:
        key = normalize_whitespace(paragraph)
        if not kept or key != previous:
            kept.append(paragraph)
        previous = key
    return "\n\n".join(kept)


def deduplicate_articles(
    page_content: PageContent,
    diag: PageDiagnostics | None = None,
) -> PageContent:
    """Clean bodies and remove only exact duplicate headline+body records."""
    timer = StageTimer().start()
    before = len(page_content.articles)
    seen: dict[tuple[str, str], Article] = {}
    articles: list[Article] = []
    for article in page_content.articles:
        cleaned_body = _dedup_article_body(article.body)
        key = (
            normalize_whitespace(article.headline),
            normalize_whitespace(cleaned_body),
        )
        retained = seen.get(key)
        if retained is not None:
            existing_captions = {
                (image.caption, image.position) for image in retained.images
            }
            for image in article.images:
                image_key = (image.caption, image.position)
                if image_key not in existing_captions:
                    retained.images.append(image)
                    existing_captions.add(image_key)
            for index, image_file in enumerate(article.image_files):
                if image_file in retained.image_files:
                    continue
                retained.image_files.append(image_file)
                if index < len(article.images):
                    retained.images.append(article.images[index])
            retained._category_fallback_used = (
                retained._category_fallback_used
                or article._category_fallback_used
            )
            continue
        cleaned = article.model_copy(update={"body": cleaned_body})
        seen[key] = cleaned
        articles.append(cleaned)

    if diag is not None:
        diag.dedup_info = DeduplicationInfo(
            articles_before=before,
            articles_after=len(articles),
            overlapping_pairs_merged=before - len(articles),
        )
        diag.timings["dedup"] = timer.stop()

    return page_content.model_copy(update={"articles": articles})


def _deduplicate_ads(ads: list[Ad]) -> list[Ad]:
    seen: dict[tuple[str, str], Ad] = {}
    result: list[Ad] = []
    for ad in ads:
        key = (normalize_whitespace(ad.business_name), normalize_whitespace(ad.body))
        retained = seen.get(key)
        if retained is None:
            seen[key] = ad
            result.append(ad)
            continue
        retained._review_unresolved = retained._review_unresolved or ad._review_unresolved
        retained._visual_kind_conflict = (
            retained._visual_kind_conflict or ad._visual_kind_conflict
        )
        for page in ad._source_pages_internal:
            if page not in retained._source_pages_internal:
                retained._source_pages_internal.append(page)
    return result


def _deduplicate_other_content(others: list[OtherContent]) -> list[OtherContent]:
    seen: dict[tuple[str, str], OtherContent] = {}
    result: list[OtherContent] = []
    for item in others:
        key = (normalize_whitespace(item.title), normalize_whitespace(item.body))
        retained = seen.get(key)
        if retained is None:
            seen[key] = item
            result.append(item)
            continue
        retained._review_unresolved = retained._review_unresolved or item._review_unresolved
        retained._visual_kind_conflict = (
            retained._visual_kind_conflict or item._visual_kind_conflict
        )
        for page in item._source_pages_internal:
            if page not in retained._source_pages_internal:
                retained._source_pages_internal.append(page)
    return result


__all__ = [
    "_dedup_article_body",
    "_deduplicate_ads",
    "_deduplicate_other_content",
    "deduplicate_articles",
]
