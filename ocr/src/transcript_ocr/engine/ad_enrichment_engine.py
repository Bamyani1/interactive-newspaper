"""Compatibility engine shim for ad enrichment."""

from __future__ import annotations

from ..application.ad_enrichment import EDITIONS_DIR, enrich_edition, main
from ..config.constants import GEMINI_AD_ENRICHMENT_MODEL as GEMINI_MODEL
from ..contracts.ad_models import EnrichedAd, EnrichedAdsResponse
from ..recognition.ad_prompts import ENRICHMENT_PROMPT, SAFETY_OFF

__all__ = [
    "EDITIONS_DIR",
    "ENRICHMENT_PROMPT",
    "GEMINI_MODEL",
    "SAFETY_OFF",
    "EnrichedAd",
    "EnrichedAdsResponse",
    "enrich_edition",
    "main",
]
