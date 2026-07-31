"""Lossless source-master conversion for TIFF newspaper scans.

TIFF inputs are decoded frame-by-frame and written as PNG source masters.  The
source TIFF is removed only after every frame has been decoded, written,
re-opened, and verified pixel-for-pixel.  No grayscale conversion or other
image enhancement belongs in this stage; OCR derivatives are created by
``image_preprocessor``.
"""

from __future__ import annotations

import glob
import os
from pathlib import Path

import numpy as np
from PIL import Image

from ..config.constants import TIF_EXTENSIONS
from ..shared.console import stage, substep, success


class LosslessConversionError(RuntimeError):
    """Raised when a TIFF frame cannot be represented and verified losslessly."""


def _frame_output_paths(source: Path, frame_count: int) -> list[Path]:
    if frame_count == 1:
        return [source.with_suffix(".png")]
    return [
        source.with_name(f"{source.stem}_frame_{index:04d}.png")
        for index in range(1, frame_count + 1)
    ]


def _decoded_pixels(image: Image.Image) -> np.ndarray:
    """Return an owned array so comparisons outlive PIL's lazy decoder."""
    return np.array(image, copy=True)


def _verify_lossless_frame(expected: Image.Image, output_path: Path) -> None:
    """Verify dimensions, decoded sample type, pixels, and palette appearance."""
    try:
        with Image.open(output_path) as actual:
            actual.load()
            if actual.size != expected.size:
                raise LosslessConversionError(
                    f"dimension mismatch: expected {expected.size}, got {actual.size}"
                )

            expected_pixels = _decoded_pixels(expected)
            actual_pixels = _decoded_pixels(actual)
            if (
                expected_pixels.shape != actual_pixels.shape
                or expected_pixels.dtype != actual_pixels.dtype
                or not np.array_equal(expected_pixels, actual_pixels)
            ):
                raise LosslessConversionError(
                    "decoded pixel samples changed during TIFF-to-PNG conversion"
                )

            # Palette indices can compare equal even if their palette changed.
            if expected.mode == "P":
                expected_rgba = _decoded_pixels(expected.convert("RGBA"))
                actual_rgba = _decoded_pixels(actual.convert("RGBA"))
                if not np.array_equal(expected_rgba, actual_rgba):
                    raise LosslessConversionError(
                        "palette colors changed during TIFF-to-PNG conversion"
                    )
    except LosslessConversionError:
        raise
    except Exception as exc:
        raise LosslessConversionError(f"cannot decode converted PNG: {exc}") from exc


def _png_save_options(frame: Image.Image) -> dict[str, object]:
    options: dict[str, object] = {"optimize": True}
    if frame.info.get("icc_profile"):
        options["icc_profile"] = frame.info["icc_profile"]
    if frame.info.get("dpi"):
        options["dpi"] = frame.info["dpi"]
    if frame.mode == "P" and "transparency" in frame.info:
        options["transparency"] = frame.info["transparency"]
    return options


