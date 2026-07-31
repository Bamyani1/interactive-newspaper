"""Canonical path constants for the OCR pipeline.

Single source of truth — all modules import from here instead of computing
paths relative to their own __file__ location.
"""

from __future__ import annotations

from pathlib import Path

OCR_ROOT = Path(__file__).resolve().parents[3]  # ocr/
REPO_ROOT = OCR_ROOT.parent  # project root
PUBLIC_EDITIONS_DIR = REPO_ROOT / "public" / "editions"
INBOX_DIR = OCR_ROOT / "inbox"
MODELS_DIR = OCR_ROOT / "models"
