"""Application-layer runtime for ad enrichment."""

from __future__ import annotations

import json
import os
import re
import tempfile
import time
import unicodedata
from collections.abc import Callable
from typing import Any

from ..config.model_calls import build_generation_config, model_name
from ..contracts.ad_models import AdEnrichmentDeltasResponse, EnrichedAd
from ..recognition.ad_prompts import ENRICHMENT_SYSTEM_PROMPT, ENRICHMENT_USER_TEMPLATE
from ..shared.console import error, file_written, info, status, substep, warning
from ..shared.retry import gemini_generate_with_retry


_MAX_ADS_PER_CALL = 50
TelemetryHook = Callable[[dict[str, Any]], None]
_SUMMARY_CONNECTORS = {
    "a", "an", "and", "at", "by", "for", "from", "in", "is", "of", "on",
    "or", "the", "to", "with",
}


def _token_counts(usage: object | None) -> dict[str, int]:
    return {
        "prompt_tokens": int(getattr(usage, "prompt_token_count", 0) or 0),
        "candidates_tokens": int(getattr(usage, "candidates_token_count", 0) or 0),
        "thoughts_tokens": int(getattr(usage, "thoughts_token_count", 0) or 0),
        "tool_use_prompt_tokens": int(
            getattr(usage, "tool_use_prompt_token_count", 0) or 0
        ),
        "cached_content_tokens": int(
            getattr(usage, "cached_content_token_count", 0) or 0
        ),
        "total_tokens": int(getattr(usage, "total_token_count", 0) or 0),
    }


def _emit_telemetry(
    telemetry_hook: TelemetryHook | None,
    *,
    status_value: str,
    call_index: int,
    call_count: int,
    item_count: int,
    elapsed_seconds: float,
    usage: object | None = None,
    error_message: str = "",
) -> None:
    if telemetry_hook is None:
        return
    event = {
        "stage": "ad_enrichment",
        "model": model_name("ad_enrichment"),
        "status": status_value,
        "call_index": call_index,
        "call_count": call_count,
        "item_count": item_count,
        "elapsed_seconds": elapsed_seconds,
        "tokens": _token_counts(usage),
        "error": error_message,
    }
    try:
        telemetry_hook(event)
    except Exception as exc:
        warning(f"Ad-enrichment telemetry hook failed: {exc}")


def _normalized_evidence(value: str) -> str:
    text = unicodedata.normalize("NFKC", value or "").casefold()
    return re.sub(r"[^\w]+", "", text)


def _source_supported(value: str, source: str) -> bool:
    """Allow formatting changes, but never facts absent from the source ad."""
    if not value:
        return True
    normalized_value = _normalized_evidence(value)
    return bool(normalized_value) and normalized_value in _normalized_evidence(source)


def _display_text_supported(value: str, source: str) -> bool:
    """Reject summaries that introduce unsupported content words or numbers."""
    if not value:
        return True
    output_tokens = re.findall(r"[\w$.-]+", unicodedata.normalize("NFKC", value).casefold())
    source_tokens = set(
        re.findall(r"[\w$.-]+", unicodedata.normalize("NFKC", source).casefold())
    )
    meaningful = [token for token in output_tokens if token not in _SUMMARY_CONNECTORS]
    if not meaningful:
        return False
    supported = sum(token in source_tokens for token in meaningful)
    if supported / len(meaningful) < 0.8:
        return False
    source_digits = re.sub(r"\D", "", source)
    return all(
        re.sub(r"\D", "", token) in source_digits
        for token in meaningful
        if any(character.isdigit() for character in token)
    )


def _delta_response_is_complete(response, expected_ids: list[str]) -> bool:
    parsed = getattr(response, "parsed", None)
    if not isinstance(parsed, AdEnrichmentDeltasResponse):
        return False
    returned = [delta.ad_id for delta in parsed.ads]
    return len(returned) == len(expected_ids) and set(returned) == set(expected_ids)


