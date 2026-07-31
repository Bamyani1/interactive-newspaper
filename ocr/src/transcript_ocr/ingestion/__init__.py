"""Edition ingestion contracts and helpers."""

from .discovery import discover_page_images, extract_edition_date
from .download import DownloadReceipt, download_image_atomic
from .manifest import (
    EditionPageInventory,
    PageExpectation,
    discover_page_inventory,
    find_manifest_path,
)

__all__ = [
    "DownloadReceipt",
    "EditionPageInventory",
    "PageExpectation",
    "discover_page_images",
    "discover_page_inventory",
    "download_image_atomic",
    "extract_edition_date",
    "find_manifest_path",
]
