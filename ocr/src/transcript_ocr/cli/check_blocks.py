"""CLI entrypoint for the offline block check."""

from __future__ import annotations

from ..evaluation.block_check import main as block_check_main


def main(argv: list[str] | None = None) -> int:
    return block_check_main(argv)


if __name__ == "__main__":
    raise SystemExit(main())
