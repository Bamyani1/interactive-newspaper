"""Runtime router for the licensed newspaper-layout detector stack."""

from __future__ import annotations

import os

from PIL import Image

from ..contracts.diagnostics_models import PageDiagnostics


def detect_image_regions(
    image: Image.Image,
    diag: PageDiagnostics | None = None,
) -> list[tuple[int, int, int, int]]:
    """Run American Stories with the current DocLayout table fallback.

    Hosted production must explicitly acknowledge that both detector licenses
    have been reviewed.  Local development and frozen-gold calibration can run
    without that deployment acknowledgement.
    """
    environment = os.getenv("OCR_ENVIRONMENT", "development").strip().lower()
    if environment in {"production", "hosted"} and os.getenv(
        "OCR_DETECTOR_LICENSES_ACCEPTED", ""
    ).strip().lower() not in {"1", "true"}:
        raise RuntimeError(
            "Hosted visual detection is disabled until both American Stories "
            "and DocLayout-YOLO license terms are explicitly accepted with "
            "OCR_DETECTOR_LICENSES_ACCEPTED=true"
        )
    from .hybrid_provider import detect_image_regions as detect_hybrid_images

    return detect_hybrid_images(image, diag=diag)


__all__ = ["detect_image_regions"]
