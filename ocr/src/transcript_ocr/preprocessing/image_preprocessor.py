"""Image preprocessing stage."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

from ..contracts.diagnostics_models import PageDiagnostics, StageTimer
from ..shared.console import substep
from .skew import _detect_skew_angle


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


def check_page_quality(image: Image.Image) -> PageQualityWarning:
    """Check image quality before sending to DocAI.

    Returns a PageQualityWarning with skip/warning flags.
    """
    width, height = image.size

    # Low resolution check
    if width < 500 or height < 500:
        return PageQualityWarning(is_low_res=True, message=f"Low resolution: {width}x{height}")

    # Convert to grayscale array for pixel analysis
    gray = np.array(image.convert("L"))

    # Blank page detection: >95% of pixels within 10 values of the median
    median_val = int(np.median(gray))
    within_range = np.sum(np.abs(gray.astype(int) - median_val) < 10)
    blank_ratio = within_range / gray.size
    if blank_ratio > 0.95:
        return PageQualityWarning(is_blank=True, message=f"Blank page detected ({blank_ratio:.1%} uniform)")

    # Inverted scan detection: median < 64 means mostly dark
    if median_val < 64:
        return PageQualityWarning(is_inverted=True, message=f"Possibly inverted scan (median pixel: {median_val})")

    return PageQualityWarning()


def preprocess_image(
    image: Image.Image,
    diag: PageDiagnostics | None = None,
) -> Image.Image:
    """Preprocess a scanned newspaper page image for better OCR accuracy."""
    timer = StageTimer().start()

    if diag is not None:
        diag.original_dimensions = image.size

    image = ImageOps.exif_transpose(image)
    image = ImageOps.grayscale(image)

    skew_angle = _detect_skew_angle(image)
    if skew_angle != 0.0:
        substep(f"Deskewing by {skew_angle:.1f}\u00b0")
        image = image.rotate(skew_angle, resample=Image.BICUBIC, expand=True, fillcolor=255)

    image = ImageEnhance.Contrast(image).enhance(1.5)
    image = image.filter(ImageFilter.UnsharpMask(radius=1.0, percent=50, threshold=3))

    if diag is not None:
        diag.skew_angle = skew_angle
        diag.preprocessed_dimensions = image.size
        diag.timings["preprocess"] = timer.stop()

    return image


__all__ = ["PageQualityWarning", "check_page_quality", "preprocess_image"]
