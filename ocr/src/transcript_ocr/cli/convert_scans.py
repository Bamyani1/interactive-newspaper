"""CLI entry point for convert_scans."""

from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime, timezone
from typing import Any


def _build_parser() -> argparse.ArgumentParser:
    """Lightweight (stdlib-only) parser so --help works without third-party deps."""
    parser = argparse.ArgumentParser(
        description="Process newspaper scans into structured OCR output.",
    )
    parser.add_argument(
        "path",
        nargs="?",
        default="",
        help="Path to a single image file or an edition directory. "
        "If omitted, process all directories in ocr/inbox/.",
    )
    parser.add_argument(
        "--run-id",
        default="",
        help="Optional run identifier used for reproducible artifact directories.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=0,
        help="Number of concurrent worker threads for page processing (default: OCR_WORKERS env or 1).",
    )
    return parser


def _process_single_file(client: Any, path: str, run_id: str) -> None:
    """Process a single image file through Phase 1 + Phase 2 (no merge)."""
    from ..config.paths import OCR_RUNS_DIR, REPO_ROOT
    from ..contracts.diagnostics_models import PageDiagnostics, PipelineReport
    from ..diagnostics.run_manifest import _get_git_commit_hash
    from ..recognition.docai_provider import DocAIError
    from ..shared.console import status, error, file_written, print_summary_table
    from ..application.page_pipeline import extract_page_docai, structure_and_link_page

    status(f"Processing single file: {path}")
    pipeline_start = time.time()
    single_run_id = run_id or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    single_ocr_dir = os.path.join(str(OCR_RUNS_DIR), "single-file", "runs", single_run_id)
    os.makedirs(single_ocr_dir, exist_ok=True)

    output_dir = str(OCR_RUNS_DIR)

    report = PipelineReport(
        edition_date="single-file",
        run_id=single_run_id,
        run_root=os.path.abspath(single_ocr_dir),
        input_edition_dir=os.path.abspath(path),
        output_edition_dir=os.path.abspath(output_dir),
        git_commit_hash=_get_git_commit_hash(str(REPO_ROOT)),
        start_time=datetime.now(timezone.utc).isoformat(),
        pages_attempted=1,
    )
    page_diag = PageDiagnostics()
    try:
        docai_result, preprocessed_image, regions = extract_page_docai(
            path, diag=page_diag, snapshots_dir=None,
        )
    except (DocAIError, Exception) as exc:
        error(f"Extraction failed: {exc}")
        page_diag.error = str(exc)
        result = None
    else:
        result = structure_and_link_page(
            client, path, docai_result, preprocessed_image, regions,
            output_dir, diag=page_diag, ocr_output_dir=single_ocr_dir,
        )
    report.page_diagnostics.append(page_diag)
    report.pages_processed = 1 if result is not None else 0
    report.total_time_seconds = time.time() - pipeline_start
    report.finalize()

    diag_path = os.path.join(single_ocr_dir, "diagnostics.json")
    with open(diag_path, "w", encoding="utf-8") as f:
        f.write(report.to_json())
    file_written("Diagnostics", diag_path)
    print_summary_table(report)


def main(argv: list[str] | None = None) -> int:
    """Run convert_scans CLI."""
    cli = _build_parser().parse_args(argv)

    from ..config.paths import OCR_ROOT, OCR_RUNS_DIR, PUBLIC_EDITIONS_DIR
    from ..ingestion.pathing import RunPaths
    from ..shared.console import status, error, success
    from ..application.edition_pipeline import process_edition

    output_dir = str(PUBLIC_EDITIONS_DIR)
    os.makedirs(output_dir, exist_ok=True)
    ocr_output_dir = str(OCR_RUNS_DIR)
    os.makedirs(ocr_output_dir, exist_ok=True)

    from google import genai  # lazy: avoid import failure when google-genai not installed

    client = genai.Client()
    path = cli.path

    if path:
        if os.path.isfile(path):
            _process_single_file(client, path, cli.run_id)
        elif os.path.isdir(path):
            process_edition(
                settings=None,
                client=client,
                paths=RunPaths(
                    edition_dir=path,
                    public_output_root=output_dir,
                    ocr_output_root=ocr_output_dir,
                ),
                run_id=cli.run_id,
                workers=cli.workers,
            )
        else:
            error(f"Path not found: {path}")
            return 1
    else:
        editions_root = os.path.join(str(OCR_ROOT), "inbox")
        if not os.path.isdir(editions_root):
            error(f"Scans directory not found: {editions_root}")
            return 1

        edition_dirs = sorted(
            d for d in os.listdir(editions_root) if os.path.isdir(os.path.join(editions_root, d))
        )

        if not edition_dirs:
            status("No edition directories found")
            return 0

        status(f"Found {len(edition_dirs)} edition(s) to process.")
        for edition_dir in edition_dirs:
            process_edition(
                settings=None,
                client=client,
                paths=RunPaths(
                    edition_dir=os.path.join(editions_root, edition_dir),
                    public_output_root=output_dir,
                    ocr_output_root=ocr_output_dir,
                ),
                run_id=cli.run_id,
                workers=cli.workers,
            )

    success("All done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
