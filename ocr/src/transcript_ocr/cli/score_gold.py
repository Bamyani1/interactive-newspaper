"""CLI entrypoint for gold scoring."""

from __future__ import annotations

import sys
from ..evaluation.gold_score import main as gold_score_main


def main(argv: list[str] | None = None) -> int:
    previous_argv = sys.argv
    try:
        if argv is not None:
            sys.argv = [previous_argv[0], *argv]
        gold_score_main()
        return 0
    finally:
        sys.argv = previous_argv


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
