"""Path policy helpers for OCR runs."""

from __future__ import annotations

import os
from dataclasses import dataclass

from ..config.paths import OCR_RUNS_DIR, PUBLIC_EDITIONS_DIR


def resolve_public_output_root() -> str:
    os.makedirs(str(PUBLIC_EDITIONS_DIR), exist_ok=True)
    return str(PUBLIC_EDITIONS_DIR)


def resolve_ocr_output_root() -> str:
    os.makedirs(str(OCR_RUNS_DIR), exist_ok=True)
    return str(OCR_RUNS_DIR)


def resolve_run_root(ocr_output_root: str, edition_date: str, run_id: str) -> str:
    return os.path.join(ocr_output_root, edition_date, "runs", run_id)


@dataclass(frozen=True)
class RunPaths:
    edition_dir: str
    public_output_root: str
    ocr_output_root: str | None = None


__all__ = [
    "RunPaths",
    "resolve_ocr_output_root",
    "resolve_public_output_root",
    "resolve_run_root",
]
