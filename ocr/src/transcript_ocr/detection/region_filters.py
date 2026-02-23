"""Region filtering primitives used by CV detection."""

from __future__ import annotations

from ..config.constants import (
    MAX_ASPECT_RATIO,
    MAX_REGION_AREA_PERCENT,
    MIN_ASPECT_RATIO,
    MIN_REGION_AREA_PIXELS,
)


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


def dedupe_overlapping_regions(
    candidates: list[tuple[int, int, int, int, float]],
    iou_threshold: float = 0.5,
) -> list[tuple[int, int, int, int]]:
    regions: list[tuple[int, int, int, int]] = []
    for y1, x1, y2, x2, _conf in sorted(candidates, key=lambda c: -c[4]):
        is_dup = False
        for ry1, rx1, ry2, rx2 in regions:
            iy1, ix1 = max(y1, ry1), max(x1, rx1)
            iy2, ix2 = min(y2, ry2), min(x2, rx2)
            inter = max(0, iy2 - iy1) * max(0, ix2 - ix1)
            area_a = (y2 - y1) * (x2 - x1)
            area_b = (ry2 - ry1) * (rx2 - rx1)
            union = area_a + area_b - inter
            if union > 0 and inter / union > iou_threshold:
                is_dup = True
                break
        if not is_dup:
            regions.append((y1, x1, y2, x2))
    return regions


__all__ = ["dedupe_overlapping_regions", "should_keep_region"]
