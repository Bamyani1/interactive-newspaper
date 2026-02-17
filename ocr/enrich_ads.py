"""
Enrich ads in edition.json files with LLM-generated categories, condensed text,
and extracted contact info. Makes 1 Gemini call per edition.

Usage:
    python ocr/enrich_ads.py                    # enrich all editions
    python ocr/enrich_ads.py --date 1988-10-12  # enrich one edition
    python ocr/enrich_ads.py --force             # re-enrich already enriched editions
"""

import argparse
import json
import os
import sys
import tempfile
import time

from dotenv import load_dotenv
from pydantic import BaseModel
from google import genai
from google.genai import types
from gemini_utils import gemini_generate_with_retry

load_dotenv()

GEMINI_MODEL = "gemini-3-flash-preview"

SAFETY_OFF = [
    types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_CIVIC_INTEGRITY", threshold="OFF"),
]

EDITIONS_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "public", "editions"
)

# ── Pydantic models ──────────────────────────────────────────────────

VALID_CATEGORIES = [
    "Food & Drink", "Entertainment", "Services", "Retail",
    "Greek Life", "Jobs", "Housing", "Education", "Events", "Other",
]


class EnrichedAd(BaseModel):
    business_name: str
    body: str
    image_files: list[str]
    category: str       # one of VALID_CATEGORIES
    ad_type: str        # "display" | "classified"
    display_text: str   # condensed ~150 char version
    phone: str          # extracted or ""
    address: str        # extracted or ""
    price: str          # extracted or ""


class EnrichedAdsResponse(BaseModel):
    enriched_ads: list[EnrichedAd]


# ── Prompt ───────────────────────────────────────────────────────────

ENRICHMENT_PROMPT = """\
You are processing advertisements extracted from a historical college newspaper (Ohio Wesleyan University).

For each ad below, return an enriched version with:
1. **category**: One of: Food & Drink, Entertainment, Services, Retail, Greek Life, Jobs, Housing, Education, Events, Other
2. **ad_type**: "display" if it's a business display ad (has branding, offers, descriptions) or "classified" if it's a brief listing (short text-only notice, want ad, personal)
3. **display_text**: A condensed version (~150 chars max) that captures the key message. Write it as a clean, readable summary — not raw OCR text. Include the business name and main offer/service.
4. **phone**: Extract phone number if present, otherwise ""
5. **address**: Extract street address if present, otherwise ""
6. **price**: Extract any pricing info if present, otherwise ""

Preserve the original business_name, body, and image_files exactly as given.

Ads to enrich:
{ads_json}
"""


def enrich_edition(edition_path: str, client, force: bool = False) -> tuple[bool, int, float]:
    """Enrich ads for a single edition. Returns (performed, tokens, elapsed_s)."""
    try:
        with open(edition_path, "r", encoding="utf-8") as f:
            edition = json.load(f)
    except json.JSONDecodeError as e:
        print(f"  ERROR: Malformed JSON in {edition_path}: {e}")
        return False, 0, 0.0

    edition_date = edition.get("edition_date", os.path.basename(os.path.dirname(edition_path)))

    # Check idempotency
    if not force and "enriched_ads" in edition:
        print(f"  {edition_date}: Already enriched ({len(edition['enriched_ads'])} ads), skipping")
        return False, 0, 0.0

    ads = edition.get("ads", [])
    if not ads:
        print(f"  {edition_date}: No ads to enrich")
        return False, 0, 0.0

    print(f"  {edition_date}: Enriching {len(ads)} ads...")

    # Build prompt with all ads
    ads_json = json.dumps(ads, indent=2)
    prompt = ENRICHMENT_PROMPT.format(ads_json=ads_json)

    call_start = time.time()
    response = gemini_generate_with_retry(
        client,
        model=GEMINI_MODEL,
        contents=[prompt],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=EnrichedAdsResponse,
            safety_settings=SAFETY_OFF,
            max_output_tokens=16384,
        ),
    )
    call_elapsed = time.time() - call_start

    usage = response.usage_metadata
    total_tokens = usage.total_token_count if usage else 0
    if usage:
        print(f"    Tokens: {usage.prompt_token_count} in, {usage.candidates_token_count} out | Time: {call_elapsed:.1f}s")
    else:
        print(f"    Tokens: unavailable | Time: {call_elapsed:.1f}s")

    if not response.parsed:
        print(f"    ERROR: Response was empty or blocked")
        return False, total_tokens, call_elapsed

    enriched: EnrichedAdsResponse = response.parsed
    enriched_list = [ad.model_dump() for ad in enriched.enriched_ads]

    # Validate count matches — refuse to write misaligned data
    if len(enriched_list) != len(ads):
        print(f"    ERROR: Got {len(enriched_list)} enriched ads but expected {len(ads)}, refusing to write")
        return False, total_tokens, call_elapsed

    # Print summary
    categories = {}
    types_count = {"display": 0, "classified": 0}
    for ad in enriched_list:
        cat = ad.get("category", "Other")
        categories[cat] = categories.get(cat, 0) + 1
        ad_type = ad.get("ad_type", "classified")
        types_count[ad_type] = types_count.get(ad_type, 0) + 1

    print(f"    Types: {types_count['display']} display, {types_count['classified']} classified")
    print(f"    Categories: {', '.join(f'{k}({v})' for k, v in sorted(categories.items()))}")

    # Write enriched_ads alongside original ads (atomic write)
    edition["enriched_ads"] = enriched_list
    tmp_fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(edition_path), suffix=".json")
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
            json.dump(edition, f, indent=2)
        os.replace(tmp_path, edition_path)
    except BaseException:
        os.unlink(tmp_path)
        raise

    print(f"    Written to {edition_path}")
    return True, total_tokens, call_elapsed


def main():
    parser = argparse.ArgumentParser(description="Enrich ads in edition.json files")
    parser.add_argument("--date", help="Enrich a specific edition by date (e.g. 1988-10-12)")
    parser.add_argument("--force", action="store_true", help="Re-enrich already enriched editions")
    args = parser.parse_args()

    client = genai.Client()

    total_tokens = 0
    total_time = 0.0

    if args.date:
        edition_path = os.path.join(EDITIONS_DIR, args.date, "edition.json")
        if not os.path.exists(edition_path):
            print(f"Edition not found: {edition_path}")
            sys.exit(1)
        performed, tokens, elapsed = enrich_edition(edition_path, client, force=args.force)
        total_tokens += tokens
        total_time += elapsed
    else:
        # Process all editions
        enriched_count = 0
        for entry in sorted(os.listdir(EDITIONS_DIR)):
            edition_path = os.path.join(EDITIONS_DIR, entry, "edition.json")
            if os.path.isfile(edition_path):
                performed, tokens, elapsed = enrich_edition(edition_path, client, force=args.force)
                total_tokens += tokens
                total_time += elapsed
                if performed:
                    enriched_count += 1

        print(f"\nDone: {enriched_count} edition(s) enriched")

    print(f"Total: {total_tokens} tokens, {total_time:.1f}s")


if __name__ == "__main__":
    main()
