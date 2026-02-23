"""Run legacy top-level OCR scripts while new package modules are phased in."""

from __future__ import annotations

import runpy
import sys
from pathlib import Path


def run_legacy_script(filename: str, argv: list[str] | None = None) -> int:
    """Execute a legacy script from ocr/ as __main__.

    This preserves behavior while the new package structure is introduced.
    """
    ocr_root = Path(__file__).resolve().parents[3]
    target = ocr_root / filename
    if not target.exists():
        raise FileNotFoundError(f"Legacy OCR entrypoint not found: {target}")

    previous_argv = sys.argv
    try:
        sys.argv = [str(target), *(argv or [])]
        runpy.run_path(str(target), run_name="__main__")
    finally:
        sys.argv = previous_argv
    return 0
