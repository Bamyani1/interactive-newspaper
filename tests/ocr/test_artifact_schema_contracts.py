"""Contract checks for representative OCR artifact outputs."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
_OUTPUT_BASE = ROOT / "ocr" / "runs"

# Resolve the most recent available pipeline run, or None if no output exists.
def _latest_run() -> Path | None:
    if not _OUTPUT_BASE.exists():
        return None
    for edition_dir in sorted(_OUTPUT_BASE.iterdir(), reverse=True):
        runs_dir = edition_dir / "runs"
        if runs_dir.exists():
            for run_dir in sorted(runs_dir.iterdir(), reverse=True):
                if (run_dir / "diagnostics.json").exists():
                    return run_dir
    return None

RUN = _latest_run()
pytestmark = pytest.mark.skipif(
    RUN is None,
    reason="No OCR pipeline output found in ocr/runs/ — run the pipeline first",
)


def _load(path: Path) -> dict:
    return json.loads(path.read_text())


def test_diagnostics_required_keys():
    diagnostics = _load(RUN / "diagnostics.json")
    for key in [
        "edition_date",
        "run_id",
        "run_root",
        "page_diagnostics",
        "total_prompt_tokens",
        "total_candidates_tokens",
    ]:
        assert key in diagnostics


def test_issue_report_required_keys():
    issue_report = _load(RUN / "issue_report.json")
    assert isinstance(issue_report, dict)
    assert "issues" in issue_report
    assert isinstance(issue_report["issues"], list)


def test_run_manifest_required_keys():
    manifest = _load(RUN / "run_manifest.json")
    for key in ["run_id", "run_root", "output_edition_dir", "git_commit_hash", "created_at"]:
        assert key in manifest


def test_edition_required_keys():
    manifest = _load(RUN / "run_manifest.json")
    edition_path = Path(manifest["output_edition_dir"]) / "edition.json"
    edition = _load(edition_path)
    for key in ["edition_date", "publication_info", "articles", "ads", "other_content"]:
        assert key in edition
