"""Targeted final type/category review (legacy ``triage`` import retained)."""

from __future__ import annotations

import json
import os
import tempfile
import time
from collections import defaultdict
from collections.abc import Callable
from typing import Any

from ..config.model_calls import build_generation_config, model_name
from ..contracts.content_models import ContentReviewResponse
from ..recognition.rescue_prompts import TRIAGE_SYSTEM_PROMPT, TRIAGE_USER_TEMPLATE
from ..shared.console import error, file_written, info, status, substep, warning
from ..shared.retry import gemini_generate_with_retry
from ..shared.text import normalize_whitespace


_IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff")
_REVIEW_CONFIDENCE = 0.90
_CATEGORY_FALLBACK_FLAGS = (
    "category_fallback",
    "category_fallback_used",
)
_VISUAL_KIND_CONFLICT_FLAGS = (
    "visual_kind_conflict",
    "visual_classification_conflict",
    "visual_type_conflict",
)
_UNRESOLVED_STATE_FIELDS = (
    "state",
    "status",
    "review_state",
    "classification_state",
    "visual_state",
    "visual_type",
    "visual_kind",
    "attachment_state",
    "disposition",
)
TelemetryHook = Callable[[dict[str, Any]], None]


def _is_image_file(body: str) -> bool:
    return body.startswith("images/") or body.lower().endswith(_IMAGE_EXTENSIONS)


def _flag_is_set(item: dict, fields: tuple[str, ...]) -> bool:
    return any(item.get(field) is True for field in fields)


def _has_explicit_unresolved_state(item: dict) -> bool:
    """Recognize only explicit machine state, never prose containing the word."""
    if item.get("unresolved") is True:
        return True
    if any(
        isinstance(item.get(field), str)
        and item[field].strip().casefold() == "unresolved"
        for field in _UNRESOLVED_STATE_FIELDS
    ):
        return True
    states = item.get("unresolved_states")
    return isinstance(states, list) and bool(states)


def _candidate_reasons(
    item_type: str,
    item: dict,
    *,
    exact_cross_array_duplicate: bool,
) -> list[str]:
    """Return only the locked deterministic final-review triggers."""
    reasons: list[str] = []
    body = str(item.get("body") or "").strip()
    if item_type == "article":
        if _flag_is_set(item, _CATEGORY_FALLBACK_FLAGS):
            reasons.append("category_fallback")
        if not str(item.get("headline") or "").strip():
            reasons.append("blank_article_headline")
        if not body:
            reasons.append("blank_article_body")
    elif item_type == "ad":
        business_name = str(item.get("business_name") or "").strip()
        if not business_name and not body:
            reasons.append("blank_ad_business_and_body")

    if exact_cross_array_duplicate:
        reasons.append("exact_cross_array_duplicate_text")
    if _flag_is_set(item, _VISUAL_KIND_CONFLICT_FLAGS):
        reasons.append("visual_kind_conflict")
    if _has_explicit_unresolved_state(item):
        reasons.append("explicit_unresolved_state")
    return reasons


def _exact_cross_array_duplicate_keys(
    collections: tuple[tuple[str, list], ...],
) -> set[str]:
    """Find non-empty body text present in at least two different arrays."""
    types_by_text: dict[str, set[str]] = defaultdict(set)
    for item_type, items in collections:
        for item in items:
            body = str(item.get("body") or "")
            key = normalize_whitespace(body)
            if key and not _is_image_file(key):
                types_by_text[key].add(item_type)
    return {text for text, item_types in types_by_text.items() if len(item_types) >= 2}


def _build_candidates(
    edition: dict,
    review_hints: dict[str, dict[str, Any]] | None = None,
) -> tuple[list[dict], dict[str, tuple[str, int]]]:
    candidates: list[dict] = []
    item_map: dict[str, tuple[str, int]] = {}
    collections = (
        ("article", edition.get("articles", [])),
        ("ad", edition.get("ads", [])),
        ("other", edition.get("other_content", [])),
    )
    review_hints = review_hints or {}
    duplicate_keys = _exact_cross_array_duplicate_keys(collections)
    for item_type, items in collections:
        for index, item in enumerate(items):
            item_id = f"{item_type}-{index}"
            review_item = {**item, **review_hints.get(item_id, {})}
            body_key = normalize_whitespace(str(review_item.get("body") or ""))
            reasons = _candidate_reasons(
                item_type,
                review_item,
                exact_cross_array_duplicate=body_key in duplicate_keys,
            )
            if not reasons:
                continue
            item_map[item_id] = (item_type, index)
            candidates.append(
                {
                    "item_id": item_id,
                    "current_type": item_type,
                    "current_category": item.get("category", "") if item_type == "article" else "",
                    "reasons": reasons,
                    "headline_or_name": item.get("headline") or item.get("business_name") or item.get("title") or "",
                    "author": item.get("author", "") if item_type == "article" else "",
                    "body": item.get("body", ""),
                    "has_images": bool(item.get("image_files")) or _is_image_file(str(item.get("body") or "")),
                }
            )
    return candidates, item_map


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
    elapsed_seconds: float,
    item_count: int,
    usage: object | None = None,
    error_message: str = "",
) -> None:
    if telemetry_hook is None:
        return
    event = {
        "stage": "content_triage",
        "model": model_name("content_triage"),
        "status": status_value,
        "call_index": 1,
        "call_count": 1,
        "item_count": item_count,
        "elapsed_seconds": elapsed_seconds,
        "tokens": _token_counts(usage),
        "error": error_message,
    }
    try:
        telemetry_hook(event)
    except Exception as exc:
        warning(f"Final-review telemetry hook failed: {exc}")


