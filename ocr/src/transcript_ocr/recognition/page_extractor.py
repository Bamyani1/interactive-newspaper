"""Full-page recognition path."""

from __future__ import annotations

import io
import os

from PIL import Image
from google.genai import types

from ..config.prompts_loader import MODELS
from ..contracts.content_models import PageContent
from ..contracts.diagnostics_models import PageDiagnostics, StageTimer, TokenUsage
from ..diagnostics.snapshots import save_snapshot
from ..postprocessing.ad_reclassification import postprocess_page_content
from ..postprocessing.deduplication import deduplicate_articles
from ..postprocessing.null_sanitizer import _sanitize_null_strings
from ..shared.retry import gemini_generate_with_retry
from .prompts import DOCAI_SYSTEM_PROMPT, SAFETY_OFF
from ..shared.console import substep, warning


def _extract_page_number_from_filename(filename: str) -> str:
    """Extract page number from filenames like 'Page 03.jpg' or 'Page03.tiff'."""
    import re

    match = re.search(r"Page\s*0*(\d+)", filename, re.IGNORECASE)
    return match.group(1) if match else ""


def process_page_with_docai(
    client,
    image_path: str,
    docai_result,
    preprocessed_image: Image.Image,
    regions: list[tuple[int, int, int, int]],
    diag: PageDiagnostics | None = None,
    snapshots_dir: str | None = None,
) -> tuple[PageContent, Image.Image, list[tuple[int, int, int, int]]]:
    """
    Send a preprocessed page image to Gemini for structuring, with OCR text pre-extracted
    by Document AI. Gemini structures the provided text into articles/ads — it does not
    re-read characters off the image.

    Uses the preprocessed image and regions from Phase 1 — does NOT reprocess.
    """
    image = preprocessed_image

    # Format DocAI text for the prompt
    if docai_result.paragraphs:
        ocr_text = "\n\n".join(docai_result.paragraphs)
    else:
        ocr_text = docai_result.raw_text

    if docai_result.continuation_markers:
        known_continuations = "\n".join(f"- {m}" for m in docai_result.continuation_markers)
    else:
        known_continuations = "(none detected — scan column bottoms carefully for continuation markers)"

    system_prompt = DOCAI_SYSTEM_PROMPT.format(
        ocr_text=ocr_text,
        known_continuations=known_continuations,
    )

    structuring_cfg = MODELS["page_structuring"]
    structuring_thinking = types.ThinkingConfig(thinking_level=structuring_cfg["thinking"]) if structuring_cfg.get("thinking") else None

    # Encode image to optimized PNG bytes — avoids SDK's wasteful re-encoding
    buf = io.BytesIO()
    image.save(buf, format="PNG", optimize=True)
    image_part = types.Part.from_bytes(data=buf.getvalue(), mime_type="image/png")

    gemini_timer = StageTimer().start()
    response = gemini_generate_with_retry(
        client,
        model=structuring_cfg["name"],
        contents=[image_part, "Structure this pre-extracted OCR text into articles, ads, and other content."],
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            response_mime_type="application/json",
            response_schema=PageContent,
            safety_settings=SAFETY_OFF,
            media_resolution=types.MediaResolution.MEDIA_RESOLUTION_HIGH,
            max_output_tokens=65536,
            **({"thinking_config": structuring_thinking} if structuring_thinking else {}),
        ),
    )
    gemini_elapsed = gemini_timer.stop()

    usage = response.usage_metadata
    if usage:
        substep(f"Tokens: {usage.prompt_token_count} in, {usage.candidates_token_count} out, {usage.total_token_count} total")
    else:
        substep("Tokens: unavailable")

    if diag is not None and usage:
        diag.gemini_tokens = TokenUsage(
            prompt_tokens=usage.prompt_token_count,
            candidates_tokens=usage.candidates_token_count,
            total_tokens=usage.total_token_count,
        )
        diag.timings["gemini"] = gemini_elapsed

    if response.parsed:
        # Defensive getattr: even inside the `if response.parsed:` guard, use
        # getattr with a default so a future refactor that moves this out of
        # the guard (or a Gemini response shape shift) can't crash the page
        # with an opaque AttributeError. See docs/issues/0008.
        page_num = (
            _extract_page_number_from_filename(os.path.basename(image_path))
            or getattr(response.parsed, "page_number", None)
            or "0"
        )
        save_snapshot(snapshots_dir, f"raw_gemini_page{page_num}.json", response.parsed)

        _sanitize_null_strings(response.parsed)
        page_content = deduplicate_articles(response.parsed, diag=diag)
        save_snapshot(snapshots_dir, f"post_dedup_page{page_num}.json", page_content)

        page_content = postprocess_page_content(page_content, diag=diag)
        save_snapshot(snapshots_dir, f"post_process_page{page_num}.json", page_content)

        filename_page = _extract_page_number_from_filename(os.path.basename(image_path))
        if filename_page:
            page_content.page_number = filename_page
        return page_content, image, regions

    # Retry: move OCR text from system_instruction to user contents.
    # The RECITATION filter blocks when system instruction text is reproduced in output.
    # Moving it to user contents signals "data to process" rather than "text to recite".
    warning("Full page blocked (likely RECITATION), retrying with OCR text as user content...")
    try:
        retry_response = gemini_generate_with_retry(
            client,
            model=structuring_cfg["name"],
            contents=[image_part, system_prompt + "\n\nStructure this into articles, ads, and other content."],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=PageContent,
                safety_settings=SAFETY_OFF,
                max_output_tokens=65536,
            ),
        )
        if retry_response.parsed:
            warning("User-content fallback succeeded")
            page_content = retry_response.parsed
            _sanitize_null_strings(page_content)
            page_content = deduplicate_articles(page_content, diag=diag)
            page_content = postprocess_page_content(page_content, diag=diag)
            filename_page = _extract_page_number_from_filename(os.path.basename(image_path))
            if filename_page:
                page_content.page_number = filename_page
            return page_content, image, regions
    except Exception as e:
        warning(f"Text-only fallback also failed: {e}")

    warning("Full page blocked or empty (docai path)")
    return PageContent(articles=[], ads=[], other_content=[], page_number="0", publication_info=""), image, regions


__all__ = [
    "_extract_page_number_from_filename",
    "process_page_with_docai",
]
