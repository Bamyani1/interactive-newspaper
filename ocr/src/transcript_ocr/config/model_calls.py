"""Shared, locked Gemini call configuration for OCR stages.

This module deliberately owns the generation settings that must be identical
across callers.  Stage prompts and response schemas remain with their owning
modules; authentication, model routing, thinking, safety, determinism, and
per-image media resolution do not.
"""

from __future__ import annotations

import io
import os
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

# Every stage runs on Claude. OCR_LLM_PROVIDER=gemini keeps the old route until it is deleted.
CLAUDE_MODELS = {
    # Claude-only stage: reads the page text that Document AI used to supply.
    "text_reading": {"name": "claude-haiku-5-5", "effort": "xhigh"},
    "page_structuring": {"name": "claude-haiku-5-5", "effort": "xhigh"},
    "image_matching": {"name": "claude-haiku-5-5", "effort": "high"},
    "merge": {"name": "claude-sonnet-5-5", "effort": "high"},
    "seam_repair": {"name": "claude-sonnet-5-5", "effort": "high"},
    "ad_enrichment": {"name": "claude-haiku-5-5", "effort": "high"},
    "content_triage": {"name": "claude-haiku-5-5", "effort": "high"},
}

# Claude streams, so the budget covers long thinking instead of a 504 at 240 s.
CLAUDE_STAGE_TIMEOUT_SECONDS = {
    "text_reading": 600,
    "page_structuring": 900,
    "image_matching": 600,
    "merge": 900,
    "seam_repair": 600,
    "ad_enrichment": 300,
    "content_triage": 300,
}


def llm_provider() -> str:
    provider = os.getenv("OCR_LLM_PROVIDER", "claude").strip().lower() or "claude"
    if provider not in {"gemini", "claude"}:
        raise ValueError(f"OCR_LLM_PROVIDER must be gemini or claude, got {provider!r}")
    return provider


def uses_claude() -> bool:
    return llm_provider() == "claude"


def stage_timeout_seconds(stage: str) -> int:
    if uses_claude():
        return CLAUDE_STAGE_TIMEOUT_SECONDS.get(stage, 600)
    return STAGE_TIMEOUT_SECONDS.get(stage, 240)


def model_routes() -> dict[str, dict]:
    return CLAUDE_MODELS if uses_claude() else MODELS


def build_generation_config(
    stage: str,
    *,
    response_schema: Any | None = None,
    response_mime_type: str | None = None,
    system_instruction: str | None = None,
    max_output_tokens: int,
    seed: int = 0,
) -> types.GenerateContentConfig:
    """Build the deterministic generation config locked for an OCR stage.

    Sampling controls are intentionally absent.  Callers should not append
    temperature, top-p, or top-k overrides after using this helper.  A fixed
    seed repeats the same answer, so a deliberate second sample needs a new one.
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
        seed=seed,
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
    return str(model_routes()[stage]["name"])


__all__ = [
    "CLAUDE_MODELS",
    "CLAUDE_STAGE_TIMEOUT_SECONDS",
    "SAFETY_OFF",
    "STAGE_TIMEOUT_SECONDS",
    "build_generation_config",
    "image_part_ultra_high",
    "llm_provider",
    "model_name",
    "model_routes",
    "stage_timeout_seconds",
    "uses_claude",
]