def _review_response_complete(response, candidate_ids: list[str]) -> bool:
    parsed = getattr(response, "parsed", None)
    if not isinstance(parsed, ContentReviewResponse):
        return False
    returned = [decision.item_id for decision in parsed.decisions]
    return len(returned) == len(candidate_ids) and set(returned) == set(candidate_ids)


def _article_from(
    item_type: str,
    item: dict,
    category: str | None,
    source_pages: list[str],
) -> dict:
    if item_type == "article":
        result = dict(item)
        if category:
            result["category"] = category
        return result
    if item_type == "ad":
        return {
            "headline": item.get("business_name", ""),
            "author": "",
            "writer_position": "",
            "category": category or "News",
            "body": item.get("body", ""),
            "images": [],
            "image_files": list(item.get("image_files", [])),
            "continues_on": "",
            "continued_from": "",
            "source_pages": source_pages,
        }

    body = str(item.get("body") or "")
    is_image = _is_image_file(body)
    title = item.get("title", "")
    return {
        "headline": title,
        "author": "",
        "writer_position": "",
        "category": category or "News",
        "body": title if is_image else body,
        "images": [{"caption": title, "position": ""}] if is_image and title else [],
        "image_files": [body] if is_image else [],
        "continues_on": "",
        "continued_from": "",
        "source_pages": source_pages,
    }


def _ad_from(item_type: str, item: dict) -> dict:
    if item_type == "ad":
        return dict(item)
    if item_type == "article":
        return {
            "business_name": item.get("headline", ""),
            "body": item.get("body", ""),
            "image_files": list(item.get("image_files", [])),
        }
    body = str(item.get("body") or "")
    return {
        "business_name": item.get("title", ""),
        "body": "" if _is_image_file(body) else body,
        "image_files": [body] if _is_image_file(body) else [],
    }


def _other_from(item_type: str, item: dict) -> list[dict]:
    if item_type == "other":
        return [dict(item)]
    title = item.get("headline") if item_type == "article" else item.get("business_name")
    body = str(item.get("body") or "")
    output = [{"title": title or "", "body": body or title or ""}]
    for image_file in item.get("image_files", []):
        output.append({"title": title or "", "body": image_file})
    return output


def _fallback_enriched_ad(raw_ad: dict) -> dict:
    return {
        "business_name": raw_ad.get("business_name", ""),
        "body": raw_ad.get("body", ""),
        "image_files": list(raw_ad.get("image_files", [])),
        "category": "Other",
        "ad_type": "display",
        "display_text": "",
        "phone": "",
        "address": "",
        "price": "",
    }


def _apply_review(
    edition: dict,
    item_map: dict[str, tuple[str, int]],
    result: ContentReviewResponse,
    review_hints: dict[str, dict[str, Any]] | None = None,
) -> tuple[int, int]:
    articles = edition.get("articles", [])
    ads = edition.get("ads", [])
    others = edition.get("other_content", [])
    original = {"article": articles, "ad": ads, "other": others}

    accepted = {
        decision.item_id: decision
        for decision in result.decisions
        if decision.confidence >= _REVIEW_CONFIDENCE
    }
    removed = {"article": set(), "ad": set(), "other": set()}
    appended = {"article": [], "ad": [], "other": []}
    review_hints = review_hints or {}
    changed = 0
    category_changes = 0

    for item_id, decision in accepted.items():
        source_type, index = item_map[item_id]
        item = original[source_type][index]
        if decision.target_type == source_type:
            if source_type == "article" and decision.category and decision.category != item.get("category"):
                item["category"] = decision.category
                category_changes += 1
            continue

        source_pages = list(
            item.get("source_pages")
            or review_hints.get(item_id, {}).get("source_pages")
            or []
        )
        if decision.target_type == "article" and not source_pages:
            warning(
                f"Final review abstained on {item_id}: no preserved source page evidence"
            )
            continue

        removed[source_type].add(index)
        if decision.target_type == "article":
            appended["article"].append(
                _article_from(source_type, item, decision.category, source_pages)
            )
        elif decision.target_type == "ad":
            appended["ad"].append(_ad_from(source_type, item))
        else:
            appended["other"].extend(_other_from(source_type, item))
        changed += 1

    edition["articles"] = [item for i, item in enumerate(articles) if i not in removed["article"]] + appended["article"]
    edition["ads"] = [item for i, item in enumerate(ads) if i not in removed["ad"]] + appended["ad"]
    edition["other_content"] = [item for i, item in enumerate(others) if i not in removed["other"]] + appended["other"]

    if "enriched_ads" in edition:
        existing = edition.get("enriched_ads", [])
        if len(existing) == len(ads):
            kept = [item for i, item in enumerate(existing) if i not in removed["ad"]]
            kept.extend(_fallback_enriched_ad(item) for item in appended["ad"])
            edition["enriched_ads"] = kept
        else:
            # Never preserve a positionally misaligned enriched array.
            edition.pop("enriched_ads", None)

    return changed, category_changes


