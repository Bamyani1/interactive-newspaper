#!/usr/bin/env python3
"""Thin wrapper for final-only frozen-gold scoring."""

from __future__ import annotations

import sys
from pathlib import Path

OCR_SRC = Path(__file__).resolve().parent / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.cli.score_gold import main


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
