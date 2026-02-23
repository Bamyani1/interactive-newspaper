"""Prompt constants for ad enrichment."""

from __future__ import annotations

from google.genai import types

SAFETY_OFF = [
    types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_CIVIC_INTEGRITY", threshold="OFF"),
]

ENRICHMENT_PROMPT = """\
You are processing advertisements extracted from a historical college newspaper (The Transcript, Ohio Wesleyan University).

For each ad below, return an enriched version with:
1. **category**: One of: Food & Drink, Entertainment, Services, Retail, Greek Life, Jobs, Housing, Education, Events, Other
2. **ad_type**: IMPORTANT — use "classified" ONLY for brief text-only listings: job postings, housing want-ads, items for sale, personal notices (typically 1-3 short sentences, no branding or imagery). Everything else is "display" — any ad with a business name, branding, promotional offers, product descriptions, or visual layout is "display". When in doubt, use "display".
3. **display_text**: A condensed version (~150 chars max) that captures the key message. Write it as a clean, readable summary — not raw OCR text. Include the business name and main offer/service.
4. **phone**: Extract phone number if present, otherwise ""
5. **address**: Extract street address if present, otherwise ""
6. **price**: Extract any pricing info if present, otherwise ""

Preserve the original business_name, body, and image_files exactly as given.

Ads to enrich:
{ads_json}
"""

__all__ = ["ENRICHMENT_PROMPT", "SAFETY_OFF"]
