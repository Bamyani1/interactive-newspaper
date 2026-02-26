"""CLI bridge for enrich_ads."""

from __future__ import annotations

import argparse
import sys


def _build_parser() -> argparse.ArgumentParser:
    """Lightweight (stdlib-only) parser so --help works without third-party deps."""
    parser = argparse.ArgumentParser(description="Enrich ads in edition.json files")
    parser.add_argument("--date", help="Enrich a specific edition by date (e.g. 1988-10-12)")
    parser.add_argument("--force", action="store_true", help="Re-enrich already enriched editions")
    parser.add_argument("--editions-dir", default="", help="Directory containing edition subfolders.")
    return parser


def main(argv: list[str] | None = None) -> int:
    # Parse first: --help exits here before any heavy imports.
    _build_parser().parse_known_args(argv)

    from ..application.orchestration import enrich_ads_main
    from ..config.settings import load_settings
    from ._legacy_bridge import run_legacy_script

    settings = load_settings()
    if settings.force_legacy_runtime:
        return run_legacy_script("enrich_ads_legacy.py", argv)

    previous_argv = sys.argv
    try:
        if argv is not None:
            sys.argv = [previous_argv[0], *argv]
        enrich_ads_main()
        return 0
    finally:
        sys.argv = previous_argv


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
