"""Merge sanitation and category reconciliation helpers."""

from __future__ import annotations

import re

from ..contracts.content_models import ArticleImage, MergedArticle, OtherContent
from ..contracts.diagnostics_models import MergePassDiagnostics

_CATEGORY_PRIORITY = [
    "Sports",
    "News",
    "Arts & Entertainment",
    "Opinion",
    "Campus News",
]


def _choose_merged_category(source_categories: list[str]) -> str:
    """Choose merged category by majority vote with deterministic tie-breaking."""
    counts: dict[str, int] = {}
    for category in source_categories:
        value = (category or "").strip()
        if not value:
            continue
        counts[value] = counts.get(value, 0) + 1
    if not counts:
        return "Campus News"

    best_count = max(counts.values())
    tied = [c for c, n in counts.items() if n == best_count]
    if len(tied) == 1:
        return tied[0]
    for category in _CATEGORY_PRIORITY:
        if category in tied:
            return category
    return sorted(tied)[0]


def _reconcile_image_alignment(
    images: list[ArticleImage],
    image_files: list[str],
) -> tuple[list[ArticleImage], list[str], list[str]]:
    """Align image metadata to extracted files; drop fileless metadata captions."""
    aligned_images: list[ArticleImage] = []
    aligned_files: list[str] = []
    orphan_captions: list[str] = []
    max_len = max(len(images), len(image_files))

    for idx in range(max_len):
        img = images[idx] if idx < len(images) else None
        img_file = image_files[idx].strip() if idx < len(image_files) and isinstance(image_files[idx], str) else ""

        if img_file:
            aligned_files.append(img_file)
            if img is not None:
                aligned_images.append(img)
            else:
                aligned_images.append(ArticleImage(caption="", position=""))
            continue

        if img is not None and (img.caption or "").strip():
            orphan_captions.append(img.caption.strip())

    return aligned_images, aligned_files, orphan_captions


_CAPTION_PATTERN = re.compile(r"^(?:[A-Z]{2,}\s+){2,}[A-Z][a-z]", re.MULTILINE)


def _strip_trailing_captions(body: str) -> tuple[str, list[str]]:
    """Detect and strip photo caption paragraphs from the end of a merged body."""
    paragraphs = body.strip().split("\n\n")
    stripped_captions: list[str] = []

    while len(paragraphs) > 1:
        last = paragraphs[-1].strip()
        if _CAPTION_PATTERN.match(last) and len(last) < 300:
            stripped_captions.insert(0, last)
            paragraphs.pop()
        else:
            break

    if stripped_captions:
        return "\n\n".join(paragraphs), stripped_captions
    return body, []


def _sanitize_merged_articles(
    merged_articles: list[MergedArticle],
    all_other: list[OtherContent],
    md: MergePassDiagnostics | None = None,
) -> list[MergedArticle]:
    """Drop structurally-empty merged articles and move orphan captions to other_content."""
    sanitized: list[MergedArticle] = []
    for article in merged_articles:
        aligned_images, aligned_files, orphan_captions = _reconcile_image_alignment(
            list(article.images),
            list(article.image_files),
        )
        if md is not None and orphan_captions:
            md.image_orphans_dropped += len(orphan_captions)

        article.images = aligned_images
        article.image_files = aligned_files

        headline = (article.headline or "").strip()
        body = (article.body or "").strip()
        has_files = len(article.image_files) > 0

        # Stricter filter: articles with no headline, very short body, and only
        # image captions are not real articles — move to other_content
        if not headline and len(body) < 20 and has_files:
            caption_text = "\n\n".join(
                img.caption.strip() for img in article.images if (img.caption or "").strip()
            )
            all_other.append(
                OtherContent(
                    title="Unidentified image",
                    body=caption_text or body or article.image_files[0],
                )
            )
            if md is not None:
                md.empty_articles_removed += 1
            continue

        if headline or body or has_files:
            sanitized.append(article)
            continue

        if orphan_captions:
            all_other.append(
                OtherContent(
                    title=headline or "Unassociated image caption",
                    body="\n\n".join(orphan_captions),
                )
            )
        if md is not None:
            md.empty_articles_removed += 1

    return sanitized


choose_merged_category = _choose_merged_category
reconcile_image_alignment = _reconcile_image_alignment
sanitize_merged_articles = _sanitize_merged_articles
strip_trailing_captions = _strip_trailing_captions

__all__ = [
    "_choose_merged_category",
    "_reconcile_image_alignment",
    "_sanitize_merged_articles",
    "_strip_trailing_captions",
    "choose_merged_category",
    "reconcile_image_alignment",
    "sanitize_merged_articles",
    "strip_trailing_captions",
]
