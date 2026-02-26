"""Retry helpers for Gemini API calls."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

OCR_ROOT = Path(__file__).resolve().parents[3]
if str(OCR_ROOT) not in sys.path:
    sys.path.insert(0, str(OCR_ROOT))

from gemini_utils import gemini_generate_with_retry as _legacy_gemini_generate_with_retry


def gemini_generate_with_retry(*args: Any, **kwargs: Any) -> Any:
    return _legacy_gemini_generate_with_retry(*args, **kwargs)


__all__ = ["gemini_generate_with_retry"]
