"""Minimal current-edition provenance sidecar."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Iterable

from ..contracts.page_state import PageOutcome


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_provenance(
    path: str | os.PathLike[str],
    *,
    edition_date: str,
    edition_dir: str | os.PathLike[str],
    manifest_path: str | None,
    outcomes: Iterable[PageOutcome],
    provider: dict[str, str],
    model_routes: dict[str, dict],
    estimated_cost_usd: float | None = None,
) -> None:
    source_root = Path(edition_dir)
    manifest_url = ""
    acquisition_path = source_root / ".iiif-source.json"
    if acquisition_path.is_file():
        try:
            manifest_url = json.loads(acquisition_path.read_text(encoding="utf-8")).get("manifest_url", "")
        except (OSError, json.JSONDecodeError):
            pass
    pages = []
    for outcome in outcomes:
        source = source_root / outcome.filename if outcome.filename else None
        pages.append(
            {
                "canvas": outcome.canvas_index,
                "state": outcome.state.value,
                "filename": outcome.filename,
                "source_sha256": _sha256(source) if source and source.is_file() else "",
            }
        )
    payload = {
        "schema_version": 2,
        "edition_date": edition_date,
        "source": {
            "manifest_url": manifest_url,
            "manifest_filename": Path(manifest_path).name if manifest_path else "",
            "derivative": "full-resolution IIIF image derivative",
        },
        "provider": provider,
        "models": model_routes,
        "pages": pages,
    }
    if estimated_cost_usd is not None:
        payload["estimated_cost_usd"] = round(estimated_cost_usd, 4)
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + ".part")
    partial.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.replace(partial, target)


__all__ = ["write_provenance"]
