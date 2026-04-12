"""Load prompts and model configs from the single source of truth: ocr/src/prompts.json."""

from __future__ import annotations

import json
from pathlib import Path

_PROMPTS_JSON = Path(__file__).resolve().parents[2] / "prompts.json"

with open(_PROMPTS_JSON, encoding="utf-8") as _f:
    _CONFIG = json.load(_f)

MODELS: dict = _CONFIG["models"]
PROMPTS: dict = _CONFIG["prompts"]

__all__ = ["MODELS", "PROMPTS"]
