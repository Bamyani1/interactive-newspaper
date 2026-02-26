"""Input discovery helpers for OCR editions."""

from __future__ import annotations

import glob
import os
import re

from ..config.constants import IMAGE_EXTENSIONS


def extract_edition_date(folder_path: str) -> str:
    """Extract YYYY-MM-DD date from folder name like ' 1988-08-31'."""
    basename = os.path.basename(folder_path.rstrip(os.sep))
    match = re.search(r"(\d{4}-\d{2}-\d{2})", basename)
    return match.group(1) if match else basename.strip()


def discover_page_images(edition_dir: str) -> list[str]:
    return sorted(
        f
        for f in glob.glob(os.path.join(edition_dir, "*"))
        if os.path.splitext(f)[1].lower() in IMAGE_EXTENSIONS
    )


__all__ = ["IMAGE_EXTENSIONS", "discover_page_images", "extract_edition_date"]
