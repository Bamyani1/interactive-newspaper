"""Edition artifact writer helpers."""

from __future__ import annotations

import json
import os

from ..contracts.content_models import ArticleImage, EditionContent
from ..contracts.diagnostics_models import MergePassDiagnostics
from ..merging.merge_sanitizer import _sanitize_merged_articles


def align_existing_image_files(edition_output: str, merged: EditionContent) -> None:
    """Drop missing image paths and keep image metadata aligned."""
    for article in merged.articles:
        aligned_images = []
        aligned_files = []
        for idx, img_file in enumerate(article.image_files):
            if not img_file:
                continue
            full_path = os.path.join(edition_output, img_file)
            if not os.path.exists(full_path):
                continue
            aligned_files.append(img_file)
            if idx < len(article.images):
                aligned_images.append(article.images[idx])
            else:
                aligned_images.append(ArticleImage(caption="", position=""))
        article.images = aligned_images
        article.image_files = aligned_files

    for ad in merged.ads:
        ad.image_files = [
            f for f in ad.image_files if f and os.path.exists(os.path.join(edition_output, f))
        ]


def finalize_and_write_edition_json(
    edition_json_path: str,
    edition_date: str,
    publication_info: str,
    merged: EditionContent,
    merge_diag: MergePassDiagnostics | None = None,
) -> None:
    """Apply final sanitation and write edition JSON payload."""
    merged.articles = _sanitize_merged_articles(merged.articles, merged.other_content, md=merge_diag)
    payload = {
        "edition_date": edition_date,
        "publication_info": publication_info,
        **merged.model_dump(),
    }
    os.makedirs(os.path.dirname(os.path.abspath(edition_json_path)), exist_ok=True)
    partial = edition_json_path + ".part"
    with open(partial, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(partial, edition_json_path)


def write_edition_json(path: str, payload: dict) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    partial = path + ".part"
    with open(partial, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(partial, path)


__all__ = ["align_existing_image_files", "finalize_and_write_edition_json", "write_edition_json"]
