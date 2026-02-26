"""Run manifest writer utilities."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
from datetime import datetime, timezone

from ..contracts.diagnostics_models import PipelineReport


def _sha256_file(path: str) -> str:
    """Compute SHA256 checksum for a file."""
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _get_git_commit_hash(repo_root: str) -> str:
    """Return current git commit hash, or empty string when unavailable."""
    try:
        out = subprocess.check_output(
            ["git", "-C", repo_root, "rev-parse", "HEAD"],
            stderr=subprocess.DEVNULL,
            text=True,
        )
        return out.strip()
    except Exception:
        return ""


def _write_run_manifest(
    run_root: str,
    edition_dir: str,
    image_files: list[str],
    report: PipelineReport,
) -> str:
    """Write run manifest with immutable run inputs and provenance metadata."""
    os.makedirs(run_root, exist_ok=True)
    inputs = []
    for path in image_files:
        try:
            inputs.append(
                {
                    "path": os.path.abspath(path),
                    "size_bytes": os.path.getsize(path),
                    "sha256": _sha256_file(path),
                }
            )
        except OSError:
            inputs.append(
                {
                    "path": os.path.abspath(path),
                    "size_bytes": 0,
                    "sha256": "",
                }
            )

    manifest = {
        "run_id": report.run_id,
        "edition_date": report.edition_date,
        "input_edition_dir": os.path.abspath(edition_dir),
        "output_edition_dir": os.path.abspath(report.output_edition_dir) if report.output_edition_dir else "",
        "run_root": os.path.abspath(run_root),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "git_commit_hash": report.git_commit_hash,
        "inputs": inputs,
    }
    manifest_path = os.path.join(run_root, "run_manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    return manifest_path


write_run_manifest = _write_run_manifest

__all__ = ["_get_git_commit_hash", "_sha256_file", "_write_run_manifest", "write_run_manifest"]
