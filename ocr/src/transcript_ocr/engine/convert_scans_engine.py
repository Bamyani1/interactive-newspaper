"""Compatibility engine shim.

This module preserves legacy import paths while delegating implementation to the
modular `transcript_ocr` package layers.
"""

from __future__ import annotations

from ..application.convert_scans_runtime import _process_edition, main, process_edition
from ..application.page_pipeline import (
    _extract_page_number_from_filename,
    extract_page_docai,
    structure_and_link_page,
)
from ..config.constants import (
    GEMINI_MODEL,
    GEMINI_MERGE_MODEL,
    GEMINI_PAGE_MODEL,
    IMAGE_EXTENSIONS,
)
from ..contracts.content_models import (
    Ad,
    Article,
    ArticleImage,
    EditionContent,
    ImageRegionAssignment,
    ImageRegionAssignments,
    MergeDecisions,
    MergeInstruction,
    MergedArticle,
    OtherContent,
    PageContent,
)
from ..contracts.diagnostics_models import (
    CVRegionInfo,
    DeduplicationInfo,
    ImageMatchingInfo,
    MergePassDiagnostics,
    PageDiagnostics,
    PipelineReport,
    PostprocessingInfo,
    StageTimer,
    TokenUsage,
    VisualMatchingInfo,
)
from ..detection.yolo_provider import _get_yolo_model, detect_image_regions
from ..diagnostics.issue_report import _build_issue_report, _load_json, _write_issue_report_files
from ..diagnostics.run_manifest import _get_git_commit_hash, _sha256_file, _write_run_manifest
from ..diagnostics.snapshots import _save_snapshot
from ..export.markdown_writer import edition_to_markdown, page_content_to_markdown
from ..image_linking.assignment_applier import _apply_visual_assignments
from ..image_linking.cropper import crop_and_save_images, draw_region_annotations
from ..image_linking.spatial_matcher import _position_to_zone, _region_center_zone, match_images_to_articles
from ..image_linking.visual_matcher import match_images_visual
from ..ingestion.discovery import extract_edition_date
from ..merging.continuation import _extract_continuation_info, _headline_similar, _strip_continuation_markers
from ..merging.deterministic_merge import _deterministic_merge
from ..merging.llm_merge import _best_body, _validate_merge_seam, merge_edition_articles
from ..merging.merge_sanitizer import (
    _choose_merged_category,
    _reconcile_image_alignment,
    _sanitize_merged_articles,
    _strip_trailing_captions,
)
from ..postprocessing.ad_reclassification import _AD_SIGNALS, postprocess_page_content
from ..postprocessing.byline_cleanup import _extract_byline_from_body, _normalize_byline, _split_author_position
from ..postprocessing.deduplication import (
    _dedup_article_body,
    _deduplicate_ads,
    _deduplicate_other_content,
    _normalize,
    _sentence_overlap,
    _split_sentences,
    deduplicate_articles,
)
from ..postprocessing.proper_noun_corrections import (
    _apply_proper_noun_corrections,
    _check_proper_noun_consistency,
    _levenshtein,
)
from ..preprocessing.image_preprocessor import preprocess_image
from ..preprocessing.skew import _detect_skew_angle
from ..recognition.prompts import IMAGE_MATCHING_PROMPT, MERGE_PROMPT, SAFETY_OFF

__all__ = [
    "_AD_SIGNALS",
    "_apply_proper_noun_corrections",
    "_apply_visual_assignments",
    "_best_body",
    "_build_issue_report",
    "_check_proper_noun_consistency",
    "_choose_merged_category",
    "_dedup_article_body",
    "_deduplicate_ads",
    "_deduplicate_other_content",
    "_detect_skew_angle",
    "_deterministic_merge",
    "_extract_byline_from_body",
    "_extract_continuation_info",
    "_extract_page_number_from_filename",
    "_get_git_commit_hash",
    "_get_yolo_model",
    "_headline_similar",
    "_levenshtein",
    "_load_json",
    "_normalize",
    "_normalize_byline",
    "_position_to_zone",
    "_process_edition",
    "_reconcile_image_alignment",
    "_region_center_zone",
    "_sanitize_merged_articles",
    "_save_snapshot",
    "_sentence_overlap",
    "_sha256_file",
    "_split_author_position",
    "_split_sentences",
    "_strip_continuation_markers",
    "_strip_trailing_captions",
    "_validate_merge_seam",
    "_write_issue_report_files",
    "_write_run_manifest",
    "Ad",
    "Article",
    "ArticleImage",
    "CVRegionInfo",
    "DeduplicationInfo",
    "EditionContent",
    "GEMINI_MERGE_MODEL",
    "GEMINI_MODEL",
    "GEMINI_PAGE_MODEL",
    "IMAGE_EXTENSIONS",
    "IMAGE_MATCHING_PROMPT",
    "ImageMatchingInfo",
    "ImageRegionAssignment",
    "ImageRegionAssignments",
    "MERGE_PROMPT",
    "MergeDecisions",
    "MergeInstruction",
    "MergePassDiagnostics",
    "MergedArticle",
    "OtherContent",
    "PageContent",
    "PageDiagnostics",
    "PipelineReport",
    "PostprocessingInfo",
    "SAFETY_OFF",
    "StageTimer",
    "TokenUsage",
    "VisualMatchingInfo",
    "crop_and_save_images",
    "deduplicate_articles",
    "detect_image_regions",
    "draw_region_annotations",
    "edition_to_markdown",
    "extract_edition_date",
    "main",
    "match_images_to_articles",
    "match_images_visual",
    "merge_edition_articles",
    "page_content_to_markdown",
    "postprocess_page_content",
    "preprocess_image",
    "process_edition",
    "extract_page_docai",
    "structure_and_link_page",
]
