"""Prompt and safety settings constants — loaded from ocr/src/prompts.json."""

from __future__ import annotations

from google.genai import types

from ..config.prompts_loader import PROMPTS

IMAGE_MATCHING_PROMPT = PROMPTS["image_matching"]
MERGE_SYSTEM_PROMPT = PROMPTS["merge_system"]
MERGE_USER_TEMPLATE = PROMPTS["merge_user_template"]
DOCAI_SYSTEM_PROMPT = PROMPTS["page_structuring"]

SAFETY_OFF = [
    types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_CIVIC_INTEGRITY", threshold="OFF"),
]

__all__ = ["DOCAI_SYSTEM_PROMPT", "IMAGE_MATCHING_PROMPT", "MERGE_SYSTEM_PROMPT", "MERGE_USER_TEMPLATE", "SAFETY_OFF"]
