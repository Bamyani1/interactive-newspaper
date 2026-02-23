"""CLI entrypoint for run comparison."""

from __future__ import annotations

import sys
from ..evaluation.run_compare import main as run_compare_main


def main(argv: list[str] | None = None) -> int:
    previous_argv = sys.argv
    try:
        if argv is not None:
            sys.argv = [previous_argv[0], *argv]
        run_compare_main()
        return 0
    finally:
        sys.argv = previous_argv


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
