"""Prompt constants for content triage — loaded from ocr/src/prompts.json."""

from __future__ import annotations

from ..config.prompts_loader import PROMPTS

TRIAGE_SYSTEM_PROMPT = PROMPTS["content_triage_system"]
TRIAGE_USER_TEMPLATE = PROMPTS["content_triage_user_template"]

__all__ = ["TRIAGE_SYSTEM_PROMPT", "TRIAGE_USER_TEMPLATE"]