def convert_tiff_file(source_path: str | os.PathLike[str]) -> list[str]:
    """Convert every frame in one TIFF to verified PNG source masters.

    Outputs are staged as ``*.part`` files and committed with ``os.replace``.
    Existing outputs are accepted only when they match their source frame
    exactly.  On any failure, staged files are removed and the TIFF is retained.
    """
    source = Path(source_path)
    if source.suffix.lower() not in TIF_EXTENSIONS:
        raise ValueError(f"not a TIFF path: {source}")

    staged: list[tuple[Path, Path]] = []
    outputs: list[Path] = []
    try:
        with Image.open(source) as image:
            frame_count = getattr(image, "n_frames", 1)
            if frame_count < 1:
                raise LosslessConversionError(
                    f"TIFF contains no decodable frames: {source.name}"
                )
            outputs = _frame_output_paths(source, frame_count)
            for frame_offset, output in enumerate(outputs):
                frame_index = frame_offset + 1
                image.seek(frame_offset)
                frame = image.copy()
                frame.load()
                if output.exists():
                    try:
                        _verify_lossless_frame(frame, output)
                    except LosslessConversionError as exc:
                        raise LosslessConversionError(
                            f"existing output {output.name} does not match frame "
                            f"{frame_index}: {exc}"
                        ) from exc
                    continue

                part = output.with_name(output.name + ".part")
                if part.exists():
                    part.unlink()
                try:
                    frame.save(part, format="PNG", **_png_save_options(frame))
                    with part.open("rb") as handle:
                        os.fsync(handle.fileno())
                    _verify_lossless_frame(frame, part)
                except LosslessConversionError:
                    raise
                except Exception as exc:
                    raise LosslessConversionError(
                        f"frame {frame_index} cannot be represented losslessly as PNG: {exc}"
                    ) from exc
                staged.append((part, output))

        # All frames have passed before any newly-created output is committed.
        for part, output in staged:
            os.replace(part, output)

        # Re-open committed files as a final guard before deleting the source.
        with Image.open(source) as image:
            for frame_offset, output in enumerate(outputs):
                image.seek(frame_offset)
                frame = image.copy()
                frame.load()
                _verify_lossless_frame(frame, output)
        source.unlink()
        return [str(path) for path in outputs]
    except Exception:
        for part, _output in staged:
            try:
                part.unlink()
            except FileNotFoundError:
                pass
        raise


def convert_edition_images(edition_dir: str) -> int:
    """Convert all TIFF inputs in an edition to verified source-master PNGs.

    The return value remains the number of source TIFF files that produced at
    least one newly-created PNG, preserving the existing orchestration API.
    """
    source_files = sorted(
        Path(path)
        for path in glob.glob(os.path.join(edition_dir, "*"))
        if os.path.splitext(path)[1].lower() in TIF_EXTENSIONS
    )
    if not source_files:
        return 0

    stage("TIFF source-master conversion", 0, 6)
    converted_sources = 0
    for source in source_files:
        with Image.open(source) as image:
            frame_count = getattr(image, "n_frames", 1)
        expected_outputs = _frame_output_paths(source, frame_count)
        existing_before = {path for path in expected_outputs if path.exists()}
        source_size_mb = source.stat().st_size / (1024 * 1024)
        outputs = convert_tiff_file(source)
        if any(Path(path) not in existing_before for path in outputs):
            converted_sources += 1
        output_size_mb = sum(Path(path).stat().st_size for path in outputs) / (1024 * 1024)
        substep(
            f"{source.name} -> {len(outputs)} verified PNG frame(s) "
            f"({source_size_mb:.1f} MB -> {output_size_mb:.1f} MB)"
        )

    remaining = [
        path
        for path in glob.glob(os.path.join(edition_dir, "*"))
        if os.path.splitext(path)[1].lower() in TIF_EXTENSIONS
    ]
    if remaining:
        names = ", ".join(os.path.basename(path) for path in remaining)
        raise LosslessConversionError(f"TIFF files remain after conversion: {names}")

    success(
        f"Converted {converted_sources} TIFF source"
        f"{'s' if converted_sources != 1 else ''} losslessly"
    )
    return converted_sources


def convert_edition_images_tolerant(edition_dir: str) -> dict[str, str]:
    """Convert every TIFF independently and return per-source failures.

    Edition orchestration uses this variant so one corrupt canvas consumes its
    manifest page state without automatically failing the other pages.
    """
    failures: dict[str, str] = {}
    source_files = sorted(
        Path(path)
        for path in glob.glob(os.path.join(edition_dir, "*"))
        if os.path.splitext(path)[1].lower() in TIF_EXTENSIONS
    )
    for source in source_files:
        try:
            convert_tiff_file(source)
        except Exception as exc:
            failures[source.name] = str(exc)
    return failures


__all__ = [
    "LosslessConversionError",
    "convert_edition_images",
    "convert_edition_images_tolerant",
    "convert_tiff_file",
]
