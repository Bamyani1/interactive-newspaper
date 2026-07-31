"""Region filtering primitives used by CV detection."""

from __future__ import annotations

from ..config.constants import (
    MAX_ASPECT_RATIO,
    MAX_REGION_AREA_PERCENT,
    MIN_ASPECT_RATIO,
    MIN_REGION_AREA_PIXELS,
)

Region = tuple[int, int, int, int]


def should_keep_region(x1: int, y1: int, x2: int, y2: int, image_width: int, image_height: int) -> bool:
    width = max(0, x2 - x1)
    height = max(0, y2 - y1)
    if width == 0 or height == 0:
        return False

    area = width * height
    if area < MIN_REGION_AREA_PIXELS:
        return False
    if area > int(image_width * image_height * MAX_REGION_AREA_PERCENT):
        return False

    aspect = width / float(height)
    if aspect < MIN_ASPECT_RATIO or aspect > MAX_ASPECT_RATIO:
        return False

    return True


def region_iou(a: Region, b: Region) -> float:
    """Return intersection-over-union for two ``(y1, x1, y2, x2)`` regions."""
    ay1, ax1, ay2, ax2 = a
    by1, bx1, by2, bx2 = b
    iy1, ix1 = max(ay1, by1), max(ax1, bx1)
    iy2, ix2 = min(ay2, by2), min(ax2, bx2)
    intersection = max(0, iy2 - iy1) * max(0, ix2 - ix1)
    area_a = max(0, ay2 - ay1) * max(0, ax2 - ax1)
    area_b = max(0, by2 - by1) * max(0, bx2 - bx1)
    union = area_a + area_b - intersection
    return intersection / union if union > 0 else 0.0


def dedupe_overlapping_regions(
    candidates: list[tuple[int, int, int, int, float]],
    iou_threshold: float = 0.5,
) -> list[tuple[int, int, int, int]]:
    regions: list[tuple[int, int, int, int]] = []
    for y1, x1, y2, x2, _conf in sorted(candidates, key=lambda c: -c[4]):
        region = (y1, x1, y2, x2)
        is_dup = any(region_iou(region, existing) > iou_threshold for existing in regions)
        if not is_dup:
            regions.append(region)
    return regions


__all__ = ["dedupe_overlapping_regions", "region_iou", "should_keep_region"]
