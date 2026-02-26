"""CLI entry point for enrich_ads."""

from __future__ import annotations

import argparse
import sys


def _build_parser() -> argparse.ArgumentParser:
    """Lightweight (stdlib-only) parser so --help works without third-party deps."""
    parser = argparse.ArgumentParser(description="Enrich ads in edition.json files")
    parser.add_argument("--date", help="Enrich a specific edition by date (e.g. 1988-10-12)")
    parser.add_argument("--force", action="store_true", help="Re-enrich already enriched editions")
    return parser


def main(argv: list[str] | None = None) -> int:
    # Parse first: --help exits here before any heavy imports.
    _build_parser().parse_known_args(argv)

    from ..application.ad_enrichment import main as ad_enrichment_main

    return ad_enrichment_main(argv)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
