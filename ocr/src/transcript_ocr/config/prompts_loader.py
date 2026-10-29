"""Load prompts from the single source of truth: ocr/src/prompts.json."""

from __future__ import annotations

import json
from pathlib import Path

_PROMPTS_JSON = Path(__file__).resolve().parents[2] / "prompts.json"

with open(_PROMPTS_JSON, encoding="utf-8") as _f:
    _CONFIG = json.load(_f)

PROMPTS: dict = _CONFIG["prompts"]

# Fail fast at module load if prompts.json is missing keys the pipeline hits
# via direct dict access. A stale deploy or a partial manual edit that drops
# one of these would otherwise crash with an opaque KeyError deep inside a
# merge run. See docs/issues/0009.
_REQUIRED_PROMPT_KEYS = (
    "page_structuring",
    "image_matching",
    "merge_system",
    "merge_user_template",
    "seam_repair",
    "ad_enrichment_system",
    "ad_enrichment_user_template",
    "content_triage_system",
    "content_triage_user_template",
)
_missing_prompt_keys = [k for k in _REQUIRED_PROMPT_KEYS if k not in PROMPTS]
if _missing_prompt_keys:
    raise RuntimeError(
        f"prompts.json missing required keys: {_missing_prompt_keys}. "
        f"Check {_PROMPTS_JSON}."
    )

__all__ = ["PROMPTS"]
