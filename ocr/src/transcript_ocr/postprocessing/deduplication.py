"""Deduplication helpers for OCR page content."""

from __future__ import annotations

import re

from ..contracts.content_models import Ad, Article, OtherContent, PageContent
from ..contracts.diagnostics_models import DeduplicationInfo, PageDiagnostics, StageTimer


def _split_sentences(text: str) -> list[str]:
    """Split text into sentences using basic punctuation rules."""
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return [s.strip() for s in parts if s.strip()]


def _normalize(text: str) -> str:
    """Collapse whitespace for comparison."""
    return re.sub(r"\s+", " ", text.strip())


def _sentence_overlap(sents_a: list[str], sents_b: list[str]) -> float:
    """Return the fraction of shared sentences (relative to smaller set)."""
    if not sents_a or not sents_b:
        return 0.0
    set_a = set(_normalize(s) for s in sents_a)
    set_b = set(_normalize(s) for s in sents_b)
    overlap = len(set_a & set_b)
    return overlap / min(len(set_a), len(set_b))


def _dedup_article_body(body: str) -> str:
    """Remove consecutive duplicate sentences and duplicate paragraphs."""
    paragraphs = [p.strip() for p in body.split("\n\n") if p.strip()]

    cleaned_paragraphs = []
    for para in paragraphs:
        sentences = _split_sentences(para)
        deduped = []
        for sent in sentences:
            if not deduped or _normalize(sent) != _normalize(deduped[-1]):
                deduped.append(sent)
        cleaned_paragraphs.append(" ".join(deduped))

    seen = set()
    unique_paragraphs = []
    for para in cleaned_paragraphs:
        key = _normalize(para)
        if key not in seen:
            seen.add(key)
            unique_paragraphs.append(para)

    return "\n\n".join(unique_paragraphs)


def deduplicate_articles(
    page_content: PageContent,
    diag: PageDiagnostics | None = None,
) -> PageContent:
    """Remove duplicate article text and overlapping duplicate articles."""
    timer = StageTimer().start()
    articles_before = len(page_content.articles)

    articles = []
    for article in page_content.articles:
        cleaned_body = _dedup_article_body(article.body)
        articles.append(
            Article(
                headline=article.headline,
                author=article.author,
                writer_position=article.writer_position,
                category=article.category,
                continues_on=article.continues_on,
                continued_from=article.continued_from,
                body=cleaned_body,
                images=article.images,
                image_files=article.image_files,
            )
        )

    merged = []
    used = set()
    for i, art_a in enumerate(articles):
        if i in used:
            continue
        best = art_a
        sents_best = _split_sentences(best.body)
        for j in range(i + 1, len(articles)):
            if j in used:
                continue
            sents_j = _split_sentences(articles[j].body)
            if _sentence_overlap(sents_best, sents_j) > 0.6:
                used.add(j)
                if not best.headline and articles[j].headline:
                    best = articles[j]
                    sents_best = sents_j
                elif len(articles[j].body) > len(best.body):
                    best = Article(
                        headline=best.headline or articles[j].headline,
                        author=best.author or articles[j].author,
                        writer_position=best.writer_position or articles[j].writer_position,
                        category=best.category,
                        continues_on=best.continues_on or articles[j].continues_on,
                        continued_from=best.continued_from or articles[j].continued_from,
                        body=articles[j].body,
                        images=best.images + articles[j].images,
                        image_files=best.image_files + articles[j].image_files,
                    )
                    sents_best = _split_sentences(best.body)
        merged.append(best)

    if diag is not None:
        diag.dedup_info = DeduplicationInfo(
            articles_before=articles_before,
            articles_after=len(merged),
            overlapping_pairs_merged=len(used),
        )
        diag.timings["dedup"] = timer.stop()

    return PageContent(
        articles=merged,
        other_content=page_content.other_content,
        ads=page_content.ads,
        page_number=page_content.page_number,
        publication_info=page_content.publication_info,
    )


def _deduplicate_ads(ads: list[Ad]) -> list[Ad]:
    """Remove duplicate ads by comparing business_name + body overlap."""
    if not ads:
        return ads
    merged = []
    used = set()
    for i, ad_a in enumerate(ads):
        if i in used:
            continue
        best = ad_a
        name_a = _normalize(ad_a.business_name).lower()
        sents_best = _split_sentences(best.body)
        for j in range(i + 1, len(ads)):
            if j in used:
                continue
            name_b = _normalize(ads[j].business_name).lower()
            if name_a != name_b:
                from difflib import SequenceMatcher

                if SequenceMatcher(None, name_a, name_b).ratio() < 0.8:
                    continue
            sents_j = _split_sentences(ads[j].body)
            if _sentence_overlap(sents_best, sents_j) > 0.6:
                used.add(j)
                combined_images = list(best.image_files) + list(ads[j].image_files)
                if len(ads[j].body) > len(best.body):
                    best = Ad(
                        business_name=best.business_name,
                        body=ads[j].body,
                        image_files=combined_images,
                    )
                else:
                    best = Ad(
                        business_name=best.business_name,
                        body=best.body,
                        image_files=combined_images,
                    )
                sents_best = _split_sentences(best.body)
        merged.append(best)
    return merged


def _deduplicate_other_content(others: list[OtherContent]) -> list[OtherContent]:
    """Remove duplicate other_content by comparing title + body overlap."""
    if not others:
        return others
    merged = []
    used = set()
    for i, oc_a in enumerate(others):
        if i in used:
            continue
        best = oc_a
        title_a = _normalize(oc_a.title).lower()
        sents_best = _split_sentences(best.body)
        for j in range(i + 1, len(others)):
            if j in used:
                continue
            title_b = _normalize(others[j].title).lower()
            if title_a != title_b:
                continue
            sents_j = _split_sentences(others[j].body)
            if _sentence_overlap(sents_best, sents_j) > 0.6:
                used.add(j)
                if len(others[j].body) > len(best.body):
                    best = OtherContent(title=best.title, body=others[j].body)
                sents_best = _split_sentences(best.body)
        merged.append(best)
    return merged


__all__ = [
    "_dedup_article_body",
    "_deduplicate_ads",
    "_deduplicate_other_content",
    "_normalize",
    "_sentence_overlap",
    "_split_sentences",
    "deduplicate_articles",
]
