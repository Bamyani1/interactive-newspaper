"""Page OCR, structuring, visual detection, and evidence-preserving linking."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from PIL import Image

from ..config.constants import MIN_AD_IMAGE_AREA_PIXELS
from ..contracts.content_models import ArticleImage, OtherContent, PageContent
from ..contracts.diagnostics_models import PageDiagnostics, StageTimer
from ..detection.visual_provider import detect_image_regions
from ..image_linking.assignment_applier import _apply_visual_assignments
from ..image_linking.cropper import crop_and_save_images, crop_regions, draw_region_annotations
from ..image_linking.visual_matcher import match_images_visual
from ..preprocessing.image_preprocessor import check_page_quality, prepare_page_image_paths
from ..recognition.docai_provider import extract_page_text
from ..recognition.page_extractor import _extract_page_number_from_filename, process_page_with_docai
from ..shared.console import error, info, status, substep, warning


def extract_page_docai(
    image_path: str,
    diag: PageDiagnostics | None = None,
    work_dir: str | None = None,
):
    """Create explicit image branches, run DocAI, and detect source visuals.

    Returns ``(docai_result, ocr_derivative, regions, source_master)``.  Pixel
    quality checks are warnings only and never skip a manifest canvas before a
    successful Document AI and structuring response.
    """
    base_name = os.path.basename(image_path)
    status(f"DocAI extracting {base_name}...")
    if diag is not None:
        diag.filename = base_name

    owned_temp: tempfile.TemporaryDirectory[str] | None = None
    if work_dir is None:
        owned_temp = tempfile.TemporaryDirectory(prefix="transcript-ocr-page-")
        work_dir = owned_temp.name
    try:
        prepared = prepare_page_image_paths(
            image_path,
            work_dir,
            page_key=Path(image_path).stem,
            diag=diag,
        )
        with Image.open(prepared.source_master_path) as opened:
            source_master = opened.copy()
        with Image.open(prepared.ocr_derivative_path) as opened:
            ocr_derivative = opened.copy()
    finally:
        if owned_temp is not None:
            owned_temp.cleanup()

    quality = check_page_quality(source_master)
    if quality.message:
        warning(f"{base_name}: {quality.message}; cloud processing will still run")

    docai_result = extract_page_text(ocr_derivative)
    substep(
        f"DocAI: {len(docai_result.raw_text)} chars, "
        f"mean_conf={docai_result.mean_confidence:.2f}"
    )
    if diag is not None:
        diag.docai_mean_confidence = docai_result.mean_confidence

    regions = detect_image_regions(source_master, diag=diag)
    if regions:
        substep(f"Detected {len(regions)} visual region(s) on the source master")
    return docai_result, ocr_derivative, regions, source_master


def _apply_minimum_ad_visual_area(assignments, regions):
    """Turn sub-threshold ad attachments into an explicit disposition."""
    updated = []
    for assignment in assignments.assignments:
        index = assignment.region_number - 1
        if assignment.attachment == "ad" and 0 <= index < len(regions):
            y_min, x_min, y_max, x_max = regions[index]
            area = max(0, y_max - y_min) * max(0, x_max - x_min)
            if area < MIN_AD_IMAGE_AREA_PIXELS:
                assignment = assignment.model_copy(
                    update={
                        "attachment": "reject",
                        "content_index": -1,
                        "caption_slot": -1,
                        "rejection_reason": "rejected_small_ad_visual",
                    }
                )
        updated.append(assignment)
    return assignments.model_copy(update={"assignments": updated})


def structure_and_link_page(
    client,
    image_path: str,
    docai_result,
    preprocessed_image: Image.Image,
    regions: list[tuple[int, int, int, int]],
    output_dir: str,
    diag: PageDiagnostics | None = None,
    source_image: Image.Image | None = None,
) -> PageContent | None:
    """Structure one page and give every proposed visual one disposition."""
    timer = StageTimer().start()
    base_name = os.path.basename(image_path)
    page_name = os.path.splitext(base_name)[0]
    source = source_image if source_image is not None else preprocessed_image.convert("RGB")
    status(f"Structuring {base_name}...")

    try:
        page_content, _gemini_image, _gemini_regions = process_page_with_docai(
            client,
            image_path,
            docai_result,
            preprocessed_image,
            regions,
            diag=diag,
        )

        original_caption_slots = [
            image.model_copy()
            for article in page_content.articles
            for image in article.images
            if (image.caption or "").strip()
        ]
        for ad in page_content.ads:
            ad.image_files = []

        saved_files: dict[int, str] = {}
        used_caption_slots: set[int] = set()
        if regions:
            evidence = crop_regions(source, regions, padding_frac=0.10)
            annotated = draw_region_annotations(source, regions)
            visual_result = match_images_visual(
                client,
                annotated,
                page_content,
                len(regions),
                diag=diag,
                evidence_images=[evidence[index] for index in range(len(regions))],
            )
            visual_result = _apply_minimum_ad_visual_area(visual_result, regions)
            region_to_article, region_to_ad, standalone, printed_captions = _apply_visual_assignments(
                visual_result,
                page_content,
                len(regions),
                diag=diag,
            )

            for article in page_content.articles:
                article.images = []
                article.image_files = []

            saved_files = crop_and_save_images(
                source,
                regions,
                output_dir,
                page_name,
                padding_frac=0.10,
            )
            if diag is not None:
                diag.images_saved = len(saved_files)

            assignments_by_region = {
                assignment.region_number - 1: assignment
                for assignment in visual_result.assignments
            }
            for region_index, article_index in region_to_article.items():
                assignment = assignments_by_region[region_index]
                if assignment.visual_type == "typographic_display_ad":
                    page_content.articles[article_index]._visual_kind_conflict = True
            retained = set(region_to_article) | set(region_to_ad) | set(standalone)
            for region_index in list(saved_files):
                if region_index in retained:
                    continue
                path = os.path.join(output_dir, saved_files.pop(region_index))
                try:
                    os.remove(path)
                except FileNotFoundError:
                    pass

            for region_index, article_index in sorted(region_to_article.items()):
                image_file = saved_files.get(region_index)
                if not image_file:
                    continue
                assignment = assignments_by_region[region_index]
                slot = assignment.caption_slot
                image = (
                    original_caption_slots[slot].model_copy()
                    if 0 <= slot < len(original_caption_slots)
                    else ArticleImage(caption="", position="")
                )
                if slot >= 0:
                    used_caption_slots.add(slot)
                page_content.articles[article_index].image_files.append(image_file)
                page_content.articles[article_index].images.append(image)

            for region_index, ad_index in sorted(region_to_ad.items()):
                image_file = saved_files.get(region_index)
                if image_file:
                    page_content.ads[ad_index].image_files.append(image_file)
                    info(f"Region {region_index + 1} attached to ad {ad_index}")

            for region_index in sorted(standalone):
                image_file = saved_files.get(region_index)
                if not image_file:
                    continue
                assignment = assignments_by_region.get(region_index)
                slot = assignment.caption_slot if assignment is not None else -1
                caption = printed_captions.get(region_index, "")
                if slot >= 0:
                    used_caption_slots.add(slot)
                item = OtherContent(title=caption, body=image_file)
                if assignment is not None:
                    item._review_unresolved = assignment.visual_type == "unresolved"
                    item._visual_kind_conflict = (
                        assignment.visual_type == "typographic_display_ad"
                    )
                page_content.other_content.append(item)

            substep(
                f"Visual dispositions: {len(region_to_article)} article, "
                f"{len(region_to_ad)} ad, {len(standalone)} standalone"
            )
        else:
            for article in page_content.articles:
                article.images = []
                article.image_files = []

        # Printed text must not disappear merely because its visual was not
        # detected or could not be safely attached.
        for slot, image in enumerate(original_caption_slots):
            if slot not in used_caption_slots:
                page_content.other_content.append(
                    OtherContent(title="", body=image.caption)
                )

        if diag is not None:
            diag.page_number = page_content.page_number
            diag.final_article_count = len(page_content.articles)
            diag.final_ad_count = len(page_content.ads)
            diag.final_other_content_count = len(page_content.other_content)
            diag.total_time_seconds = timer.stop()
        return page_content
    except Exception as exc:
        error(f"Failed: {exc}")
        if diag is not None:
            diag.error = str(exc)
            diag.total_time_seconds = timer.stop()
        return None


__all__ = [
    "_apply_minimum_ad_visual_area",
    "_extract_page_number_from_filename",
    "extract_page_docai",
    "structure_and_link_page",
]
