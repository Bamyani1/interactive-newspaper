"""Internal interfaces for OCR providers."""

from __future__ import annotations

from typing import Protocol, Any


class RegionDetector(Protocol):
    def detect_regions(self, image: Any) -> list[tuple[int, int, int, int]]:
        ...


class TextExtractor(Protocol):
    def extract_page(self, image: Any) -> Any:
        ...
