from __future__ import annotations

import argparse
import os
from pathlib import Path

from ..export.publish_checks import publish_check_failures

DEFAULT_MAX_EDITION_USD = 1.5


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Bulk-run publish checks for an OCR edition."
    )
    parser.add_argument("edition_dir")
    parser.add_argument("--stage", choices=("candidate", "post-upload"), required=True)
    args = parser.parse_args(argv)
    max_cost = float(os.environ.get("OCR_MAX_EDITION_USD") or DEFAULT_MAX_EDITION_USD)
    failures = publish_check_failures(
        Path(args.edition_dir), stage=args.stage, max_cost_usd=max_cost
    )
    for failure in failures:
        print(f"UNPUBLISHABLE: {failure}")
    if failures:
        return 1
    print("PUBLISHABLE")
    return 0


__all__ = ["main"]
