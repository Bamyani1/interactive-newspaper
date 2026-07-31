"""Input discovery helpers for OCR editions."""

from __future__ import annotations

import os
import re

from ..config.constants import IMAGE_EXTENSIONS
from .manifest import discover_page_inventory


def extract_edition_date(folder_path: str) -> str:
    """Extract YYYY-MM-DD date from folder name like ' 1988-08-31'."""
    basename = os.path.basename(folder_path.rstrip(os.sep))
    match = re.search(r"(\d{4}-\d{2}-\d{2})", basename)
    return match.group(1) if match else basename.strip()


def discover_page_images(
    edition_dir: str,
    manifest_path: str | None = None,
) -> list[str]:
    """Return local pages in manifest canvas order when a manifest exists."""
    return discover_page_inventory(edition_dir, manifest_path).local_paths


__all__ = ["IMAGE_EXTENSIONS", "discover_page_images", "extract_edition_date"]
