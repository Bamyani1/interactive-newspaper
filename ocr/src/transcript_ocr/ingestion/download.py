"""Atomic, validated download primitives for page-image ingestors."""

from __future__ import annotations

import hashlib
import os
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Callable

from PIL import Image


@dataclass(frozen=True)
class DownloadReceipt:
    path: str
    byte_count: int
    sha256: str
    dimensions: tuple[int, int]
    mode: str


def _validate_downloaded_image(
    path: Path,
    expected_dimensions: tuple[int, int] | None,
) -> tuple[tuple[int, int], str]:
    with Image.open(path) as image:
        image.load()
        if expected_dimensions is not None and image.size != expected_dimensions:
            raise ValueError(
                f"downloaded dimensions {image.size} do not match expected "
                f"{expected_dimensions}"
            )
        return image.size, image.mode


def download_image_atomic(
    url: str,
    destination: str | os.PathLike[str],
    *,
    timeout_seconds: float = 30.0,
    expected_dimensions: tuple[int, int] | None = None,
    expected_sha256: str | None = None,
    opener: Callable[..., BinaryIO] = urllib.request.urlopen,
) -> DownloadReceipt:
    """Stream an image through ``<destination>.part``, validate, then replace."""
    target = Path(destination)
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_name(target.name + ".part")
    digest = hashlib.sha256()
    byte_count = 0
    try:
        try:
            part.unlink()
        except FileNotFoundError:
            pass
        with opener(url, timeout=timeout_seconds) as response, part.open("wb") as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                output.write(chunk)
                digest.update(chunk)
                byte_count += len(chunk)
            output.flush()
            os.fsync(output.fileno())
        if byte_count == 0:
            raise ValueError("downloaded image is empty")
        actual_sha256 = digest.hexdigest()
        if expected_sha256 is not None and actual_sha256.casefold() != expected_sha256.casefold():
            raise ValueError(
                f"downloaded SHA-256 {actual_sha256} does not match expected "
                f"{expected_sha256}"
            )
        dimensions, mode = _validate_downloaded_image(part, expected_dimensions)
        os.replace(part, target)
        return DownloadReceipt(
            path=str(target),
            byte_count=byte_count,
            sha256=actual_sha256,
            dimensions=dimensions,
            mode=mode,
        )
    finally:
        try:
            part.unlink()
        except FileNotFoundError:
            pass


__all__ = ["DownloadReceipt", "download_image_atomic"]
