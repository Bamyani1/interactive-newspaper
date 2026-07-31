"""CLI entry point for convert_scans."""

from __future__ import annotations

import argparse
import os
import sys


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
        "--workers",
        type=int,
        default=0,
        help="Number of concurrent worker threads for page processing (default: OCR_WORKERS env or 1).",
    )
    parser.add_argument(
        "--manifest",
        default="",
        help="Optional IIIF manifest path for a single edition directory. "
        "When omitted, manifest.json/source-manifest.json is discovered automatically.",
    )
    parser.add_argument(
        "--output-root",
        default="",
        help="Edition-candidate root. The caller promotes this directory atomically.",
    )
    parser.add_argument(
        "--work-root",
        default="",
        help="Run-owned temporary root for source masters and OCR derivatives.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """Run convert_scans CLI."""
    cli = _build_parser().parse_args(argv)

    from ..config.paths import OCR_ROOT
    from ..ingestion.manifest import discover_page_inventory
    from ..ingestion.pathing import RunPaths
    from ..shared.console import status, error, success, warning
    from ..application.edition_pipeline import EditionPipelineError, process_edition

    output_dir = os.path.abspath(cli.output_root) if cli.output_root else ""

    from ..config.google_clients import create_genai_client

    client = create_genai_client()
    path = cli.path

    def _inventory_for(directory: str, explicit_manifest: str = ""):
        inventory = discover_page_inventory(
            directory,
            explicit_manifest or None,
        )
        if inventory.authoritative:
            status(
                f"Manifest inventory: {inventory.found_pages}/"
                f"{inventory.expected_pages} page images present"
            )
            if inventory.missing_page_indexes:
                warning(
                    "Missing manifest pages: "
                    + ", ".join(str(index) for index in inventory.missing_page_indexes)
                )
        else:
            warning(
                "No IIIF manifest found; page count is limited to discovered files"
            )
        return inventory

    if path:
        if os.path.isfile(path):
            error("Single-file OCR was removed because it cannot satisfy manifest accounting; place the page in an edition directory")
            return 1
        elif os.path.isdir(path):
            if not output_dir:
                error("--output-root is required; use scripts/ocr/process-edition.sh for transactional publication")
                return 1
            try:
                inventory = _inventory_for(path, cli.manifest)
            except (OSError, ValueError) as exc:
                error(f"Invalid edition inventory: {exc}")
                return 1
            try:
                process_edition(
                    settings=None,
                    client=client,
                    paths=RunPaths(
                        edition_dir=path,
                        public_output_root=output_dir,
                        manifest_path=inventory.manifest_path,
                        work_root=os.path.abspath(cli.work_root) if cli.work_root else None,
                    ),
                    workers=cli.workers,
                )
            except EditionPipelineError as exc:
                error(str(exc))
                return 1
        else:
            error(f"Path not found: {path}")
            return 1
    else:
        if not output_dir:
            error("--output-root is required; use scripts/ocr/process-unprocessed.sh for transactional publication")
            return 1
        if cli.manifest:
            error("--manifest requires a single edition directory path")
            return 1
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
        failures = 0
        for edition_dir in edition_dirs:
            edition_path = os.path.join(editions_root, edition_dir)
            try:
                inventory = _inventory_for(edition_path)
            except (OSError, ValueError) as exc:
                error(f"Invalid edition inventory for {edition_dir}: {exc}")
                continue
            try:
                process_edition(
                    settings=None,
                    client=client,
                    paths=RunPaths(
                        edition_dir=edition_path,
                        public_output_root=output_dir,
                        manifest_path=inventory.manifest_path,
                        work_root=os.path.abspath(cli.work_root) if cli.work_root else None,
                    ),
                    workers=cli.workers,
                )
            except EditionPipelineError as exc:
                error(f"{edition_dir}: {exc}")
                failures += 1

        if failures:
            return 1

    success("All done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
