"""Structural parity helpers for comparing OCR run artifacts."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def _load_json(path: str | Path) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _flatten_key_paths(value: Any, prefix: str = "") -> set[str]:
    """Return dotted key paths for nested dict/list values.

    Lists are represented as `[]` segments to avoid index-sensitive comparisons.
    """
    keys: set[str] = set()
    if isinstance(value, dict):
        for k, v in value.items():
            path = f"{prefix}.{k}" if prefix else str(k)
            keys.add(path)
            keys.update(_flatten_key_paths(v, path))
    elif isinstance(value, list):
        list_prefix = f"{prefix}[]" if prefix else "[]"
        keys.add(list_prefix)
        for item in value:
            keys.update(_flatten_key_paths(item, list_prefix))
    return keys


def resolve_artifact_paths(run_dir: str | Path) -> dict[str, str]:
    run_dir = str(run_dir)
    manifest_path = os.path.join(run_dir, "run_manifest.json")
    diagnostics_path = os.path.join(run_dir, "diagnostics.json")
    issue_report_path = os.path.join(run_dir, "issue_report.json")

    manifest = _load_json(manifest_path)
    edition_dir = manifest.get("output_edition_dir", "") if isinstance(manifest, dict) else ""
    edition_path = os.path.join(edition_dir, "edition.json") if edition_dir else ""

    return {
        "diagnostics": diagnostics_path,
        "issue_report": issue_report_path,
        "run_manifest": manifest_path,
        "edition": edition_path,
    }


def collect_artifact_keysets(run_dir: str | Path) -> dict[str, list[str]]:
    keysets: dict[str, list[str]] = {}
    for name, path in resolve_artifact_paths(run_dir).items():
        if not path or not os.path.exists(path):
            keysets[name] = []
            continue
        payload = _load_json(path)
        keysets[name] = sorted(_flatten_key_paths(payload))
    return keysets


def compare_keysets(baseline: dict[str, list[str]], candidate: dict[str, list[str]]) -> dict[str, dict[str, list[str]]]:
    diff: dict[str, dict[str, list[str]]] = {}
    artifact_names = sorted(set(baseline) | set(candidate))
    for name in artifact_names:
        b = set(baseline.get(name, []))
        c = set(candidate.get(name, []))
        missing = sorted(b - c)
        added = sorted(c - b)
        if missing or added:
            diff[name] = {"missing": missing, "added": added}
    return diff


__all__ = [
    "collect_artifact_keysets",
    "compare_keysets",
    "resolve_artifact_paths",
]
