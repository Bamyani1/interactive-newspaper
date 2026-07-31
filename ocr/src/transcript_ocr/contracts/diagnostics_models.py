"""Canonical OCR diagnostics contracts."""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field


@dataclass
class StageTimer:
    _start: float = 0.0
    elapsed: float = 0.0

    def start(self) -> "StageTimer":
        self._start = time.time()
        return self

    def stop(self) -> float:
        self.elapsed = time.time() - self._start
        return self.elapsed


@dataclass
class TokenUsage:
    prompt_tokens: int = 0
    candidates_tokens: int = 0
    thoughts_tokens: int = 0
    tool_use_prompt_tokens: int = 0
    cached_content_tokens: int = 0
    total_tokens: int = 0


@dataclass
class CVRegionInfo:
    detector: str = "doclayout"
    total_components_found: int = 0
    filtered_by_class: int = 0
    filtered_by_area: int = 0
    filtered_by_aspect_ratio: int = 0
    regions_kept: int = 0
    bounding_boxes: list[tuple[int, int, int, int]] = field(default_factory=list)
    american_stories_regions: int = 0
    american_stories_boxes: list[tuple[int, int, int, int]] = field(default_factory=list)
    doclayout_table_regions: int = 0
    doclayout_table_boxes: list[tuple[int, int, int, int]] = field(default_factory=list)


@dataclass
class DeduplicationInfo:
    articles_before: int = 0
    articles_after: int = 0
    overlapping_pairs_merged: int = 0


@dataclass
class ImageMatchingInfo:
    total_regions: int = 0
    matched_count: int = 0
    unmatched_count: int = 0
    match_details: list[dict] = field(default_factory=list)


@dataclass
class VisualMatchingInfo:
    attempted: bool = False
    succeeded: bool = False
    tokens: TokenUsage = field(default_factory=TokenUsage)
    assignments_returned: int = 0
    valid_article_matches: int = 0
    valid_ad_matches: int = 0
    standalone_count: int = 0
    rejected_not_image: int = 0
    rejected_text_ad: int = 0
    invalid_assignments: int = 0


@dataclass
class PageDiagnostics:
    filename: str = ""
    original_dimensions: tuple[int, int] = (0, 0)
    preprocessed_dimensions: tuple[int, int] = (0, 0)
    skew_angle: float = 0.0
    docai_mean_confidence: float = 0.0
    cv_info: CVRegionInfo = field(default_factory=CVRegionInfo)
    gemini_tokens: TokenUsage = field(default_factory=TokenUsage)
    dedup_info: DeduplicationInfo = field(default_factory=DeduplicationInfo)
    image_matching: ImageMatchingInfo = field(default_factory=ImageMatchingInfo)
    visual_matching: VisualMatchingInfo = field(default_factory=VisualMatchingInfo)
    images_saved: int = 0
    page_number: str = ""
    final_article_count: int = 0
    final_ad_count: int = 0
    final_other_content_count: int = 0
    timings: dict[str, float] = field(default_factory=dict)
    total_time_seconds: float = 0.0
    error: str = ""


@dataclass
class MergePassDiagnostics:
    articles_before_merge: int = 0
    articles_after_merge: int = 0
    singleton_groups: int = 0
    multi_article_groups: int = 0
    duplicate_warnings: list[str] = field(default_factory=list)
    image_orphans_dropped: int = 0
    empty_articles_removed: int = 0
    tokens: TokenUsage = field(default_factory=TokenUsage)
    time_seconds: float = 0.0
    error: str = ""
    merge_skipped: bool = False


@dataclass
class PipelineReport:
    edition_date: str = ""
    pages_attempted: int = 0
    pages_processed: int = 0
    page_diagnostics: list[PageDiagnostics] = field(default_factory=list)
    merge_pass: MergePassDiagnostics | None = None
    total_prompt_tokens: int = 0
    total_candidates_tokens: int = 0
    total_time_seconds: float = 0.0

    def finalize(self) -> None:
        prompt = 0
        cand = 0
        for pd in self.page_diagnostics:
            prompt += pd.gemini_tokens.prompt_tokens or 0
            cand += pd.gemini_tokens.candidates_tokens or 0
            if pd.visual_matching.attempted:
                prompt += pd.visual_matching.tokens.prompt_tokens or 0
                cand += pd.visual_matching.tokens.candidates_tokens or 0
        if self.merge_pass:
            prompt += self.merge_pass.tokens.prompt_tokens or 0
            cand += self.merge_pass.tokens.candidates_tokens or 0
        self.total_prompt_tokens = prompt
        self.total_candidates_tokens = cand

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2, default=str)

    def print_summary(self) -> None:
        from ..shared.console import print_summary_table
        print_summary_table(self)


__all__ = [
    "CVRegionInfo",
    "DeduplicationInfo",
    "ImageMatchingInfo",
    "MergePassDiagnostics",
    "PageDiagnostics",
    "PipelineReport",
    "StageTimer",
    "TokenUsage",
    "VisualMatchingInfo",
]
