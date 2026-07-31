"""CLI entrypoint for gold scoring."""

from __future__ import annotations

from ..evaluation.gold_score import main as gold_score_main


def main(argv: list[str] | None = None) -> int:
    return gold_score_main(argv)


if __name__ == "__main__":
    raise SystemExit(main())
