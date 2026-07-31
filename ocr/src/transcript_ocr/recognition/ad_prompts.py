"""Prompt constants for ad enrichment — loaded from ocr/src/prompts.json."""

from __future__ import annotations

from ..config.model_calls import SAFETY_OFF
from ..config.prompts_loader import PROMPTS

ENRICHMENT_SYSTEM_PROMPT = PROMPTS["ad_enrichment_system"]
ENRICHMENT_USER_TEMPLATE = PROMPTS["ad_enrichment_user_template"]

__all__ = ["ENRICHMENT_SYSTEM_PROMPT", "ENRICHMENT_USER_TEMPLATE", "SAFETY_OFF"]
