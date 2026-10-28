"""Full-page recognition path."""

from __future__ import annotations

import os

from PIL import Image

from ..config.model_calls import GenerationConfig, image_part, model_name
from ..contracts.content_models import PageContent
from ..contracts.diagnostics_models import PageDiagnostics, StageTimer, TokenUsage
from ..postprocessing.page_normalization import postprocess_page_content
from ..postprocessing.deduplication import deduplicate_articles
from ..postprocessing.null_sanitizer import _sanitize_null_strings
from ..shared.retry import generate_with_retry, require_parsed
from .prompts import PAGE_LAYOUT_SUPPLEMENT, PAGE_STRUCTURING_PROMPT
from ..shared.console import substep


def _format_page_text(page_text) -> str:
    """Expose paragraph geometry to the model without changing archival output."""
    paragraph_regions = list(getattr(page_text, "paragraph_regions", []) or [])
    if paragraph_regions:
        blocks = [
            "NON-HISTORICAL OCR LAYOUT METADATA — NEVER COPY THESE LABELS OR "
            "COORDINATES INTO OUTPUT. Bounds are normalized "
            "[left, top, right, bottom] and exist only to reconstruct columns "
            "and paragraph reading order."
        ]
        for index, paragraph in enumerate(paragraph_regions, start=1):
            bounds = getattr(paragraph, "bounds", None)
            if bounds is None:
                bounds_label = "unknown"
            else:
                bounds_label = ", ".join(f"{value:.5f}" for value in bounds)
            header = f"OCR BLOCK {index:04d} BOUNDS [{bounds_label}]"
            indented = getattr(paragraph, "indented", None)
            if indented is not None:
                # Paragraph breaks follow the printed indent.
                header += " FIRST LINE INDENTED" if indented else " FIRST LINE FLUSH"
            blocks.append(f"{header}\n{paragraph.text}")
        return "\n\n".join(blocks)
    if page_text.paragraphs:
        return "\n\n".join(page_text.paragraphs)
    return page_text.raw_text


def _extract_page_number_from_filename(filename: str) -> str:
    """Extract page number from filenames like 'Page 03.jpg' or 'Page03.tiff'."""
    import re

    match = re.search(r"Page\s*0*(\d+)", filename, re.IGNORECASE)
    return match.group(1) if match else ""


def structure_page(
    client,
    image_path: str,
    page_text,
    preprocessed_image: Image.Image,
    regions: list[tuple[int, int, int, int]],
    diag: PageDiagnostics | None = None,
) -> tuple[PageContent, Image.Image, list[tuple[int, int, int, int]]]:
    """
    Send a preprocessed page image to Claude for structuring, with the page text
    already read. Claude structures the provided text into articles/ads — it does
    not re-read characters off the image.

    Uses the preprocessed image and regions from Phase 1 — does NOT reprocess.
    """
    image = preprocessed_image

    ocr_text = _format_page_text(page_text)

    known_continuations = (
        "No local continuation decision is supplied; inspect the complete "
        "transcript and page for printed continuation evidence."
    )

    system_prompt = PAGE_STRUCTURING_PROMPT.format(
        ocr_text=ocr_text,
        known_continuations=known_continuations,
    )
    system_prompt = f"{system_prompt}\n\n{PAGE_LAYOUT_SUPPLEMENT}"

    generation_config = GenerationConfig(
        system_instruction=system_prompt,
        response_mime_type="application/json",
        response_schema=PageContent,
        max_output_tokens=65536,
    )

    structuring_timer = StageTimer().start()
    response = generate_with_retry(
        client,
        model=model_name("page_structuring"),
        contents=[image_part(image), "Structure this pre-extracted OCR text into articles, ads, and other content."],
        config=generation_config,
        stage="page_structuring",
        response_validator=lambda candidate: getattr(candidate, "parsed", None) is not None,
        max_schema_retries=1,
    )
    structuring_elapsed = structuring_timer.stop()

    parsed: PageContent = require_parsed(response, stage="page_structuring")
    usage = response.usage_metadata
    if usage:
        substep(f"Tokens: {usage.prompt_token_count} in, {usage.candidates_token_count} out, {usage.total_token_count} total")
    else:
        substep("Tokens: unavailable")

    if diag is not None and usage:
        # Added, not replaced: a page that is structured twice pays for both calls.
        diag.structuring_tokens = diag.structuring_tokens + TokenUsage.from_metadata(usage)
        diag.timings["structuring"] = structuring_elapsed

    _sanitize_null_strings(parsed)
    page_content = deduplicate_articles(parsed, diag=diag)

    page_content = postprocess_page_content(page_content, diag=diag)

    filename_page = _extract_page_number_from_filename(os.path.basename(image_path))
    if filename_page:
        page_content.page_number = filename_page
    return page_content, image, regions


__all__ = [
    "_extract_page_number_from_filename",
    "_format_page_text",
    "structure_page",
]
