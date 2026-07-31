"""IIIF-manifest-driven edition inventory."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..config.constants import IMAGE_EXTENSIONS

_PAGE_PREFIX = re.compile(r"^(?P<index>\d{4})(?:_|\b)")
_TIFF_FRAME = re.compile(r"_frame_(?P<frame>\d{4})(?:_|$)")
_DEFAULT_MANIFEST_LOCATIONS = (
    "manifest.json",
    "source-manifest.json",
    "source/manifest.json",
)


@dataclass(frozen=True)
class PageExpectation:
    index: int
    canvas_id: str
    label: str
    width: int | None
    height: int | None
    image_service_id: str
    local_path: str | None = None


@dataclass(frozen=True)
class EditionPageInventory:
    edition_dir: str
    manifest_path: str | None
    authoritative: bool
    pages: tuple[PageExpectation, ...]

    @property
    def expected_pages(self) -> int:
        return len(self.pages)

    @property
    def found_pages(self) -> int:
        return sum(page.local_path is not None for page in self.pages)

    @property
    def missing_page_indexes(self) -> tuple[int, ...]:
        return tuple(page.index for page in self.pages if page.local_path is None)

    @property
    def local_paths(self) -> list[str]:
        return [page.local_path for page in self.pages if page.local_path is not None]


def _natural_key(path: Path) -> tuple[object, ...]:
    return tuple(
        int(part) if part.isdigit() else part.casefold()
        for part in re.split(r"(\d+)", path.name)
    )


def find_manifest_path(
    edition_dir: str | os.PathLike[str],
    manifest_path: str | os.PathLike[str] | None = None,
) -> Path | None:
    if manifest_path is not None:
        candidate = Path(manifest_path)
        if not candidate.is_file():
            raise FileNotFoundError(f"manifest not found: {candidate}")
        return candidate
    root = Path(edition_dir)
    for relative in _DEFAULT_MANIFEST_LOCATIONS:
        candidate = root / relative
        if candidate.is_file():
            return candidate
    return None


def _extract_canvases(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    sequences = manifest.get("sequences")
    if isinstance(sequences, list):
        canvases: list[dict[str, Any]] = []
        for sequence in sequences:
            if isinstance(sequence, dict) and isinstance(sequence.get("canvases"), list):
                canvases.extend(
                    canvas
                    for canvas in sequence["canvases"]
                    if isinstance(canvas, dict)
                )
        if canvases:
            return canvases
    items = manifest.get("items")
    return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []


def _flatten_label(value: object) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        for item in value:
            text = _flatten_label(item)
            if text:
                return text
    if isinstance(value, dict):
        for item in value.values():
            text = _flatten_label(item)
            if text:
                return text
    return ""


def _service_id(canvas: dict[str, Any]) -> str:
    images = canvas.get("images")
    if isinstance(images, list) and images:
        resource = images[0].get("resource", {}) if isinstance(images[0], dict) else {}
        service = resource.get("service", {}) if isinstance(resource, dict) else {}
        if isinstance(service, list):
            service = service[0] if service else {}
        if isinstance(service, dict):
            return str(service.get("@id") or service.get("id") or "")

    pages = canvas.get("items")
    if isinstance(pages, list) and pages and isinstance(pages[0], dict):
        annotations = pages[0].get("items")
        if isinstance(annotations, list) and annotations and isinstance(annotations[0], dict):
            body = annotations[0].get("body", {})
            if isinstance(body, dict):
                service = body.get("service", {})
                if isinstance(service, list):
                    service = service[0] if service else {}
                if isinstance(service, dict):
                    return str(service.get("id") or service.get("@id") or "")
    return ""


def _local_image_files(edition_dir: Path) -> list[Path]:
    files = [
        path
        for path in edition_dir.iterdir()
        if path.is_file()
        and path.suffix.lower() in IMAGE_EXTENSIONS
        and not path.stem.endswith((".source", ".ocr"))
    ]
    return sorted(files, key=_natural_key)


def discover_page_inventory(
    edition_dir: str | os.PathLike[str],
    manifest_path: str | os.PathLike[str] | None = None,
) -> EditionPageInventory:
    """Build expected-page inventory, using IIIF canvases when available.

    A manifest is authoritative: every canvas remains in ``pages`` even when
    its local image is missing.  Local downloader output is matched by its
    four-digit canvas prefix.  Duplicate images for one canvas are rejected.
    """
    root = Path(edition_dir)
    if not root.is_dir():
        raise NotADirectoryError(str(root))
    images = _local_image_files(root)
    resolved_manifest = find_manifest_path(root, manifest_path)
    if resolved_manifest is None:
        pages = tuple(
            PageExpectation(
                index=index,
                canvas_id="",
                label=path.stem,
                width=None,
                height=None,
                image_service_id="",
                local_path=str(path),
            )
            for index, path in enumerate(images, start=1)
        )
        return EditionPageInventory(
            edition_dir=str(root),
            manifest_path=None,
            authoritative=False,
            pages=pages,
        )

    with resolved_manifest.open(encoding="utf-8") as handle:
        manifest = json.load(handle)
    if not isinstance(manifest, dict):
        raise ValueError(f"manifest root must be an object: {resolved_manifest}")
    canvases = _extract_canvases(manifest)
    if not canvases:
        raise ValueError(f"manifest contains no canvases: {resolved_manifest}")

    by_index: dict[int, list[Path]] = {}
    unnumbered: list[str] = []
    for image in images:
        match = _PAGE_PREFIX.match(image.name)
        if match is None:
            unnumbered.append(image.name)
            continue
        index = int(match.group("index"))
        frame_match = _TIFF_FRAME.search(image.stem)
        if frame_match is not None:
            frame = int(frame_match.group("frame"))
            if frame < 1:
                raise ValueError(f"invalid TIFF frame number in {image.name}")
            index += frame - 1
        by_index.setdefault(index, []).append(image)
    if unnumbered:
        raise ValueError(
            "manifest-driven input requires four-digit page prefixes; found: "
            + ", ".join(unnumbered)
        )

    expectations: list[PageExpectation] = []
    for index, canvas in enumerate(canvases, start=1):
        candidates = by_index.pop(index, [])
        if len(candidates) > 1:
            raise ValueError(
                f"canvas {index} has multiple local images: "
                + ", ".join(path.name for path in candidates)
            )
        width = canvas.get("width")
        height = canvas.get("height")
        expectations.append(
            PageExpectation(
                index=index,
                canvas_id=str(canvas.get("@id") or canvas.get("id") or ""),
                label=_flatten_label(canvas.get("label")) or str(index),
                width=int(width) if isinstance(width, (int, float)) else None,
                height=int(height) if isinstance(height, (int, float)) else None,
                image_service_id=_service_id(canvas),
                local_path=str(candidates[0]) if candidates else None,
            )
        )
    if by_index:
        extras = ", ".join(
            path.name for paths in by_index.values() for path in paths
        )
        raise ValueError(f"local images do not map to a manifest canvas: {extras}")

    return EditionPageInventory(
        edition_dir=str(root),
        manifest_path=str(resolved_manifest),
        authoritative=True,
        pages=tuple(expectations),
    )


__all__ = [
    "EditionPageInventory",
    "PageExpectation",
    "discover_page_inventory",
    "find_manifest_path",
]
