"""Newspaper-specific visual detection with a DocLayout table fallback."""

from __future__ import annotations

from PIL import Image

from ..config.constants import HYBRID_FALLBACK_IOU_THRESHOLD
from ..contracts.diagnostics_models import CVRegionInfo, PageDiagnostics, StageTimer
from ..shared.console import info
from .american_stories_provider import detect_american_stories_regions
from .region_filters import region_iou
from .models import RegionProposal, VisualRegionSet
from .yolo_provider import detect_table_regions


def detect_image_regions(
    image: Image.Image,
    diag: PageDiagnostics | None = None,
) -> VisualRegionSet:
    """Use American Stories visuals plus non-overlapping DocLayout tables."""
    timer = StageTimer().start()
    primary = detect_american_stories_regions(image)
    table_detection = detect_table_regions(image)

    regions = list(primary.regions)
    proposals = list(primary.proposals or [
        RegionProposal(region, "american_stories", "visual", 0.0)
        for region in primary.regions
    ])
    fallback_regions: list[tuple[int, int, int, int]] = []
    for table in table_detection.regions:
        max_overlap = max((region_iou(table, region) for region in regions), default=0.0)
        if max_overlap < HYBRID_FALLBACK_IOU_THRESHOLD:
            regions.append(table)
            fallback_regions.append(table)
            matching = next(
                (proposal for proposal in (table_detection.proposals or []) if proposal.bounds == table),
                RegionProposal(table, "doclayout_yolo", "table", 0.0),
            )
            proposals.append(matching)

    info(
        f"Hybrid visual detector: {len(primary.regions)} American Stories + "
        f"{len(fallback_regions)} DocLayout table fallback = {len(regions)} region(s)"
    )

    if diag is not None:
        diag.cv_info = CVRegionInfo(
            detector="hybrid",
            total_components_found=primary.total_detections + table_detection.total_detections,
            filtered_by_class=primary.filtered_by_class + table_detection.filtered_by_class,
            filtered_by_area=primary.filtered_by_area + table_detection.filtered_by_area,
            filtered_by_aspect_ratio=primary.filtered_by_aspect + table_detection.filtered_by_aspect,
            regions_kept=len(regions),
            bounding_boxes=list(regions),
            american_stories_regions=len(primary.regions),
            american_stories_boxes=list(primary.regions),
            doclayout_table_regions=len(fallback_regions),
            doclayout_table_boxes=list(fallback_regions),
        )
        diag.timings["cv"] = timer.stop()

    return VisualRegionSet(proposals)


__all__ = ["detect_image_regions"]
