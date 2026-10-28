"""Prompt constants — loaded from ocr/src/prompts.json."""

from __future__ import annotations

from ..config.prompts_loader import PROMPTS

IMAGE_MATCHING_PROMPT = PROMPTS["image_matching"]
MERGE_SYSTEM_PROMPT = PROMPTS["merge_system"]
MERGE_USER_TEMPLATE = PROMPTS["merge_user_template"]
PAGE_STRUCTURING_PROMPT = PROMPTS["page_structuring"]
PAGE_LAYOUT_SUPPLEMENT = PROMPTS["page_layout_supplement"]

__all__ = [
    "IMAGE_MATCHING_PROMPT",
    "MERGE_SYSTEM_PROMPT",
    "MERGE_USER_TEMPLATE",
    "PAGE_LAYOUT_SUPPLEMENT",
    "PAGE_STRUCTURING_PROMPT",
]
