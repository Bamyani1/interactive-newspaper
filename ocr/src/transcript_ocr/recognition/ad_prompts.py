"""Prompt constants for ad enrichment — loaded from ocr/src/prompts.json."""

from __future__ import annotations

from google.genai import types

from ..config.prompts_loader import PROMPTS

SAFETY_OFF = [
    types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_CIVIC_INTEGRITY", threshold="OFF"),
]

ENRICHMENT_SYSTEM_PROMPT = PROMPTS["ad_enrichment_system"]
ENRICHMENT_USER_TEMPLATE = PROMPTS["ad_enrichment_user_template"]

__all__ = ["ENRICHMENT_SYSTEM_PROMPT", "ENRICHMENT_USER_TEMPLATE", "SAFETY_OFF"]
