"""Application-layer runtime for OCR scan conversion."""

from __future__ import annotations

import argparse
import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..contracts.diagnostics_models import PageDiagnostics, PipelineReport
from ..diagnostics.run_manifest import _get_git_commit_hash
from ..ingestion.pathing import RunPaths, resolve_ocr_output_root, resolve_public_output_root
from ..shared.console import status, error, success, file_written, print_summary_table
from .edition_pipeline import process_edition as _application_process_edition
from .page_pipeline import (
    _extract_page_number_from_filename,
    extract_page_docai,
    structure_and_link_page,
)

OCR_ROOT = Path(__file__).resolve().parents[3]
REPO_ROOT = OCR_ROOT.parent


@dataclass(frozen=True)
class EditionRunPaths:
    """Typed paths used by the edition pipeline."""

    edition_dir: str
    public_output_root: str
    ocr_output_root: str | None = None


def process_edition(
    settings: Any,
    client: Any,
    paths: EditionRunPaths,
    run_id: str = "",
    workers: int = 1,
) -> None:
    """Stable application signature for edition-level OCR processing."""
    _application_process_edition(
        settings,
        client,
        RunPaths(
            edition_dir=paths.edition_dir,
            public_output_root=paths.public_output_root,
            ocr_output_root=paths.ocr_output_root,
        ),
        run_id=run_id,
        workers=workers,
    )


def _process_edition(
    client,
    edition_dir: str,
    output_dir: str,
    ocr_output_dir: str | None = None,
    run_id: str = "",
    workers: int = 1,
) -> None:
    """Backwards-compatible signature used by existing callers."""
    process_edition(
        settings=None,
        client=client,
        paths=EditionRunPaths(
            edition_dir=edition_dir,
            public_output_root=output_dir,
            ocr_output_root=ocr_output_dir,
        ),
        run_id=run_id,
        workers=workers,
    )


def main(argv: list[str] | None = None) -> int:
    """Run convert_scans CLI with package runtime."""
    parser = argparse.ArgumentParser(
        description="Process newspaper scans into structured OCR output.",
    )
    parser.add_argument(
        "path",
        nargs="?",
        default="",
        help="Path to a single image file or an edition directory. If omitted, process all directories in ocr/inbox/.",
    )
    parser.add_argument(
        "--run-id",
        default="",
        help="Optional run identifier used for reproducible artifact directories.",
    )
    parser.add_argument(
        "--ocr-output-root",
        default="",
        help="Optional root directory for OCR intermediates (default: ocr/runs).",
    )
    parser.add_argument(
        "--public-output-root",
        default="",
        help="Optional root directory for public edition output (default: public/editions).",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=0,
        help="Number of concurrent worker threads for page processing (default: OCR_WORKERS env or 1).",
    )
    cli = parser.parse_args(argv)

    script_dir = str(OCR_ROOT)
    output_dir = resolve_public_output_root(script_dir, cli.public_output_root)
    ocr_output_dir = resolve_ocr_output_root(script_dir, cli.ocr_output_root)

    from google import genai  # lazy: avoid import failure when google-genai not installed

    client = genai.Client()
    path = cli.path

    if path:
        if os.path.isfile(path):
            status(f"Processing single file: {path}")
            pipeline_start = time.time()
            single_run_id = cli.run_id or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            single_ocr_dir = os.path.join(ocr_output_dir, "single-file", "runs", single_run_id)
            os.makedirs(single_ocr_dir, exist_ok=True)

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
            from ..recognition.docai_provider import DocAIError
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
        elif os.path.isdir(path):
            _process_edition(
                client,
                path,
                output_dir,
                ocr_output_dir=ocr_output_dir,
                run_id=cli.run_id,
                workers=cli.workers,
            )
        else:
            error(f"Path not found: {path}")
            return 1
    else:
        editions_root = os.path.join(script_dir, "inbox")
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
            _process_edition(
                client,
                os.path.join(editions_root, edition_dir),
                output_dir,
                ocr_output_dir=ocr_output_dir,
                run_id=cli.run_id,
                workers=cli.workers,
            )

    success("All done.")
    return 0


__all__ = [
    "EditionRunPaths",
    "_extract_page_number_from_filename",
    "_process_edition",
    "extract_page_docai",
    "main",
    "process_edition",
    "structure_and_link_page",
]
