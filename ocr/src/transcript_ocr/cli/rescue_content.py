"""CLI entry point for content triage."""

from __future__ import annotations

import argparse
import sys


def _build_parser() -> argparse.ArgumentParser:
    """Lightweight (stdlib-only) parser so --help works without third-party deps."""
    parser = argparse.ArgumentParser(description="Triage content in edition.json files")
    parser.add_argument("--date", help="Triage a specific edition by date (e.g. 2000-04-05)")
    parser.add_argument("--force", action="store_true", help="Re-triage already triaged editions")
    return parser


def main(argv: list[str] | None = None) -> int:
    # Parse first: --help exits here before any heavy imports.
    _build_parser().parse_known_args(argv)

    from ..application.content_rescue import main as content_rescue_main

    return content_rescue_main(argv)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
