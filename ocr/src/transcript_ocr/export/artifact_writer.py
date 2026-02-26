"""Artifact-writing glue helpers."""

from __future__ import annotations

import os

from ..contracts.diagnostics_models import PipelineReport
from ..diagnostics.issue_report import build_issue_report, write_issue_report_files
from ..diagnostics.run_manifest import write_run_manifest


def write_diagnostics_json(path: str, report: PipelineReport) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(report.to_json())


def write_issue_reports(
    run_root: str,
    report: PipelineReport,
    snapshots_dir: str | None,
    edition_json_path: str,
) -> tuple[str, str]:
    issues = build_issue_report(report, snapshots_dir, edition_json_path)
    return write_issue_report_files(run_root, issues)


__all__ = [
    "write_diagnostics_json",
    "write_issue_reports",
    "write_issue_report_files",
    "write_run_manifest",
]
