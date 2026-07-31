"""Prompt and safety settings constants — loaded from ocr/src/prompts.json."""

from __future__ import annotations

from ..config.model_calls import SAFETY_OFF
from ..config.prompts_loader import PROMPTS

IMAGE_MATCHING_PROMPT = PROMPTS["image_matching"]
MERGE_SYSTEM_PROMPT = PROMPTS["merge_system"]
MERGE_USER_TEMPLATE = PROMPTS["merge_user_template"]
DOCAI_SYSTEM_PROMPT = PROMPTS["page_structuring"]
PAGE_LAYOUT_SUPPLEMENT = PROMPTS["page_layout_supplement"]

__all__ = [
    "DOCAI_SYSTEM_PROMPT",
    "IMAGE_MATCHING_PROMPT",
    "MERGE_SYSTEM_PROMPT",
    "MERGE_USER_TEMPLATE",
    "PAGE_LAYOUT_SUPPLEMENT",
    "SAFETY_OFF",
]
