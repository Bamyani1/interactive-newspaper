"""Apply visual assignment results to content models."""

from __future__ import annotations

from ..contracts.content_models import ImageRegionAssignments, PageContent
from ..contracts.diagnostics_models import PageDiagnostics
from ..shared.console import warning, info


def _apply_visual_assignments(
    assignments: ImageRegionAssignments,
    page_content: PageContent,
    num_regions: int,
    diag: PageDiagnostics | None = None,
) -> tuple[dict[int, int], dict[int, int], list[int], dict[int, str]]:
    """Validate and apply visual region assignments."""
    region_to_article: dict[int, int] = {}
    region_to_ad: dict[int, int] = {}
    unmatched: list[int] = []
    captions: dict[int, str] = {}
    printed_caption_slots = [
        image.caption
        for article in page_content.articles
        for image in article.images
        if (image.caption or "").strip()
    ]
    seen_regions: set[int] = set()
    invalid_count = 0

    num_articles = len(page_content.articles)
    num_ads = len(page_content.ads)

    if diag is not None:
        diag.visual_matching.assignments_returned = len(assignments.assignments)

    for assignment in assignments.assignments:
        rn = assignment.region_number
        ri = rn - 1

        if ri < 0 or ri >= num_regions:
            warning(f"Invalid region_number {rn} (expected 1-{num_regions})")
            invalid_count += 1
            continue

        if ri in seen_regions:
            warning(f"Duplicate assignment for region {rn}")
            invalid_count += 1
            continue
        seen_regions.add(ri)

        if assignment.attachment == "reject":
            info(f"Region {rn} rejected: {assignment.rejection_reason}")
            if diag is not None:
                if assignment.rejection_reason == "plain_text":
                    diag.visual_matching.rejected_text_ad += 1
                else:
                    diag.visual_matching.rejected_not_image += 1
            continue

        if 0 <= assignment.caption_slot < len(printed_caption_slots):
            captions[ri] = printed_caption_slots[assignment.caption_slot]

        if assignment.attachment == "article":
            if 0 <= assignment.content_index < num_articles:
                region_to_article[ri] = assignment.content_index
            else:
                warning(f"Region {rn} article index {assignment.content_index} out of range (0-{num_articles - 1})")
                invalid_count += 1
                unmatched.append(ri)
        elif assignment.attachment == "ad":
            if 0 <= assignment.content_index < num_ads:
                region_to_ad[ri] = assignment.content_index
            else:
                warning(f"Region {rn} ad index {assignment.content_index} out of range (0-{num_ads - 1})")
                invalid_count += 1
                unmatched.append(ri)
        else:
            unmatched.append(ri)

    for ri in range(num_regions):
        if ri not in seen_regions:
            unmatched.append(ri)

    if diag is not None:
        diag.visual_matching.valid_article_matches = len(region_to_article)
        diag.visual_matching.valid_ad_matches = len(region_to_ad)
        diag.visual_matching.standalone_count = len(unmatched)
        diag.visual_matching.invalid_assignments = invalid_count

        diag.image_matching.total_regions = num_regions
        diag.image_matching.matched_count = len(region_to_article)
        diag.image_matching.unmatched_count = len(unmatched) + len(region_to_ad)
        for ri, ai in region_to_article.items():
            diag.image_matching.match_details.append(
                {
                    "region_idx": ri,
                    "article_idx": ai,
                    "method": "visual",
                }
            )

    return region_to_article, region_to_ad, unmatched, captions


__all__ = ["_apply_visual_assignments"]
