"""Fixed-profile skew estimation for newspaper OCR derivatives."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image
from scipy import ndimage

SKEW_MIN_DEGREES = -2.0
SKEW_MAX_DEGREES = 2.0
SKEW_STEP_DEGREES = 0.1
SKEW_APPLY_THRESHOLD_DEGREES = 0.2


@dataclass(frozen=True)
class SkewEstimate:
    """Projection-profile result before the rotation policy is applied."""

    measured_angle: float
    applied_angle: float
    hit_search_boundary: bool = False


def estimate_skew_angle(image: Image.Image) -> SkewEstimate:
    """Estimate deskew rotation over the locked -2 to +2 degree search.

    The search runs in 0.1 degree increments.  A maximum at either boundary is
    treated as unreliable and never rotated.  Estimates below 0.2 degrees are
    also left unchanged.
    """
    arr = np.asarray(image.convert("L"), dtype=np.uint8)
    binary = (arr < 128).astype(np.float64)

    # Subsampling is analysis-only; it never changes either output image.
    if binary.shape[0] > 1500:
        stride = max(1, binary.shape[0] // 1500)
        binary = binary[::stride, ::stride]

    best_angle = 0.0
    best_variance = -1.0
    for angle_tenths in range(-20, 21):
        angle = angle_tenths / 10.0
        rotated = ndimage.rotate(
            binary,
            angle,
            reshape=False,
            order=0,
            mode="constant",
            cval=0.0,
            prefilter=False,
        )
        variance = float(np.var(rotated.sum(axis=1)))
        # Stable tie-breaking favors the smaller correction and then +angle.
        if variance > best_variance or (
            np.isclose(variance, best_variance)
            and (abs(angle), -angle) < (abs(best_angle), -best_angle)
        ):
            best_variance = variance
            best_angle = angle

    boundary = best_angle in {SKEW_MIN_DEGREES, SKEW_MAX_DEGREES}
    applied = 0.0
    if not boundary and abs(best_angle) >= SKEW_APPLY_THRESHOLD_DEGREES:
        applied = best_angle
    return SkewEstimate(
        measured_angle=best_angle,
        applied_angle=applied,
        hit_search_boundary=boundary,
    )


def _detect_skew_angle(image: Image.Image) -> float:
    """Backward-compatible helper returning only the safe applied angle."""
    return estimate_skew_angle(image).applied_angle


__all__ = [
    "SKEW_APPLY_THRESHOLD_DEGREES",
    "SKEW_MAX_DEGREES",
    "SKEW_MIN_DEGREES",
    "SKEW_STEP_DEGREES",
    "SkewEstimate",
    "_detect_skew_angle",
    "estimate_skew_angle",
]
