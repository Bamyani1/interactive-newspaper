"""Metadata-only append log for production OCR failures."""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..config.paths import OCR_ROOT

_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]+")
_ABS_PATH_RE = re.compile(r"(?:(?:[A-Za-z]:)?[/\\](?:[^\s:/\\]+[/\\])+)([^\s:/\\]+)")


def _sanitize_error(error: BaseException | str) -> str:
    message = _CONTROL_RE.sub(" ", str(error)).strip()
    message = _ABS_PATH_RE.sub(r"<path>/\1", message)
    return message[:500]


def append_failure(
    *,
    edition: str,
    stage: str,
    error: BaseException | str,
    canvas: int | None = None,
    page: str = "",
    attempt: int | None = None,
    model: str = "",
    config_id: str = "",
    status: str = "failed",
    finish_reason: str = "",
    latency_ms: int | None = None,
    tokens: dict[str, int] | None = None,
    estimated_cost_usd: float | None = None,
    log_path: str | os.PathLike[str] | None = None,
) -> None:
    """Append a sanitized JSON object without prompts, OCR text, or responses."""
    target = Path(log_path) if log_path else OCR_ROOT / "logs" / "failures.jsonl"
    target.parent.mkdir(parents=True, exist_ok=True)
    record: dict[str, Any] = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "edition": edition,
        "canvas": canvas,
        "page": page,
        "stage": stage,
        "attempt": attempt,
        "model": model,
        "config_id": config_id,
        "status": status,
        "finish_reason": finish_reason,
        "latency_ms": latency_ms,
        "tokens": tokens or {},
        "estimated_cost_usd": estimated_cost_usd,
        "error": _sanitize_error(error),
    }
    line = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
    with target.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


__all__ = ["append_failure"]
