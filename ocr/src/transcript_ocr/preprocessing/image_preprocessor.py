"""Image preprocessing stage."""

from __future__ import annotations

from PIL import Image, ImageEnhance, ImageFilter, ImageOps

from ..contracts.diagnostics_models import PageDiagnostics, StageTimer
from ..shared.console import substep
from .skew import _detect_skew_angle


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


__all__ = ["preprocess_image"]
