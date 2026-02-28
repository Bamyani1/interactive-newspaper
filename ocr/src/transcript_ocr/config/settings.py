"""Typed settings for OCR pipeline runtime and environment aliases."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class PipelineSettings:
    google_api_key: str
    gemini_request_timeout_s: int = 240


def _load_env_file() -> None:
    repo_root = Path(__file__).resolve().parents[4]
    dotenv_path = repo_root / ".env.local"
    if dotenv_path.exists():
        load_dotenv(dotenv_path=dotenv_path)


def load_settings() -> PipelineSettings:
    _load_env_file()
    # Compatibility aliasing while scripts converge on one env var.
    google_api_key = (
        os.getenv("GOOGLE_API_KEY")
        or os.getenv("GEMINI_API_KEY")
        or ""
    )
    timeout_raw = os.getenv("GEMINI_REQUEST_TIMEOUT_S", "240")
    try:
        timeout_s = int(timeout_raw)
    except ValueError:
        timeout_s = 240

    return PipelineSettings(
        google_api_key=google_api_key,
        gemini_request_timeout_s=timeout_s,
    )
