"""Application-layer runtime for ad enrichment."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
import time
from pathlib import Path

from ..config.constants import GEMINI_AD_ENRICHMENT_MODEL
from ..contracts.ad_models import EnrichedAdsResponse
from ..recognition.ad_prompts import ENRICHMENT_PROMPT, SAFETY_OFF
from ..shared.console import status, substep, success, warning, error, info, file_written
from ..shared.retry import gemini_generate_with_retry

OCR_ROOT = Path(__file__).resolve().parents[3]
REPO_ROOT = OCR_ROOT.parent
EDITIONS_DIR = os.path.join(str(REPO_ROOT), "public", "editions")


def enrich_edition(edition_path: str, client, force: bool = False) -> tuple[bool, int, float]:
    """Enrich ads for a single edition. Returns (performed, tokens, elapsed_s)."""
    try:
        with open(edition_path, "r", encoding="utf-8") as f:
            edition = json.load(f)
    except json.JSONDecodeError as e:
        error(f"Malformed JSON in {edition_path}: {e}")
        return False, 0, 0.0

    edition_date = edition.get("edition_date", os.path.basename(os.path.dirname(edition_path)))

    if not force and "enriched_ads" in edition:
        info(f"{edition_date}: Already enriched ({len(edition['enriched_ads'])} ads), skipping")
        return False, 0, 0.0

    ads = edition.get("ads", [])
    if not ads:
        info(f"{edition_date}: No ads to enrich")
        return False, 0, 0.0

    status(f"{edition_date}: Enriching {len(ads)} ads...")

    ads_json = json.dumps(ads, indent=2)
    prompt = ENRICHMENT_PROMPT.format(ads_json=ads_json)

    from google.genai import types  # lazy: avoid import failure when google-genai not installed

    call_start = time.time()
    response = gemini_generate_with_retry(
        client,
        model=GEMINI_AD_ENRICHMENT_MODEL,
        contents=[prompt],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=EnrichedAdsResponse,
            safety_settings=SAFETY_OFF,
            max_output_tokens=32768,
        ),
    )
    call_elapsed = time.time() - call_start

    usage = response.usage_metadata
    total_tokens = usage.total_token_count if usage else 0
    if usage:
        substep(f"Tokens: {usage.prompt_token_count} in, {usage.candidates_token_count} out | Time: {call_elapsed:.1f}s")
    else:
        substep(f"Tokens: unavailable | Time: {call_elapsed:.1f}s")

    if not response.parsed:
        error("Response was empty or blocked")
        return False, total_tokens, call_elapsed

    enriched: EnrichedAdsResponse = response.parsed
    enriched_list = [ad.model_dump() for ad in enriched.enriched_ads]

    if len(enriched_list) != len(ads):
        error(f"Got {len(enriched_list)} enriched ads but expected {len(ads)}, refusing to write")
        return False, total_tokens, call_elapsed

    categories = {}
    types_count = {"display": 0, "classified": 0}
    for ad in enriched_list:
        cat = ad.get("category", "Other")
        categories[cat] = categories.get(cat, 0) + 1
        ad_type = ad.get("ad_type", "classified")
        types_count[ad_type] = types_count.get(ad_type, 0) + 1

    substep(f"Types: {types_count['display']} display, {types_count['classified']} classified")
    substep(f"Categories: {', '.join(f'{k}({v})' for k, v in sorted(categories.items()))}")

    edition["enriched_ads"] = enriched_list
    tmp_fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(edition_path), suffix=".json")
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
            json.dump(edition, f, indent=2)
        os.replace(tmp_path, edition_path)
    except BaseException:
        os.unlink(tmp_path)
        raise

    file_written("Edition", edition_path)
    return True, total_tokens, call_elapsed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Enrich ads in edition.json files")
    parser.add_argument("--date", help="Enrich a specific edition by date (e.g. 1988-10-12)")
    parser.add_argument("--force", action="store_true", help="Re-enrich already enriched editions")
    parser.add_argument(
        "--editions-dir",
        default=EDITIONS_DIR,
        help="Directory containing edition subfolders (default: public/editions)",
    )
    args = parser.parse_args(argv)

    from google import genai  # lazy: avoid import failure when google-genai not installed

    client = genai.Client()
    editions_dir = args.editions_dir

    total_tokens = 0
    total_time = 0.0

    if args.date:
        edition_path = os.path.join(editions_dir, args.date, "edition.json")
        if not os.path.exists(edition_path):
            error(f"Edition not found: {edition_path}")
            return 1
        _performed, tokens, elapsed = enrich_edition(edition_path, client, force=args.force)
        total_tokens += tokens
        total_time += elapsed
    else:
        enriched_count = 0
        for entry in sorted(os.listdir(editions_dir)):
            edition_path = os.path.join(editions_dir, entry, "edition.json")
            if os.path.isfile(edition_path):
                performed, tokens, elapsed = enrich_edition(edition_path, client, force=args.force)
                total_tokens += tokens
                total_time += elapsed
                if performed:
                    enriched_count += 1

        success(f"Done: {enriched_count} edition(s) enriched")

    info(f"Total: {total_tokens} tokens, {total_time:.1f}s")
    return 0


__all__ = ["EDITIONS_DIR", "enrich_edition", "main"]
