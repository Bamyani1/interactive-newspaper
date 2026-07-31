"""Source-master normalization and fixed OCR-derivative preparation."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

from ..contracts.diagnostics_models import PageDiagnostics, StageTimer
from ..shared.console import substep, warning
from .skew import SkewEstimate, estimate_skew_angle


@dataclass
class PageQualityWarning:
    """Result of a pre-OCR quality check."""

    is_blank: bool = False
    is_low_res: bool = False
    is_inverted: bool = False
    message: str = ""

    @property
    def should_skip(self) -> bool:
        return self.is_blank


@dataclass(frozen=True)
class PreparedPagePaths:
    """Explicit filesystem branches for downstream OCR and visual stages."""

    source_master_path: str
    ocr_derivative_path: str
    source_dimensions: tuple[int, int]
    ocr_dimensions: tuple[int, int]
    skew: SkewEstimate


def check_page_quality(image: Image.Image) -> PageQualityWarning:
    """Check image quality before sending it to OCR."""
    width, height = image.size
    gray = np.array(image.convert("L"))

    median_val = int(np.median(gray))
    within_range = np.sum(np.abs(gray.astype(int) - median_val) < 10)
    blank_ratio = within_range / gray.size
    if blank_ratio > 0.95:
        return PageQualityWarning(
            is_blank=True,
            message=f"Blank page detected ({blank_ratio:.1%} uniform)",
        )

    if width < 500 or height < 500:
        return PageQualityWarning(
            is_low_res=True,
            message=f"Low resolution: {width}x{height}",
        )

    if median_val < 64:
        return PageQualityWarning(
            is_inverted=True,
            message=f"Possibly inverted scan (median pixel: {median_val})",
        )

    return PageQualityWarning()


def normalize_source_master(image: Image.Image) -> Image.Image:
    """Return a native-resolution, EXIF-normalized source-quality master.

    Transparency is composited over white.  No resize, sharpening, contrast,
    thresholding, or other enhancement is performed.
    """
    normalized = ImageOps.exif_transpose(image)
    normalized.load()

    has_alpha = normalized.mode in {"RGBA", "LA"} or (
        normalized.mode == "P" and "transparency" in normalized.info
    )
    if has_alpha:
        rgba = normalized.convert("RGBA")
        white = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        return Image.alpha_composite(white, rgba).convert("RGB")

    if normalized.mode == "P":
        return normalized.convert("RGB")
    if normalized.mode == "CMYK":
        return normalized.convert("RGB")
    return normalized.copy()


def create_ocr_derivative(
    source_master: Image.Image,
    *,
    diag: PageDiagnostics | None = None,
) -> tuple[Image.Image, SkewEstimate]:
    """Create the locked 8-bit grayscale, optionally deskewed OCR derivative."""
    timer = StageTimer().start()
    if diag is not None:
        diag.original_dimensions = source_master.size

    derivative = source_master.convert("L")
    estimate = estimate_skew_angle(derivative)
    if estimate.hit_search_boundary:
        warning(
            f"Skew estimate {estimate.measured_angle:.1f} degrees hit the "
            "search boundary; leaving page unrotated"
        )
    elif estimate.applied_angle:
        substep(f"Deskewing OCR derivative by {estimate.applied_angle:.1f} degrees")
        derivative = derivative.rotate(
            estimate.applied_angle,
            resample=Image.Resampling.BICUBIC,
            expand=True,
            fillcolor=255,
        )

    if diag is not None:
        diag.skew_angle = estimate.applied_angle
        diag.preprocessed_dimensions = derivative.size
        diag.timings["preprocess"] = timer.stop()
    return derivative, estimate


def preprocess_image(
    image: Image.Image,
    diag: PageDiagnostics | None = None,
) -> Image.Image:
    """Backward-compatible in-memory API returning only the OCR derivative."""
    source_master = normalize_source_master(image)
    derivative, _estimate = create_ocr_derivative(source_master, diag=diag)
    return derivative


def _save_png_atomic(image: Image.Image, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    part = destination.with_name(destination.name + ".part")
    try:
        save_options: dict[str, object] = {"optimize": True}
        if image.info.get("icc_profile"):
            save_options["icc_profile"] = image.info["icc_profile"]
        if image.info.get("dpi"):
            save_options["dpi"] = image.info["dpi"]
        image.save(part, format="PNG", **save_options)
        with part.open("rb") as handle:
            os.fsync(handle.fileno())
        with Image.open(part) as check:
            check.load()
            if check.size != image.size or not np.array_equal(
                np.asarray(check), np.asarray(image)
            ):
                raise RuntimeError(f"PNG verification failed for {destination.name}")
        os.replace(part, destination)
    finally:
        try:
            part.unlink()
        except FileNotFoundError:
            pass


def prepare_page_image_paths(
    source_path: str | os.PathLike[str],
    work_dir: str | os.PathLike[str],
    *,
    page_key: str | None = None,
    diag: PageDiagnostics | None = None,
) -> PreparedPagePaths:
    """Materialize explicit source-master and OCR-derivative PNG paths.

    The source file is opened read-only.  Both outputs are written atomically in
    the caller-owned work directory and are suitable for run-scoped cleanup.
    """
    source = Path(source_path)
    key = page_key or source.stem
    work = Path(work_dir)
    source_master_path = work / f"{key}.source.png"
    ocr_derivative_path = work / f"{key}.ocr.png"

    with Image.open(source) as opened:
        source_master = normalize_source_master(opened)
    derivative, estimate = create_ocr_derivative(source_master, diag=diag)

    _save_png_atomic(source_master, source_master_path)
    _save_png_atomic(derivative, ocr_derivative_path)
    return PreparedPagePaths(
        source_master_path=str(source_master_path),
        ocr_derivative_path=str(ocr_derivative_path),
        source_dimensions=source_master.size,
        ocr_dimensions=derivative.size,
        skew=estimate,
    )


__all__ = [
    "PageQualityWarning",
    "PreparedPagePaths",
    "check_page_quality",
    "create_ocr_derivative",
    "normalize_source_master",
    "prepare_page_image_paths",
    "preprocess_image",
]