def triage_edition(
    edition_path: str,
    client,
    force: bool = False,
    telemetry_hook: TelemetryHook | None = None,
    review_hints: dict[str, dict[str, Any]] | None = None,
) -> tuple[bool, int, float]:
    """Run targeted final review; retain the legacy callable name."""
    try:
        with open(edition_path, "r", encoding="utf-8") as file:
            edition = json.load(file)
    except json.JSONDecodeError as exc:
        error(f"Malformed JSON in {edition_path}: {exc}")
        return False, 0, 0.0

    edition_date = edition.get("edition_date", os.path.basename(os.path.dirname(edition_path)))
    del force

    candidates, item_map = _build_candidates(edition, review_hints)
    if not candidates:
        info(f"{edition_date}: No deterministic final-review candidates")
        return False, 0, 0.0

    status(f"{edition_date}: Reviewing {len(candidates)} deterministic candidates...")
    headlines = [
        {"index": index, "headline": article.get("headline", "")}
        for index, article in enumerate(edition.get("articles", []))
    ]
    user_message = TRIAGE_USER_TEMPLATE.format(
        suspect_json=json.dumps(candidates, indent=2),
        other_json="[]",
        headlines_json=json.dumps(headlines, indent=2),
    )
    generation_config = build_generation_config(
        "content_triage",
        system_instruction=TRIAGE_SYSTEM_PROMPT,
        response_mime_type="application/json",
        response_schema=ContentReviewResponse,
        max_output_tokens=16384,
    )
    candidate_ids = [candidate["item_id"] for candidate in candidates]

    def validator(response) -> bool:
        return _review_response_complete(response, candidate_ids)

    call_start = time.time()
    try:
        response = gemini_generate_with_retry(
            client,
            model=model_name("content_triage"),
            contents=[user_message],
            config=generation_config,
            stage="content_triage",
            response_validator=validator,
            max_schema_retries=1,
        )
    except Exception as exc:
        elapsed = time.time() - call_start
        _emit_telemetry(
            telemetry_hook,
            status_value="error",
            elapsed_seconds=elapsed,
            item_count=len(candidates),
            error_message=str(exc),
        )
        error(f"Final review failed; keeping all current classifications: {exc}")
        return False, 0, elapsed

    elapsed = time.time() - call_start
    usage = getattr(response, "usage_metadata", None)
    total_tokens = getattr(usage, "total_token_count", 0) or 0 if usage else 0
    if usage:
        substep(
            f"Review tokens: {getattr(usage, 'prompt_token_count', 0) or 0} in, "
            f"{getattr(usage, 'candidates_token_count', 0) or 0} out | Time: {elapsed:.1f}s"
        )
    if not validator(response):
        _emit_telemetry(
            telemetry_hook,
            status_value="error",
            elapsed_seconds=elapsed,
            item_count=len(candidates),
            usage=usage,
            error_message="structured response incomplete",
        )
        error("Final review contract remained incomplete; keeping all current classifications")
        return False, total_tokens, elapsed

    _emit_telemetry(
        telemetry_hook,
        status_value="success",
        elapsed_seconds=elapsed,
        item_count=len(candidates),
        usage=usage,
    )

    changed, category_changes = _apply_review(
        edition,
        item_map,
        response.parsed,
        review_hints,
    )

    descriptor, temporary_path = tempfile.mkstemp(
        dir=os.path.dirname(edition_path), prefix="review_", suffix=".json"
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as file:
            json.dump(edition, file, indent=2)
        os.replace(temporary_path, edition_path)
    except BaseException:
        os.unlink(temporary_path)
        raise

    substep(f"Final review: {changed} type changes, {category_changes} category changes")
    file_written("Edition", edition_path)
    return True, total_tokens, elapsed


__all__ = [
    "_build_candidates",
    "_review_response_complete",
    "triage_edition",
]
