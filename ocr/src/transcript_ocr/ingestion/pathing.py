"""Path policy helpers for OCR runs."""

from __future__ import annotations

import os
from dataclasses import dataclass

from ..config.paths import PUBLIC_EDITIONS_DIR


def resolve_public_output_root() -> str:
    os.makedirs(str(PUBLIC_EDITIONS_DIR), exist_ok=True)
    return str(PUBLIC_EDITIONS_DIR)


@dataclass(frozen=True)
class RunPaths:
    edition_dir: str
    public_output_root: str
    manifest_path: str | None = None
    work_root: str | None = None


__all__ = [
    "RunPaths",
    "resolve_public_output_root",
]
