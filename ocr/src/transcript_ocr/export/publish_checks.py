"""Checks an edition must pass before it is promoted to public/editions.

Structural validity is validation.py's job; these are the bulk-run checks:
every page read, cost under the cap, no empty or duplicate articles, and
(after upload) every image in the asset manifest.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from ..contracts.page_state import PASSING_PAGE_STATES

_PASSING = {state.value for state in PASSING_PAGE_STATES}


def _normalized(text: object) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip().lower()


def _page_failures(provenance: dict) -> list[str]:
    pages = provenance.get("pages") or []
    if not pages:
        return ["provenance lists no pages"]
    return [
        f"page {page.get('canvas')} was not read ({page.get('state')})"
        for page in pages
        if page.get("state") not in _PASSING
    ]


def _cost_failures(provenance: dict, max_cost_usd: float) -> list[str]:
    cost = provenance.get("estimated_cost_usd")
    if not isinstance(cost, (int, float)):
        return ["no estimated cost recorded"]
    if cost > max_cost_usd:
        return [f"cost ${cost:.4f} is over the ${max_cost_usd:.2f} cap"]
    return []


def _article_failures(articles: list[dict]) -> list[str]:
    failures = []
    seen: dict[tuple[str, str], int] = {}
    for number, article in enumerate(articles, start=1):
        headline = str(article.get("headline") or "")
        body = _normalized(article.get("body"))
        if not body and not article.get("image_files"):
            failures.append(f"article {number} is empty: {headline!r}")
            continue
        key = (_normalized(headline), body)
        if key in seen:
            failures.append(
                f"article {number} duplicates article {seen[key]}: {headline!r}"
            )
        else:
            seen[key] = number
    return failures


def _image_failures(edition_dir: Path, payload: dict) -> list[str]:
    manifest = json.loads(
        (edition_dir / "asset-manifest.json").read_text(encoding="utf-8")
    )
    uploaded = {asset.get("public_path") for asset in manifest.get("assets") or []}
    failures = []
    for section in ("articles", "ads", "other_content"):
        for item in payload.get(section) or []:
            for image in item.get("image_files") or []:
                if image not in uploaded:
                    failures.append(f"image {image} is not in asset-manifest.json")
    return failures


def publish_check_failures(
    edition_dir: Path, *, stage: str, max_cost_usd: float
) -> list[str]:
    """Return one line per failed check; an empty list means publishable."""
    edition_dir = Path(edition_dir)
    payload = json.loads((edition_dir / "edition.json").read_text(encoding="utf-8"))
    provenance_path = edition_dir / "provenance.json"
    if not provenance_path.is_file():
        return ["provenance.json is missing"]
    provenance = json.loads(provenance_path.read_text(encoding="utf-8"))

    failures = _page_failures(provenance)
    failures += _cost_failures(provenance, max_cost_usd)
    failures += _article_failures(payload.get("articles") or [])
    if stage == "post-upload":
        failures += _image_failures(edition_dir, payload)
    return failures


__all__ = ["publish_check_failures"]
