"""CLI bridge for convert_scans."""

from __future__ import annotations

import argparse
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
    parser.add_argument("--run-id", default="", help="Optional run identifier.")
    parser.add_argument("--ocr-output-root", default="", help="Root for OCR intermediates.")
    parser.add_argument("--public-output-root", default="", help="Root for public edition output.")
    parser.add_argument("--workers", type=int, default=0, help="Concurrent worker threads.")
    return parser


def main(argv: list[str] | None = None) -> int:
    # Parse first: --help exits here before any heavy imports.
    _build_parser().parse_known_args(argv)

    from ..application.orchestration import convert_scans_main
    from ..config.settings import load_settings
    from ._legacy_bridge import run_legacy_script

    settings = load_settings()
    if settings.force_legacy_runtime:
        return run_legacy_script("convert_scans_legacy.py", argv)

    previous_argv = sys.argv
    try:
        if argv is not None:
            sys.argv = [previous_argv[0], *argv]
        convert_scans_main()
        return 0
    finally:
        sys.argv = previous_argv


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
