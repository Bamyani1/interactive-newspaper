from __future__ import annotations

import argparse

from ..diagnostics.failure_log import append_failure


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Append sanitized OCR failure metadata.")
    parser.add_argument("--edition", required=True)
    parser.add_argument("--stage", required=True)
    parser.add_argument("--error", required=True)
    parser.add_argument("--page", default="")
    parser.add_argument("--status", default="failed")
    args = parser.parse_args(argv)
    append_failure(
        edition=args.edition,
        page=args.page,
        stage=args.stage,
        status=args.status,
        error=args.error,
    )
    return 0


__all__ = ["main"]
