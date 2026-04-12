"""Phase 0: Convert TIF scans to optimized lossless PNG.

Runs at the very start of the pipeline, before any other phase.
Converts all TIF/TIFF files to grayscale PNG with optimize=True,
then deletes the originals. Idempotent — skips already-converted files.

JPG/JPEG files are left as-is — the pipeline handles them natively
and converting to PNG would triple their file size for no benefit.
"""

from __future__ import annotations

import glob
import os

from PIL import Image, ImageOps

from ..config.constants import TIF_EXTENSIONS
from ..shared.console import stage, substep, success


def convert_edition_images(edition_dir: str) -> int:
    """Convert all TIF/TIFF files in *edition_dir* to optimized PNG.

    Returns the number of files converted.
    """
    source_files = sorted(
        f
        for f in glob.glob(os.path.join(edition_dir, "*"))
        if os.path.splitext(f)[1].lower() in TIF_EXTENSIONS
    )

    if not source_files:
        return 0

    stage("TIF → PNG conversion", 0, 6)
    converted = 0

    for src_path in source_files:
        stem = os.path.splitext(src_path)[0]
        png_path = stem + ".png"
        basename = os.path.basename(src_path)

        # Already converted — just clean up the leftover source
        if os.path.exists(png_path):
            os.remove(src_path)
            substep(f"{basename} → already converted, deleted original")
            continue

        image = Image.open(src_path)
        image = ImageOps.grayscale(image)
        image.save(png_path, format="PNG", optimize=True)

        if not os.path.exists(png_path) or os.path.getsize(png_path) == 0:
            raise RuntimeError(f"PNG conversion failed for {basename}: output missing or empty")

        src_size_mb = os.path.getsize(src_path) / (1024 * 1024)
        png_size_mb = os.path.getsize(png_path) / (1024 * 1024)
        os.remove(src_path)
        converted += 1
        substep(f"{basename} → {os.path.basename(png_path)} ({src_size_mb:.1f} MB → {png_size_mb:.1f} MB)")

    # Guard: verify no TIFs remain
    remaining = [
        f for f in glob.glob(os.path.join(edition_dir, "*"))
        if os.path.splitext(f)[1].lower() in TIF_EXTENSIONS
    ]
    if remaining:
        names = ", ".join(os.path.basename(f) for f in remaining)
        raise RuntimeError(f"TIF files still present after Phase 0: {names}")

    success(f"Converted {converted} TIF{'s' if converted != 1 else ''} to PNG")
    return converted


__all__ = ["convert_edition_images"]
