"""Gemini visual-type and content-attachment matching."""

from __future__ import annotations

from PIL import Image

from ..config.model_calls import (
    build_generation_config,
    image_part_ultra_high,
    model_name,
)
from ..contracts.content_models import (
    ImageRegionAssignment,
    ImageRegionAssignments,
    PageContent,
)
from ..contracts.diagnostics_models import PageDiagnostics, StageTimer, TokenUsage
from ..recognition.prompts import IMAGE_MATCHING_PROMPT
from ..shared.console import error, substep, warning
from ..shared.retry import gemini_generate_with_retry
from ..shared.text import split_sentences


_MAX_REGIONS_PER_CALL = 40


def _targeted_sentences(body: str, *, first: int, last: int = 0) -> str:
    sentences = split_sentences(body or "")
    if not sentences:
        return ""
    if last <= 0 or len(sentences) <= first + last:
        selected = sentences[:first]
    else:
        selected = sentences[:first] + sentences[-last:]
    return " ".join(selected)


def _build_content_context(page_content: PageContent) -> tuple[str, int]:
    """Build the locked targeted context and number printed-caption slots."""
    parts: list[str] = []
    caption_slot = 0

    for index, article in enumerate(page_content.articles):
        parts.append(f"ARTICLE [{index}]")
        parts.append(f"  headline: {article.headline or '(none)'}")
        parts.append(f"  author: {article.author or '(none)'}")
        sentences = split_sentences(article.body or "")
        context = (
            article.body.strip()
            if len(sentences) <= 4
            else _targeted_sentences(article.body, first=2, last=2)
        )
        if context:
            parts.append(f"  context: {context}")
        for image in article.images:
            printed_caption = (getattr(image, "caption", "") or "").strip()
            if printed_caption:
                parts.append(
                    f"  printed_caption_slot [{caption_slot}]: {printed_caption}"
                )
                caption_slot += 1

    for index, ad in enumerate(page_content.ads):
        parts.append(f"AD [{index}]")
        parts.append(f"  business_name: {ad.business_name or '(none)'}")
        if ad.body:
            parts.append(f"  complete_text: {ad.body.strip()}")

    for index, other in enumerate(page_content.other_content):
        parts.append(f"OTHER [{index}]")
        parts.append(f"  title: {other.title or '(none)'}")
        context = _targeted_sentences(other.body, first=2)
        if context:
            parts.append(f"  context: {context}")

    return ("\n".join(parts) if parts else "(no extracted text items)", caption_slot)


def _assignment_validation_reason(
    response,
    *,
    expected_region_ids: list[int],
    num_articles: int,
    num_ads: int,
    caption_slots: int,
) -> str:
    parsed = getattr(response, "parsed", None)
    if not isinstance(parsed, ImageRegionAssignments):
        return "parsed output is missing or has the wrong response type."
    if len(parsed.assignments) != len(expected_region_ids):
        return (
            f"expected {len(expected_region_ids)} assignments but received "
            f"{len(parsed.assignments)}."
        )
    expected = set(expected_region_ids)
    returned_list = [assignment.region_number for assignment in parsed.assignments]
    returned = set(returned_list)
    if returned != expected:
        return (
            f"region IDs must be exactly {sorted(expected)}; received "
            f"{returned_list}."
        )
    if len(returned_list) != len(returned):
        return f"region IDs contain duplicates: {returned_list}."
    for assignment in parsed.assignments:
        if assignment.attachment == "article":
            if not 0 <= assignment.content_index < num_articles:
                return f"region {assignment.region_number} has an invalid article index."
        elif assignment.attachment == "ad":
            if not 0 <= assignment.content_index < num_ads:
                return f"region {assignment.region_number} has an invalid ad index."
        elif assignment.content_index != -1:
            return f"region {assignment.region_number} must use content_index -1."
        if assignment.caption_slot != -1 and not 0 <= assignment.caption_slot < caption_slots:
            return f"region {assignment.region_number} has an invalid caption slot."
        if assignment.visual_type == "unresolved" and assignment.attachment != "standalone":
            return f"region {assignment.region_number} unresolved must be standalone."
        if assignment.visual_type in {"plain_text", "scanner_decorative_artifact"}:
            if assignment.attachment != "reject":
                return (
                    f"region {assignment.region_number} is {assignment.visual_type} "
                    "and must be rejected."
                )
            if assignment.rejection_reason != assignment.visual_type:
                return (
                    f"region {assignment.region_number} rejection reason must match "
                    f"{assignment.visual_type}."
                )
        if assignment.attachment == "reject" and not assignment.rejection_reason:
            return f"region {assignment.region_number} is rejected without a reason."
        if assignment.attachment != "reject" and assignment.rejection_reason:
            return f"region {assignment.region_number} has a reason but is not rejected."
        # Pixel area is enforced deterministically after this call.  The
        # response contract carries the final disposition, but Gemini must not
        # manufacture it from apparent on-screen size.
        if assignment.rejection_reason == "rejected_small_ad_visual":
            return f"region {assignment.region_number} selected a caller-only reason."
    return ""


def _assignments_are_complete(
    response,
    *,
    expected_region_ids: list[int],
    num_articles: int,
    num_ads: int,
    caption_slots: int,
) -> bool:
    return not _assignment_validation_reason(
        response,
        expected_region_ids=expected_region_ids,
        num_articles=num_articles,
        num_ads=num_ads,
        caption_slots=caption_slots,
    )


