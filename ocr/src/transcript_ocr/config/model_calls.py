"""Shared, locked Gemini call configuration for OCR stages.

This module deliberately owns the generation settings that must be identical
across callers.  Stage prompts and response schemas remain with their owning
modules; authentication, model routing, thinking, safety, determinism, and
per-image media resolution do not.
"""

from __future__ import annotations

import io
from typing import Any

from PIL import Image
from google.genai import types

from .prompts_loader import MODELS


SAFETY_OFF = [
    types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_CIVIC_INTEGRITY", threshold="OFF"),
]


STAGE_TIMEOUT_SECONDS = {
    "page_structuring": 240,
    "image_matching": 180,
    "merge": 240,
    "seam_repair": 240,
    "ad_enrichment": 120,
    "content_triage": 120,
}


def build_generation_config(
    stage: str,
    *,
    response_schema: Any | None = None,
    response_mime_type: str | None = None,
    system_instruction: str | None = None,
    max_output_tokens: int,
) -> types.GenerateContentConfig:
    """Build the deterministic generation config locked for an OCR stage.

    Sampling controls are intentionally absent.  Callers should not append
    temperature, top-p, or top-k overrides after using this helper.
    """
    model_config = MODELS[stage]
    thinking = types.ThinkingConfig(
        thinking_level=model_config["thinking"],
        include_thoughts=False,
    )
    return types.GenerateContentConfig(
        system_instruction=system_instruction,
        response_mime_type=response_mime_type,
        response_schema=response_schema,
        safety_settings=SAFETY_OFF,
        candidate_count=1,
        seed=0,
        max_output_tokens=max_output_tokens,
        thinking_config=thinking,
    )


def image_part_ultra_high(image: Image.Image) -> types.Part:
    """Encode one image losslessly and set ULTRA_HIGH on this exact part."""
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return types.Part.from_bytes(
        data=buffer.getvalue(),
        mime_type="image/png",
        media_resolution=types.PartMediaResolutionLevel.MEDIA_RESOLUTION_ULTRA_HIGH,
    )


def model_name(stage: str) -> str:
    return str(MODELS[stage]["name"])


__all__ = [
    "SAFETY_OFF",
    "STAGE_TIMEOUT_SECONDS",
    "build_generation_config",
    "image_part_ultra_high",
    "model_name",
]
