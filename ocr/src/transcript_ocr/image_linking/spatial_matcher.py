"""Spatial image-to-content matching helpers."""

from __future__ import annotations

from ..contracts.content_models import Article
from ..contracts.diagnostics_models import PageDiagnostics, StageTimer
from ..shared.console import warning

_POSITION_MAP = {
    "top-left": (0, 0),
    "upper-left": (0, 0),
    "top-center": (0, 1),
    "upper-center": (0, 1),
    "top": (0, 1),
    "top-right": (0, 2),
    "upper-right": (0, 2),
    "center-left": (1, 0),
    "left": (1, 0),
    "middle-left": (1, 0),
    "center": (1, 1),
    "middle": (1, 1),
    "center-right": (1, 2),
    "right": (1, 2),
    "middle-right": (1, 2),
    "bottom-left": (2, 0),
    "lower-left": (2, 0),
    "bottom-center": (2, 1),
    "lower-center": (2, 1),
    "bottom": (2, 1),
    "bottom-right": (2, 2),
    "lower-right": (2, 2),
}


def _position_to_zone(position: str) -> tuple[float, float]:
    """Convert a position string to (row_frac, col_frac) in [0,1] range."""
    key = position.strip().lower()
    if key in _POSITION_MAP:
        row, col = _POSITION_MAP[key]
        return (row / 2.0, col / 2.0)
    if key:
        warning(f"Unknown image position '{position}', defaulting to center")
    return (0.5, 0.5)


def _region_center_zone(
    region: tuple[int, int, int, int],
    img_height: int,
    img_width: int,
) -> tuple[float, float]:
    """Convert a bounding box center to (row_frac, col_frac) in [0,1] range."""
    y_min, x_min, y_max, x_max = region
    cy = (y_min + y_max) / 2.0 / img_height
    cx = (x_min + x_max) / 2.0 / img_width
    return (cy, cx)


def match_images_to_articles(
    regions: list[tuple[int, int, int, int]],
    articles: list[Article],
    img_height: int,
    img_width: int,
    diag: PageDiagnostics | None = None,
) -> tuple[dict[int, int], list[int]]:
    """Match CV-detected image regions to articles using position hints."""
    timer = StageTimer().start()

    if not regions:
        if diag is not None:
            diag.timings["image_matching"] = timer.stop()
        return {}, []

    article_zones = []
    for ai, article in enumerate(articles):
        for ii, img in enumerate(article.images):
            zone = _position_to_zone(img.position)
            article_zones.append((ai, ii, zone[0], zone[1]))

    region_to_article: dict[int, int] = {}
    unmatched = []
    used_article_images = set()

    for ri, region in enumerate(regions):
        rzone = _region_center_zone(region, img_height, img_width)

        best_dist = float("inf")
        best_ai = -1
        best_key = None

        for ai, ii, az_r, az_c in article_zones:
            key = (ai, ii)
            if key in used_article_images:
                continue
            dist = ((rzone[0] - az_r) ** 2 + (rzone[1] - az_c) ** 2) ** 0.5
            if dist < best_dist:
                best_dist = dist
                best_ai = ai
                best_key = key

        if best_key is not None and best_dist < 0.4:
            region_to_article[ri] = best_ai
            used_article_images.add(best_key)
            if diag is not None:
                diag.image_matching.match_details.append(
                    {
                        "region_idx": ri,
                        "article_idx": best_ai,
                        "distance": round(best_dist, 4),
                    }
                )
        else:
            unmatched.append(ri)

    if diag is not None:
        diag.image_matching.total_regions = len(regions)
        diag.image_matching.matched_count = len(region_to_article)
        diag.image_matching.unmatched_count = len(unmatched)
        diag.timings["image_matching"] = timer.stop()

    return region_to_article, unmatched


__all__ = ["_position_to_zone", "_region_center_zone", "match_images_to_articles"]