def _unresolved_assignments(region_ids: int | list[int]) -> ImageRegionAssignments:
    """Return a non-semantic fallback; every candidate remains preserved."""
    if isinstance(region_ids, int):
        region_ids = list(range(1, region_ids + 1))
    return ImageRegionAssignments(
        assignments=[
            ImageRegionAssignment(
                region_number=index,
                visual_type="unresolved",
                attachment="standalone",
                content_index=-1,
                caption_slot=-1,
                rejection_reason=None,
            )
            for index in region_ids
        ]
    )


def match_images_visual(
    client,
    annotated_image: Image.Image,
    page_content: PageContent,
    num_regions: int,
    diag: PageDiagnostics | None = None,
    evidence_images: list[Image.Image] | None = None,
) -> ImageRegionAssignments:
    """Classify and attach every detected region without spatial fallback.

    ``evidence_images`` should contain the clean, padded crops in region order.
    It remains optional for import compatibility while the page orchestration
    migrates; every image part that is supplied is marked ULTRA_HIGH.
    """
    timer = StageTimer().start()
    if diag is not None:
        diag.visual_matching.attempted = True

    content_list, caption_slots = _build_content_context(page_content)
    generation_config = build_generation_config(
        "image_matching",
        response_mime_type="application/json",
        response_schema=ImageRegionAssignments,
        max_output_tokens=65536,
    )
    all_assignments: list[ImageRegionAssignment] = []
    aggregate_usage = TokenUsage()
    every_batch_succeeded = True
    all_region_ids = list(range(1, num_regions + 1))

    for batch_start in range(0, num_regions, _MAX_REGIONS_PER_CALL):
        batch_ids = all_region_ids[batch_start : batch_start + _MAX_REGIONS_PER_CALL]
        prompt = IMAGE_MATCHING_PROMPT.format(
            content_list=content_list,
            num_regions=num_regions,
            region_ids=", ".join(str(region_id) for region_id in batch_ids),
        )
        # Repeat the full annotated source page in every batch so global IDs
        # and page layout remain interpretable.
        contents: list = [
            "Annotated full page (region numbers are global across this page):",
            image_part_ultra_high(annotated_image),
        ]
        for region_id in batch_ids:
            crop_index = region_id - 1
            if evidence_images and crop_index < len(evidence_images):
                contents.extend(
                    [
                        f"Evidence crop for global region {region_id}:",
                        image_part_ultra_high(evidence_images[crop_index]),
                    ]
                )
        contents.append(prompt)
        def validator(response, ids=batch_ids):
            return _assignments_are_complete(
                response,
                expected_region_ids=ids,
                num_articles=len(page_content.articles),
                num_ads=len(page_content.ads),
                caption_slots=caption_slots,
            )

        try:
            response = gemini_generate_with_retry(
                client,
                model=model_name("image_matching"),
                contents=contents,
                config=generation_config,
                stage="image_matching",
                response_validator=validator,
                schema_retry_instruction=lambda candidate, ids=batch_ids: (
                    _assignment_validation_reason(
                        candidate,
                        expected_region_ids=ids,
                        num_articles=len(page_content.articles),
                        num_ads=len(page_content.ads),
                        caption_slots=caption_slots,
                    )
                ),
                max_schema_retries=1,
            )
            if validator(response):
                usage = getattr(response, "usage_metadata", None)
                if usage:
                    batch_prompt = getattr(usage, "prompt_token_count", 0) or 0
                    batch_candidates = getattr(usage, "candidates_token_count", 0) or 0
                    substep(
                        f"Visual batch {batch_start // _MAX_REGIONS_PER_CALL + 1} "
                        f"tokens: {batch_prompt} in, {batch_candidates} out"
                    )
                    aggregate_usage.prompt_tokens += batch_prompt
                    aggregate_usage.candidates_tokens += batch_candidates
                    aggregate_usage.thoughts_tokens += (
                        getattr(usage, "thoughts_token_count", 0) or 0
                    )
                    aggregate_usage.tool_use_prompt_tokens += (
                        getattr(usage, "tool_use_prompt_token_count", 0) or 0
                    )
                    aggregate_usage.cached_content_tokens += (
                        getattr(usage, "cached_content_token_count", 0) or 0
                    )
                    aggregate_usage.total_tokens += (
                        getattr(usage, "total_token_count", 0) or 0
                    )
                all_assignments.extend(response.parsed.assignments)
                continue
            warning(
                f"Visual batch IDs {batch_ids} remained incomplete; "
                "preserving that batch as unresolved standalone"
            )
        except Exception as exc:
            error(f"Visual matching failed for batch IDs {batch_ids}: {exc}")

        every_batch_succeeded = False
        all_assignments.extend(_unresolved_assignments(batch_ids).assignments)

    if diag is not None:
        diag.visual_matching.tokens = aggregate_usage
        diag.visual_matching.succeeded = every_batch_succeeded
        diag.timings["visual_matching"] = timer.stop()
    return ImageRegionAssignments(assignments=all_assignments)


__all__ = [
    "_build_content_context",
    "_unresolved_assignments",
    "match_images_visual",
]
