"""Conservative final alignment for model-reviewed merge output."""

from __future__ import annotations

from ..contracts.content_models import ARTICLE_CATEGORIES, ArticleImage, MergedArticle, OtherContent
from ..contracts.diagnostics_models import MergePassDiagnostics


def _choose_merged_category(source_categories: list[str]) -> str:
    """Select the earliest valid non-empty source category mechanically."""
    return next((value for value in source_categories if value in ARTICLE_CATEGORIES), "News")


def _reconcile_image_alignment(
    images: list[ArticleImage],
    image_files: list[str],
) -> tuple[list[ArticleImage], list[str], list[str]]:
    aligned_images: list[ArticleImage] = []
    aligned_files: list[str] = []
    orphan_captions: list[str] = []
    for index in range(max(len(images), len(image_files))):
        image = images[index] if index < len(images) else None
        image_file = image_files[index].strip() if index < len(image_files) else ""
        if image_file:
            aligned_files.append(image_file)
            aligned_images.append(image or ArticleImage(caption="", position=""))
        elif image is not None and image.caption.strip():
            orphan_captions.append(image.caption.strip())
    return aligned_images, aligned_files, orphan_captions


def _sanitize_merged_articles(
    merged_articles: list[MergedArticle],
    all_other: list[OtherContent],
    md: MergePassDiagnostics | None = None,
) -> list[MergedArticle]:
    sanitized: list[MergedArticle] = []
    for article in merged_articles:
        images, image_files, orphan_captions = _reconcile_image_alignment(
            list(article.images), list(article.image_files)
        )
        article.images = images
        article.image_files = image_files
        for caption in orphan_captions:
            all_other.append(OtherContent(title="", body=caption))
        if md is not None:
            md.image_orphans_dropped += len(orphan_captions)
        if article.headline.strip() or article.body.strip() or article.image_files:
            sanitized.append(article)
        elif md is not None:
            md.empty_articles_removed += 1
    return sanitized


choose_merged_category = _choose_merged_category
reconcile_image_alignment = _reconcile_image_alignment
sanitize_merged_articles = _sanitize_merged_articles

__all__ = [
    "_choose_merged_category",
    "_reconcile_image_alignment",
    "_sanitize_merged_articles",
    "choose_merged_category",
    "reconcile_image_alignment",
    "sanitize_merged_articles",
]
