"""Shared, locked Claude call configuration for OCR stages.

This module deliberately owns the settings that must be identical across
callers.  Stage prompts and response schemas remain with their owning
modules; model routing, effort, timeouts and image encoding do not.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Any

from PIL import Image


CLAUDE_MODELS = {
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


@dataclass(frozen=True)
class GenerationConfig:
    """One stage request's output contract; there are no sampling controls."""

    max_output_tokens: int
    response_schema: Any | None = None
    response_mime_type: str | None = None
    system_instruction: str | None = None


@dataclass(frozen=True)
class ImagePart:
    """One image in a request's contents."""

    data: bytes
    mime_type: str = "image/png"


def stage_timeout_seconds(stage: str) -> int:
    return CLAUDE_STAGE_TIMEOUT_SECONDS.get(stage, 600)


def model_routes() -> dict[str, dict]:
    return CLAUDE_MODELS


def image_part(image: Image.Image) -> ImagePart:
    """Encode one image losslessly."""
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return ImagePart(data=buffer.getvalue())


def model_name(stage: str) -> str:
    return str(CLAUDE_MODELS[stage]["name"])


__all__ = [
    "CLAUDE_MODELS",
    "CLAUDE_STAGE_TIMEOUT_SECONDS",
    "GenerationConfig",
    "ImagePart",
    "image_part",
    "model_name",
    "model_routes",
    "stage_timeout_seconds",
]
