from __future__ import annotations

import argparse
import json
from pathlib import Path

from ..diagnostics.failure_log import append_failure


def _candidate_cost(provenance: str | None) -> float | None:
    """The OCR spend a discarded candidate recorded, so the run can still charge it."""
    if not provenance:
        return None
    try:
        cost = json.loads(Path(provenance).read_text(encoding="utf-8")).get("estimated_cost_usd")
    except (OSError, ValueError, AttributeError):
        return None
    return float(cost) if isinstance(cost, (int, float)) else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Append sanitized OCR failure metadata.")
    parser.add_argument("--edition", required=True)
    parser.add_argument("--stage", required=True)
    parser.add_argument("--error", required=True)
    parser.add_argument("--page", default="")
    parser.add_argument("--status", default="failed")
    parser.add_argument("--provenance", help="a discarded candidate's provenance.json")
    args = parser.parse_args(argv)
    append_failure(
        edition=args.edition,
        page=args.page,
        stage=args.stage,
        status=args.status,
        error=args.error,
        estimated_cost_usd=_candidate_cost(args.provenance),
    )
    return 0


__all__ = ["main"]
