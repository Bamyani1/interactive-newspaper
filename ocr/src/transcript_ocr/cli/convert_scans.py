"""CLI bridge for convert_scans."""

from __future__ import annotations

import sys

from ..application.orchestration import convert_scans_main
from ..config.settings import load_settings
from ._legacy_bridge import run_legacy_script


def main(argv: list[str] | None = None) -> int:
    settings = load_settings()
    if settings.force_legacy_runtime:
        return run_legacy_script("convert_scans_legacy.py", argv)

    previous_argv = sys.argv
    try:
        if argv is not None:
            sys.argv = [previous_argv[0], *argv]
        convert_scans_main()
        return 0
    finally:
        sys.argv = previous_argv


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