def enrich_edition(
    edition_path: str,
    client,
    force: bool = False,
    telemetry_hook: TelemetryHook | None = None,
) -> tuple[bool, int, float]:
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

    call_start = time.time()
    total_tokens = 0
    enriched_by_id: dict[str, dict] = {}
    call_count = (len(ads) + _MAX_ADS_PER_CALL - 1) // _MAX_ADS_PER_CALL

    for batch_start in range(0, len(ads), _MAX_ADS_PER_CALL):
        source_batch = ads[batch_start : batch_start + _MAX_ADS_PER_CALL]
        call_index = batch_start // _MAX_ADS_PER_CALL + 1
        request_ads = []
        expected_ids = []
        for offset, ad in enumerate(source_batch):
            ad_id = f"ad-{batch_start + offset}"
            expected_ids.append(ad_id)
            request_ads.append(
                {
                    "ad_id": ad_id,
                    "business_name": ad.get("business_name", ""),
                    "body": ad.get("body", ""),
                    "image_files": ad.get("image_files", []),
                }
            )

        user_message = ENRICHMENT_USER_TEMPLATE.format(
            ads_json=json.dumps(request_ads, indent=2)
        )
        generation_config = build_generation_config(
            "ad_enrichment",
            system_instruction=ENRICHMENT_SYSTEM_PROMPT,
            response_mime_type="application/json",
            response_schema=AdEnrichmentDeltasResponse,
            max_output_tokens=65536,
        )
        def validator(candidate, ids=tuple(expected_ids)) -> bool:
            return _delta_response_is_complete(candidate, list(ids))
        batch_call_start = time.time()
        try:
            response = gemini_generate_with_retry(
                client,
                model=model_name("ad_enrichment"),
                contents=[user_message],
                config=generation_config,
                stage="ad_enrichment",
                response_validator=validator,
                max_schema_retries=1,
            )
        except Exception as exc:
            call_elapsed = time.time() - call_start
            _emit_telemetry(
                telemetry_hook,
                status_value="error",
                call_index=call_index,
                call_count=call_count,
                item_count=len(source_batch),
                elapsed_seconds=time.time() - batch_call_start,
                error_message=str(exc),
            )
            error(f"Ad enrichment failed; preserving raw ads unchanged: {exc}")
            return False, total_tokens, call_elapsed

        usage = getattr(response, "usage_metadata", None)
        if usage:
            total_tokens += getattr(usage, "total_token_count", 0) or 0
            substep(
                f"Ad batch tokens: {getattr(usage, 'prompt_token_count', 0) or 0} in, "
                f"{getattr(usage, 'candidates_token_count', 0) or 0} out"
            )
        if not validator(response):
            call_elapsed = time.time() - call_start
            _emit_telemetry(
                telemetry_hook,
                status_value="error",
                call_index=call_index,
                call_count=call_count,
                item_count=len(source_batch),
                elapsed_seconds=time.time() - batch_call_start,
                usage=usage,
                error_message="structured response incomplete",
            )
            error("Ad enrichment contract remained incomplete; preserving raw ads unchanged")
            return False, total_tokens, call_elapsed

        _emit_telemetry(
            telemetry_hook,
            status_value="success",
            call_index=call_index,
            call_count=call_count,
            item_count=len(source_batch),
            elapsed_seconds=time.time() - batch_call_start,
            usage=usage,
        )

        for delta in response.parsed.ads:
            enriched_by_id[delta.ad_id] = delta.model_dump()

    call_elapsed = time.time() - call_start
    enriched_list = []
    for index, source_ad in enumerate(ads):
        delta = enriched_by_id[f"ad-{index}"]
        source_text = " ".join(
            [source_ad.get("business_name", ""), source_ad.get("body", "")]
        )
        for field in ("phone", "address", "price"):
            if not _source_supported(delta[field], source_text):
                delta[field] = ""
        if not _display_text_supported(delta["display_text"], source_text):
            delta["display_text"] = ""
        enriched_list.append(
            EnrichedAd(
                business_name=source_ad.get("business_name", ""),
                body=source_ad.get("body", ""),
                image_files=list(source_ad.get("image_files", [])),
                category=delta["category"],
                ad_type=delta["ad_type"],
                display_text=delta["display_text"],
                phone=delta["phone"],
                address=delta["address"],
                price=delta["price"],
            ).model_dump()
        )

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
    # Explicit prefix avoids collisions when two processes touch the same
    # edition directory concurrently. See docs/issues/0020.
    tmp_fd, tmp_path = tempfile.mkstemp(
        dir=os.path.dirname(edition_path), prefix="ads_", suffix=".json"
    )
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
            json.dump(edition, f, indent=2)
        os.replace(tmp_path, edition_path)
    except BaseException:
        os.unlink(tmp_path)
        raise

    file_written("Edition", edition_path)
    return True, total_tokens, call_elapsed


__all__ = ["enrich_edition"]
