"""Page-level pipeline entrypoints.

Two-phase page processing:
  extract_page_docai()       — Phase 1: preprocess, DocAI text extraction, YOLO regions
  structure_and_link_page()  — Phase 2: Gemini structuring, dedup, postprocess, image linking
"""

from __future__ import annotations

import os

from PIL import Image as _PIL_Image

from ..config.constants import MIN_AD_IMAGE_AREA_PIXELS
from ..contracts.content_models import Article, ArticleImage, OtherContent, PageContent
from ..contracts.diagnostics_models import PageDiagnostics, StageTimer
from ..diagnostics.snapshots import save_snapshot
from ..export.markdown_writer import page_content_to_markdown
from ..image_linking.assignment_applier import _apply_visual_assignments
from ..image_linking.cropper import crop_and_save_images, draw_region_annotations
from ..image_linking.spatial_matcher import match_images_to_articles
from ..image_linking.visual_matcher import match_images_visual
from ..preprocessing.image_preprocessor import check_page_quality, preprocess_image
from ..recognition.docai_provider import extract_page_text
from ..recognition.page_extractor import (
    _extract_page_number_from_filename,
    process_page_with_docai,
)
from ..detection.yolo_provider import detect_image_regions
from ..shared.console import status, substep, warning, error, info


def extract_page_docai(
    image_path: str,
    diag: PageDiagnostics | None = None,
    snapshots_dir: str | None = None,
):
    """Phase 1: Preprocess image, extract text via DocAI, detect YOLO regions.

    Returns (docai_result, preprocessed_image, regions).
    Errors propagate — no try/except swallowing.
    """
    base_name = os.path.basename(image_path)
    status(f"DocAI extracting {base_name}...")

    if diag is not None:
        diag.filename = base_name

    # Open image once for both quality check and preprocessing
    original_image = _PIL_Image.open(image_path)

    # Pre-OCR quality check — skip blank pages, warn on low-res/inverted
    quality = check_page_quality(original_image)
    if quality.should_skip:
        warning(f"Skipping {base_name}: {quality.message}")
        if diag is not None:
            diag.error = f"skipped: {quality.message}"
        return None, None, []
    if quality.message:
        warning(f"{base_name}: {quality.message}")

    raw_image = preprocess_image(original_image, diag=None)

    docai_result = extract_page_text(raw_image)
    substep(
        f"DocAI: {len(docai_result.raw_text)} chars, "
        f"mean_conf={docai_result.mean_confidence:.2f}, "
        f"{len(docai_result.continuation_markers)} continuation markers"
    )

    save_snapshot(
        snapshots_dir,
        f"docai_page{_extract_page_number_from_filename(base_name) or '0'}.json",
        {
            "mean_confidence": docai_result.mean_confidence,
            "continuation_markers": docai_result.continuation_markers,
            "low_confidence_words": docai_result.low_confidence_words,
            "raw_text_length": len(docai_result.raw_text),
            "paragraph_count": len(docai_result.paragraphs),
        },
    )

    if diag is not None:
        diag.docai_mean_confidence = docai_result.mean_confidence

    regions = detect_image_regions(raw_image, diag=diag)
    if regions:
        substep(f"Detected {len(regions)} image region(s) via local CV")

    return docai_result, raw_image, regions


