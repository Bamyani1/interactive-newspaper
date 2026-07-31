"""Structural validation for an OCR candidate before public promotion."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from ..contracts.content_models import ARTICLE_CATEGORIES
from ..shared.text import normalize_whitespace

_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_PAGE_RE = re.compile(r"^[1-9]\d*$")


class CandidateValidationError(RuntimeError):
    pass


def _strings(value: Any):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)


def validate_candidate_payload(
    payload: dict[str, Any],
    edition_dir: str | os.PathLike[str],
    *,
    expected_date: str | None = None,
) -> list[str]:
    errors: list[str] = []
    root = Path(edition_dir)
    date = payload.get("edition_date")
    if not isinstance(date, str) or (expected_date and date != expected_date):
        errors.append("edition_date does not match the candidate directory")
    for field in ("articles", "ads", "other_content"):
        if not isinstance(payload.get(field), list):
            errors.append(f"{field} must be an array")

    for text in _strings(payload):
        if _CONTROL_RE.search(text):
            errors.append("candidate contains invalid control characters")
            break

    seen_articles: set[tuple[str, str]] = set()
    for index, article in enumerate(payload.get("articles") or []):
        if not isinstance(article, dict):
            errors.append(f"article {index} is not an object")
            continue
        headline = article.get("headline", "")
        body = article.get("body", "")
        files = article.get("image_files", [])
        images = article.get("images", [])
        if not any((str(headline).strip(), str(body).strip(), files)):
            errors.append(f"article {index} has no headline, body, or image")
        if article.get("category") not in ARTICLE_CATEGORIES:
            errors.append(f"article {index} has an invalid category")
        if not isinstance(files, list) or not isinstance(images, list) or len(files) != len(images):
            errors.append(f"article {index} image metadata is not aligned")
        pages = article.get("source_pages")
        if not isinstance(pages, list) or not pages:
            errors.append(f"article {index} has no source_pages")
        elif any(not isinstance(page, str) or not _PAGE_RE.match(page) for page in pages):
            errors.append(f"article {index} has an invalid source page")
        for field in ("continues_on", "continued_from"):
            marker = article.get(field, "")
            if marker not in {"", "?"} and (not isinstance(marker, str) or not _PAGE_RE.match(marker)):
                errors.append(f"article {index} has an invalid {field} marker")
        key = (normalize_whitespace(str(headline)), normalize_whitespace(str(body)))
        if len(key[1]) > 200 and key in seen_articles:
            errors.append(f"article {index} exactly duplicates another long article")
        seen_articles.add(key)

    for collection in ("articles", "ads", "enriched_ads"):
        for index, item in enumerate(payload.get(collection) or []):
            if not isinstance(item, dict):
                continue
            for image_file in item.get("image_files") or []:
                if not isinstance(image_file, str) or not image_file:
                    errors.append(f"{collection} {index} has an empty image reference")
                    continue
                resolved = (root / image_file).resolve()
                try:
                    resolved.relative_to(root.resolve())
                except ValueError:
                    errors.append(f"{collection} {index} image escapes the edition directory")
                    continue
                if not resolved.is_file():
                    errors.append(f"{collection} {index} image does not exist: {image_file}")

    for index, item in enumerate(payload.get("other_content") or []):
        if not isinstance(item, dict):
            continue
        image_file = item.get("body", "")
        if not isinstance(image_file, str) or not image_file.startswith("images/"):
            continue
        resolved = (root / image_file).resolve()
        try:
            resolved.relative_to(root.resolve())
        except ValueError:
            errors.append(f"other_content {index} image escapes the edition directory")
            continue
        if not resolved.is_file():
            errors.append(f"other_content {index} image does not exist: {image_file}")

    enriched = payload.get("enriched_ads")
    ads = payload.get("ads") or []
    if enriched is not None:
        if not isinstance(enriched, list) or len(enriched) != len(ads):
            errors.append("enriched_ads must align one-to-one with ads")
        else:
            for index, (raw, extra) in enumerate(zip(ads, enriched)):
                for field in ("business_name", "body", "image_files"):
                    if raw.get(field) != extra.get(field):
                        errors.append(f"enriched ad {index} changed source field {field}")

    return errors


def validate_candidate_file(
    edition_json_path: str | os.PathLike[str],
    *,
    expected_date: str | None = None,
) -> dict[str, Any]:
    path = Path(edition_json_path)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise CandidateValidationError(f"cannot parse {path.name}: {exc}") from exc
    if not isinstance(payload, dict):
        raise CandidateValidationError("edition JSON root must be an object")
    errors = validate_candidate_payload(payload, path.parent, expected_date=expected_date)
    if errors:
        raise CandidateValidationError("; ".join(errors))
    return payload


__all__ = [
    "CandidateValidationError",
    "validate_candidate_file",
    "validate_candidate_payload",
]
