"""Path policy helpers for OCR runs."""

from __future__ import annotations

import os
from dataclasses import dataclass


def resolve_public_output_root(script_dir: str, cli_root: str = "") -> str:
    output_dir = cli_root or os.path.join(script_dir, "..", "public", "editions")
    os.makedirs(output_dir, exist_ok=True)
    return output_dir


def resolve_ocr_output_root(script_dir: str, cli_root: str = "") -> str:
    output_dir = cli_root or os.path.join(script_dir, "runs")
    os.makedirs(output_dir, exist_ok=True)
    return output_dir


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
