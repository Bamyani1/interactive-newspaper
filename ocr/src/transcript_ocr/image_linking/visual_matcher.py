"""Visual matcher for image-region assignment."""

from __future__ import annotations

import io

from PIL import Image
from google.genai import types

from ..config.prompts_loader import MODELS
from ..contracts.content_models import ImageRegionAssignments, PageContent
from ..contracts.diagnostics_models import PageDiagnostics, StageTimer, TokenUsage
from ..recognition.prompts import IMAGE_MATCHING_PROMPT, SAFETY_OFF
from ..shared.console import substep, warning, error
from ..shared.retry import gemini_generate_with_retry


def match_images_visual(
    client,
    annotated_image: Image.Image,
    page_content: PageContent,
    num_regions: int,
    diag: PageDiagnostics | None = None,
) -> ImageRegionAssignments | None:
    """Classify and match all CV-detected image regions to articles/ads."""
    timer = StageTimer().start()

    if diag is not None:
        diag.visual_matching.attempted = True

    parts = []
    for i, article in enumerate(page_content.articles):
        headline = article.headline or "(no headline)"
        preview = article.body[:400].replace("\n", " ").strip()
        parts.append(f"  Article [{i}]: {headline}")
        if preview:
            parts.append(f"    Preview: {preview}...")
        if article.images:
            for img in article.images:
                cap = img if isinstance(img, str) else getattr(img, "caption", "")
                if cap:
                    cap_text = cap[:200] if isinstance(cap, str) else str(cap)[:200]
                    parts.append(f"    Extracted caption: {cap_text}")

    for i, ad in enumerate(page_content.ads):
        preview = ad.body[:200].replace("\n", " ").strip()
        parts.append(f"  Ad [{i}]: {ad.business_name}")
        if preview:
            parts.append(f"    Preview: {preview}...")

    content_list = "\n".join(parts) if parts else "  (no articles or ads extracted)"
    prompt = IMAGE_MATCHING_PROMPT.format(content_list=content_list, num_regions=num_regions)

    try:
        img_model_cfg = MODELS["image_matching"]
        img_thinking = types.ThinkingConfig(thinking_level=img_model_cfg["thinking"]) if img_model_cfg.get("thinking") else None

        # Encode image to optimized PNG bytes — avoids SDK's wasteful re-encoding
        buf = io.BytesIO()
        annotated_image.save(buf, format="PNG", optimize=True)
        image_part = types.Part.from_bytes(data=buf.getvalue(), mime_type="image/png")

        response = gemini_generate_with_retry(
            client,
            model=img_model_cfg["name"],
            contents=[image_part, prompt],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=ImageRegionAssignments,
                safety_settings=SAFETY_OFF,
                media_resolution=types.MediaResolution.MEDIA_RESOLUTION_HIGH,
                max_output_tokens=65536,
                **({"thinking_config": img_thinking} if img_thinking else {}),
            ),
        )

        usage = response.usage_metadata
        if usage:
            substep(f"Visual matching tokens: {usage.prompt_token_count} in, {usage.candidates_token_count} out")
            if diag is not None:
                diag.visual_matching.tokens = TokenUsage(
                    prompt_tokens=usage.prompt_token_count,
                    candidates_tokens=usage.candidates_token_count,
                    total_tokens=usage.total_token_count,
                )

        if diag is not None:
            diag.timings["visual_matching"] = timer.stop()

        if response.parsed:
            if diag is not None:
                diag.visual_matching.succeeded = True
            return response.parsed

        warning("Visual matching response was empty or blocked")
        return None

    except Exception as e:
        error(f"Visual matching failed: {e}")
        if diag is not None:
            diag.timings["visual_matching"] = timer.stop()
        return None


__all__ = ["match_images_visual"]
