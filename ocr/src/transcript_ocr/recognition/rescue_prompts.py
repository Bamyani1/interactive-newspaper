"""Prompt constants for content triage — loaded from ocr/src/prompts.json."""

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

TRIAGE_SYSTEM_PROMPT = PROMPTS["content_triage_system"]
TRIAGE_USER_TEMPLATE = PROMPTS["content_triage_user_template"]

__all__ = ["SAFETY_OFF", "TRIAGE_SYSTEM_PROMPT", "TRIAGE_USER_TEMPLATE"]