def structure_and_link_page(
    client,
    image_path: str,
    docai_result,
    preprocessed_image,
    regions: list[tuple[int, int, int, int]],
    output_dir: str,
    diag: PageDiagnostics | None = None,
    snapshots_dir: str | None = None,
    ocr_output_dir: str | None = None,
) -> PageContent | None:
    """Phase 2: Gemini structuring, dedup, postprocess, image crop+match, write markdown.

    Returns PageContent or None if no content extracted.
    """
    page_timer = StageTimer().start()
    base_name = os.path.basename(image_path)
    page_name = os.path.splitext(base_name)[0]
    status(f"Structuring {base_name}...")

    try:
        page_content, _gemini_image, _gemini_regions = process_page_with_docai(
            client,
            image_path,
            docai_result,
            preprocessed_image,
            regions,
            diag=diag,
            snapshots_dir=snapshots_dir,
        )

        if not page_content.articles and not page_content.ads and not page_content.other_content:
            warning("No content extracted")
            if diag is not None:
                diag.total_time_seconds = page_timer.stop()
            return None

        saved_files = crop_and_save_images(preprocessed_image, regions, output_dir, page_name)

        if diag is not None:
            diag.images_saved = len(saved_files)

        standalone_images = []
        if saved_files and regions:
            region_to_article = {}
            region_to_ad = {}
            unmatched = list(range(len(regions)))
            captions: dict[int, str] = {}
            used_visual = False

            if page_content.articles or page_content.ads:
                annotated = draw_region_annotations(preprocessed_image, regions)
                visual_result = match_images_visual(client, annotated, page_content, len(regions), diag=diag)

                if visual_result is not None:
                    region_to_article, region_to_ad, unmatched, captions = _apply_visual_assignments(
                        visual_result,
                        page_content,
                        len(regions),
                        diag=diag,
                    )
                    used_visual = True

                    for assignment in visual_result.assignments:
                        if assignment.content_type in ["text_ad", "not_image"]:
                            ri = assignment.region_number - 1
                            if ri in unmatched:
                                unmatched.remove(ri)
                            if ri in saved_files:
                                rejected_path = os.path.join(output_dir, saved_files[ri])
                                if os.path.exists(rejected_path):
                                    os.remove(rejected_path)
                                del saved_files[ri]
                else:
                    warning("Visual matching failed, falling back to spatial matching")
                    if diag is not None:
                        diag.visual_matching.fallback_to_spatial = True
                    width, height = preprocessed_image.size
                    region_to_article, unmatched = match_images_to_articles(
                        regions,
                        page_content.articles,
                        height,
                        width,
                        diag=diag,
                    )

            for ri, ai in region_to_article.items():
                if ri in saved_files:
                    article = page_content.articles[ai]
                    article.image_files.append(saved_files[ri])
                    ai_caption = captions.get(ri, "")
                    file_idx = len(article.image_files) - 1
                    if file_idx < len(article.images):
                        # OCR already created an images entry for this slot;
                        # replace with the AI caption (describes actual content,
                        # not just a photographer credit like "Photo (Name)")
                        if ai_caption:
                            article.images[file_idx].caption = ai_caption
                    else:
                        article.images.append(ArticleImage(caption=ai_caption, position=""))

            for ri, adi in region_to_ad.items():
                if ri in saved_files:
                    y_min, x_min, y_max, x_max = regions[ri]
                    region_area = (y_max - y_min) * (x_max - x_min)
                    ad_name = page_content.ads[adi].business_name
                    if region_area >= MIN_AD_IMAGE_AREA_PIXELS:
                        page_content.ads[adi].image_files.append(saved_files[ri])
                        info(f"Region {ri+1} matched to ad: {ad_name}")
                    else:
                        info(f"Region {ri+1} ad icon too small ({region_area}px), skipping: {ad_name}")

            standalone_images = []
            for ri in unmatched:
                if ri in saved_files:
                    caption = captions.get(ri, "")
                    # Unmatched images are not linked to any article or ad.
                    # These are typically decorative graphics, section headers,
                    # weather maps, etc. — not standalone photo articles.
                    # Move to other_content to avoid cluttering the article list.
                    standalone_images.append(saved_files[ri])
                    page_content.other_content.append(
                        OtherContent(
                            title=caption or "Unidentified image",
                            body=saved_files[ri],
                        )
                    )
            if standalone_images:
                substep(f"Preserved {len(standalone_images)} standalone images in other_content")

            matched_article = len(region_to_article)
            matched_ad = len(region_to_ad)
            method = "visual" if used_visual else "spatial"
            substep(f"Images ({method}): {matched_article} to articles, {matched_ad} to ads, {len(standalone_images)} standalone")

            save_snapshot(
                snapshots_dir,
                f"image_matching_page{page_content.page_number or '0'}.json",
                {
                    "method": method,
                    "region_to_article": {str(k): v for k, v in region_to_article.items()},
                    "region_to_ad": {str(k): v for k, v in region_to_ad.items()},
                    "unmatched": list(unmatched),
                    "captions": {str(k): v for k, v in captions.items()},
                    "saved_files": {str(k): v for k, v in saved_files.items()},
                    "standalone_images": standalone_images,
                },
            )

        page_num = page_content.page_number or "0"
        save_snapshot(snapshots_dir, f"post_images_page{page_num}.json", page_content)

        markdown = page_content_to_markdown(page_content, page_name, standalone_images)
        md_dir = ocr_output_dir if ocr_output_dir else output_dir
        output_path = os.path.join(md_dir, page_name + ".md")

        with open(output_path, "w", encoding="utf-8") as f:
            f.write(markdown)

        substep(f"{len(page_content.articles)} articles -> {output_path}")

        if diag is not None:
            diag.page_number = page_content.page_number
            diag.final_article_count = len(page_content.articles)
            diag.final_ad_count = len(page_content.ads)
            diag.final_other_content_count = len(page_content.other_content)
            diag.total_time_seconds = page_timer.stop()

        return page_content

    except Exception as e:
        error(f"Failed: {e}")
        if diag is not None:
            diag.error = str(e)
            diag.total_time_seconds = page_timer.stop()
        return None


__all__ = [
    "_extract_page_number_from_filename",
    "extract_page_docai",
    "structure_and_link_page",
]
