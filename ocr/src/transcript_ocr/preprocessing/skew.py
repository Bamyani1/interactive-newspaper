"""Skew-detection helpers."""

from __future__ import annotations

import numpy as np
from PIL import Image
from scipy import ndimage


def _detect_skew_angle(image: Image.Image) -> float:
    """Detect rotation angle using horizontal projection profiles."""
    arr = np.array(image.convert("L"))
    binary = (arr < 128).astype(np.float64)

    if binary.shape[0] > 1500:
        scale = binary.shape[0] // 1500
        binary = binary[::scale, ::scale]

    best_angle = 0.0
    best_variance = 0.0

    for angle_10x in range(-150, 151):
        angle = angle_10x / 10.0
        rotated = ndimage.rotate(binary, angle, reshape=False, order=0)
        row_sums = rotated.sum(axis=1)
        variance = np.var(row_sums)
        if variance > best_variance:
            best_variance = variance
            best_angle = angle

    if abs(best_angle) < 0.1:
        return 0.0
    return best_angle


__all__ = ["_detect_skew_angle"]
