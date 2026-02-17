import os
import re
import sys
import glob
import json
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps
from scipy import ndimage
from doclayout_yolo import YOLOv10
from dotenv import load_dotenv
from pydantic import BaseModel
from google import genai
from google.genai import types
from gemini_utils import gemini_generate_with_retry

# Load environment variables
load_dotenv()

GEMINI_MODEL = "gemini-3-flash-preview"

# DocLayout-YOLO model for image region detection (loaded lazily on first use)
_YOLO_MODEL_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "models", "doclayout_yolo_docstructbench_imgsz1024.pt",
)
_YOLO_CONF_THRESHOLD = 0.3  # Lower threshold to detect more regions
_YOLO_FIGURE_CLASSES = {"figure"}
_yolo_model: YOLOv10 | None = None

# Image region size filtering thresholds
_MIN_REGION_AREA_PIXELS = 15000      # ~122x122px minimum (reject tiny artifacts)
_MAX_REGION_AREA_PERCENT = 0.80      # Reject regions > 80% of page (allow multi-photo composites)
_MIN_ASPECT_RATIO = 0.25             # Reject very tall/thin regions (likely text columns)
_MAX_ASPECT_RATIO = 4.0              # Reject very wide/short regions
_YOLO_NMS_IOU_THRESHOLD = 0.3        # Lower NMS to keep more overlapping detections


def _get_yolo_model() -> YOLOv10:
    """Load the DocLayout-YOLO model (cached after first call)."""
    global _yolo_model
    if _yolo_model is None:
        if not os.path.exists(_YOLO_MODEL_PATH):
            # Download from HuggingFace on first run
            from huggingface_hub import hf_hub_download
            print("Downloading DocLayout-YOLO model...")
            hf_hub_download(
                repo_id="juliozhao/DocLayout-YOLO-DocStructBench",
                filename="doclayout_yolo_docstructbench_imgsz1024.pt",
                local_dir=os.path.dirname(_YOLO_MODEL_PATH),
            )
        print("Loading DocLayout-YOLO model...")
        _yolo_model = YOLOv10(_YOLO_MODEL_PATH)
    return _yolo_model

IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".tif", ".tiff")

SYSTEM_PROMPT = """\
You are an expert OCR system for historical newspaper pages.

Extract ALL content from the page. Be thorough — do not skip or abbreviate any text.

CRITICAL RULES:
- NEVER generate descriptions of what text says. Only transcribe the actual words on the page. \
If text is illegible, use [illegible].
- If the same name appears multiple times, ensure consistent spelling throughout. \
Check each proper noun carefully against every other occurrence on the page.
- Do not skip text at column boundaries. If a sentence appears cut off at the end of one column, \
look in the adjacent column for its continuation and join the text.
- Full-page or large-format subscription/promotional content with pricing is an AD, not an article.

For each article:
- Capture the headline (empty string if none visible).
- Capture the byline/author if present. Always include the "By" prefix in the author field \
if it appears in the original (e.g., "By John Smith").
- Rejoin hyphenated words split across line breaks.
- Separate paragraphs with blank lines.
- For each photo or illustration, capture its caption and approximate position on the page \
(e.g. "top-left", "upper-center", "bottom-right", "center-left") in the images field.

Capture advertisements in ads (business_name + full ad text).
Capture masthead/publication header in publication_info.
Set page_number to the numeric page number (e.g., "3" not "Page 3"). Front pages are page 1.
Put any remaining content (schedules, tables, notices, calendars) in other_content.

Read columns top-to-bottom, then left-to-right. Follow articles that continue across columns.\
"""

SAFETY_OFF = [
    types.SafetySetting(
        category="HARM_CATEGORY_HARASSMENT",
        threshold="OFF",
    ),
    types.SafetySetting(
        category="HARM_CATEGORY_HATE_SPEECH",
        threshold="OFF",
    ),
    types.SafetySetting(
        category="HARM_CATEGORY_SEXUALLY_EXPLICIT",
        threshold="OFF",
    ),
    types.SafetySetting(
        category="HARM_CATEGORY_DANGEROUS_CONTENT",
        threshold="OFF",
    ),
    types.SafetySetting(
        category="HARM_CATEGORY_CIVIC_INTEGRITY",
        threshold="OFF",
    ),
]


# ── Pydantic models for structured output ──────────────────────────


class ArticleImage(BaseModel):
    caption: str
    position: str = ""  # approximate page position: "top-left", "center", "bottom-right", etc.


class Article(BaseModel):
    headline: str
    author: str = ""
    body: str
    images: list[ArticleImage] = []
    image_files: list[str] = []


class OtherContent(BaseModel):
    title: str = ""
    body: str


class Ad(BaseModel):
    business_name: str
    body: str
    image_files: list[str] = []


class PageContent(BaseModel):
    articles: list[Article]
    other_content: list[OtherContent] = []
    ads: list[Ad] = []
    page_number: str = ""
    publication_info: str = ""


class MergedArticle(BaseModel):
    headline: str
    author: str = ""
    body: str
    images: list[ArticleImage] = []
    image_files: list[str] = []
    source_pages: list[str] = []


class EditionContent(BaseModel):
    articles: list[MergedArticle]
    ads: list[Ad] = []
    other_content: list[OtherContent] = []


class MergeInstruction(BaseModel):
    """One merge group: articles that should be combined."""
    article_ids: list[int]       # 0-based indices into the flat article list
    merged_headline: str         # best headline for the group
    merged_author: str = ""      # best author attribution


class MergeDecisions(BaseModel):
    """Gemini returns only grouping decisions, not article text."""
    groups: list[MergeInstruction]


class ImageRegionAssignment(BaseModel):
    """Assignment of one CV-detected image region to an article, ad, standalone, or not_image."""
    region_number: int       # 1-based (matches label drawn on annotated image)
    content_type: str        # "article", "ad", "standalone", or "not_image"
    content_index: int = -1  # 0-based index into articles/ads (-1 for standalone/not_image)
    caption: str = ""        # what the image shows


class ImageRegionAssignments(BaseModel):
    """Gemini returns assignments for all numbered image regions on a page."""
    assignments: list[ImageRegionAssignment]


# ── Diagnostic dataclasses ───────────────────────────────────────────


@dataclass
class StageTimer:
    """Reusable timer for pipeline stages."""
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
    """Token counts from a single Gemini API call."""
    prompt_tokens: int = 0
    candidates_tokens: int = 0
    total_tokens: int = 0


@dataclass
class CVRegionInfo:
    """Metrics from detect_image_regions."""
    total_components_found: int = 0
    filtered_by_class: int = 0
    filtered_by_area: int = 0
    filtered_by_aspect_ratio: int = 0
    regions_kept: int = 0
    bounding_boxes: list[tuple[int, int, int, int]] = field(default_factory=list)


@dataclass
class DeduplicationInfo:
    """Metrics from deduplicate_articles."""
    articles_before: int = 0
    articles_after: int = 0
    overlapping_pairs_merged: int = 0


@dataclass
class PostprocessingInfo:
    """Metrics from postprocess_page_content."""
    ad_reclassifications: list[dict] = field(default_factory=list)
    proper_noun_warnings: list[dict] = field(default_factory=list)
    proper_noun_corrections: list[dict] = field(default_factory=list)


@dataclass
class ImageMatchingInfo:
    """Metrics from match_images_to_articles."""
    total_regions: int = 0
    matched_count: int = 0
    unmatched_count: int = 0
    match_details: list[dict] = field(default_factory=list)


@dataclass
class VisualMatchingInfo:
    """Metrics from the visual image-to-article matching pass."""
    attempted: bool = False
    succeeded: bool = False
    tokens: TokenUsage = field(default_factory=TokenUsage)
    assignments_returned: int = 0
    valid_article_matches: int = 0
    valid_ad_matches: int = 0
    standalone_count: int = 0
    rejected_not_image: int = 0
    invalid_assignments: int = 0
    fallback_to_spatial: bool = False


@dataclass
class PageDiagnostics:
    """Per-page diagnostic container."""
    filename: str = ""
    original_dimensions: tuple[int, int] = (0, 0)
    preprocessed_dimensions: tuple[int, int] = (0, 0)
    skew_angle: float = 0.0
    cv_info: CVRegionInfo = field(default_factory=CVRegionInfo)
    gemini_tokens: TokenUsage = field(default_factory=TokenUsage)
    chunked_fallback_used: bool = False
    chunk_tokens: list[TokenUsage] = field(default_factory=list)
    chunk_failures: list[str] = field(default_factory=list)
    dedup_info: DeduplicationInfo = field(default_factory=DeduplicationInfo)
    postprocessing: PostprocessingInfo = field(default_factory=PostprocessingInfo)
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
    """Metrics from the cross-page merge pass."""
    articles_before_merge: int = 0
    articles_after_merge: int = 0
    singleton_groups: int = 0
    multi_article_groups: int = 0
    duplicate_warnings: list[str] = field(default_factory=list)
    unreferenced_articles: int = 0
    tokens: TokenUsage = field(default_factory=TokenUsage)
    time_seconds: float = 0.0
    error: str = ""


@dataclass
class PipelineReport:
    """Top-level report collecting all diagnostics for a run."""
    edition_date: str = ""
    start_time: str = ""
    end_time: str = ""
    pages_attempted: int = 0
    pages_processed: int = 0
    page_diagnostics: list[PageDiagnostics] = field(default_factory=list)
    merge_pass: MergePassDiagnostics | None = None
    total_prompt_tokens: int = 0
    total_candidates_tokens: int = 0
    total_time_seconds: float = 0.0

    def finalize(self) -> None:
        """Aggregate totals from page diagnostics and merge pass."""
        self.end_time = datetime.now(timezone.utc).isoformat()
        prompt = 0
        cand = 0
        for pd in self.page_diagnostics:
            prompt += pd.gemini_tokens.prompt_tokens
            cand += pd.gemini_tokens.candidates_tokens
            for ct in pd.chunk_tokens:
                prompt += ct.prompt_tokens
                cand += ct.candidates_tokens
            if pd.visual_matching.attempted:
                prompt += pd.visual_matching.tokens.prompt_tokens
                cand += pd.visual_matching.tokens.candidates_tokens
        if self.merge_pass:
            prompt += self.merge_pass.tokens.prompt_tokens
            cand += self.merge_pass.tokens.candidates_tokens
        self.total_prompt_tokens = prompt
        self.total_candidates_tokens = cand

    def to_json(self) -> str:
        """Serialize the full report to JSON."""
        return json.dumps(asdict(self), indent=2, default=str)

    def print_summary(self) -> None:
        """Print a human-readable diagnostics summary to stdout."""
        print(f"\n{'='*60}")
        print("PIPELINE DIAGNOSTICS REPORT")
        print(f"{'='*60}")
        print(f"Edition:          {self.edition_date}")
        print(f"Total time:       {self.total_time_seconds:.1f}s")
        print(f"Pages:            {self.pages_processed}/{self.pages_attempted} processed")
        print(f"Total tokens:     {self.total_prompt_tokens} in, {self.total_candidates_tokens} out")

        if self.page_diagnostics:
            print(f"\n--- Per-Page Summary ---")
            for pd in self.page_diagnostics:
                status = "OK" if not pd.error else f"FAILED: {pd.error}"
                page_label = f"page {pd.page_number}" if pd.page_number else "page ?"
                print(f"  {pd.filename} ({page_label}): {status}")
                if not pd.error:
                    skew_str = f"{pd.skew_angle:.1f}°" if pd.skew_angle else "0.0°"
                    cv_kept = pd.cv_info.regions_kept
                    cv_total = pd.cv_info.total_components_found
                    total_tok = pd.gemini_tokens.total_tokens
                    for ct in pd.chunk_tokens:
                        total_tok += ct.total_tokens
                    art_before = pd.dedup_info.articles_before
                    art_after = pd.dedup_info.articles_after
                    final_art = pd.final_article_count
                    ads = pd.final_ad_count
                    print(f"    Skew: {skew_str}  |  CV: {cv_kept}/{cv_total} regions kept")
                    print(f"    Tokens: {total_tok}  |  Articles: {art_before}→{art_after}→{final_art}  |  Ads: {ads}")
                    timing_parts = []
                    for stage, secs in pd.timings.items():
                        timing_parts.append(f"{stage}={secs:.1f}s")
                    if timing_parts:
                        print(f"    Timings: {', '.join(timing_parts)}")
                    if pd.chunked_fallback_used:
                        print(f"    (used chunked fallback)")
                    vm = pd.visual_matching
                    if vm.attempted:
                        if vm.succeeded:
                            print(f"    Visual matching: {vm.valid_article_matches} articles, {vm.valid_ad_matches} ads, {vm.standalone_count} standalone"
                                  + (f" ({vm.invalid_assignments} invalid)" if vm.invalid_assignments else ""))
                        else:
                            fallback = " (fell back to spatial)" if vm.fallback_to_spatial else ""
                            print(f"    Visual matching: failed{fallback}")

        if self.merge_pass:
            mp = self.merge_pass
            print(f"\n--- Merge Pass ---")
            if mp.error:
                print(f"  FAILED: {mp.error}")
            else:
                print(f"  {mp.articles_before_merge}→{mp.articles_after_merge} articles  |  {mp.multi_article_groups} multi-article groups")
                print(f"  Tokens: {mp.tokens.prompt_tokens} in, {mp.tokens.candidates_tokens} out  |  Time: {mp.time_seconds:.1f}s")
        print(f"{'='*60}")


def extract_edition_date(folder_path: str) -> str:
    """Extract YYYY-MM-DD date from folder name like ' 1988-08-31'."""
    basename = os.path.basename(folder_path.rstrip(os.sep))
    match = re.search(r'(\d{4}-\d{2}-\d{2})', basename)
    return match.group(1) if match else basename.strip()


# ── Deduplication helpers ──────────────────────────────────────────


def _split_sentences(text: str) -> list[str]:
    """Split text into sentences using basic punctuation rules."""
    parts = re.split(r'(?<=[.!?])\s+', text.strip())
    return [s.strip() for s in parts if s.strip()]


def _normalize(text: str) -> str:
    """Collapse whitespace for comparison."""
    return re.sub(r'\s+', ' ', text.strip())


def _sentence_overlap(sents_a: list[str], sents_b: list[str]) -> float:
    """Return the fraction of shared sentences (Jaccard-style, relative to smaller set)."""
    if not sents_a or not sents_b:
        return 0.0
    set_a = set(_normalize(s) for s in sents_a)
    set_b = set(_normalize(s) for s in sents_b)
    overlap = len(set_a & set_b)
    return overlap / min(len(set_a), len(set_b))


def _dedup_article_body(body: str) -> str:
    """Remove consecutive duplicate sentences and duplicate paragraphs within one article."""
    paragraphs = [p.strip() for p in body.split('\n\n') if p.strip()]

    # Deduplicate consecutive duplicate sentences within each paragraph
    cleaned_paragraphs = []
    for para in paragraphs:
        sentences = _split_sentences(para)
        deduped = []
        for sent in sentences:
            if not deduped or _normalize(sent) != _normalize(deduped[-1]):
                deduped.append(sent)
        cleaned_paragraphs.append(' '.join(deduped))

    # Remove duplicate paragraphs (keep first occurrence)
    seen = set()
    unique_paragraphs = []
    for para in cleaned_paragraphs:
        key = _normalize(para)
        if key not in seen:
            seen.add(key)
            unique_paragraphs.append(para)

    return '\n\n'.join(unique_paragraphs)


def deduplicate_articles(
    page_content: PageContent, diag: PageDiagnostics | None = None,
) -> PageContent:
    """Post-process a page to remove duplicate sentences, paragraphs, and overlapping articles."""
    timer = StageTimer().start()
    articles_before = len(page_content.articles)

    # Step 1: Clean each article body individually
    articles = []
    for article in page_content.articles:
        cleaned_body = _dedup_article_body(article.body)
        articles.append(Article(
            headline=article.headline,
            author=article.author,
            body=cleaned_body,
            images=article.images,
            image_files=article.image_files,
        ))

    # Step 2: Merge articles with high sentence overlap (>60%)
    merged = []
    used = set()
    for i, art_a in enumerate(articles):
        if i in used:
            continue
        best = art_a
        sents_best = _split_sentences(best.body)
        for j in range(i + 1, len(articles)):
            if j in used:
                continue
            sents_j = _split_sentences(articles[j].body)
            if _sentence_overlap(sents_best, sents_j) > 0.6:
                used.add(j)
                # Keep the version with a headline, or the longer one
                if not best.headline and articles[j].headline:
                    best = articles[j]
                    sents_best = sents_j
                elif len(articles[j].body) > len(best.body):
                    # Keep headline from best if it has one
                    best = Article(
                        headline=best.headline or articles[j].headline,
                        author=best.author or articles[j].author,
                        body=articles[j].body,
                        images=best.images + articles[j].images,
                        image_files=best.image_files + articles[j].image_files,
                    )
                    sents_best = _split_sentences(best.body)
        merged.append(best)

    if diag is not None:
        diag.dedup_info = DeduplicationInfo(
            articles_before=articles_before,
            articles_after=len(merged),
            overlapping_pairs_merged=len(used),
        )
        diag.timings["dedup"] = timer.stop()

    return PageContent(
        articles=merged,
        other_content=page_content.other_content,
        ads=page_content.ads,
        page_number=page_content.page_number,
        publication_info=page_content.publication_info,
    )


def _deduplicate_ads(ads: list[Ad]) -> list[Ad]:
    """Remove duplicate ads by comparing business_name + body overlap."""
    if not ads:
        return ads
    merged = []
    used = set()
    for i, ad_a in enumerate(ads):
        if i in used:
            continue
        best = ad_a
        name_a = _normalize(ad_a.business_name).lower()
        sents_best = _split_sentences(best.body)
        for j in range(i + 1, len(ads)):
            if j in used:
                continue
            name_b = _normalize(ads[j].business_name).lower()
            if name_a != name_b:
                continue
            sents_j = _split_sentences(ads[j].body)
            if _sentence_overlap(sents_best, sents_j) > 0.6:
                used.add(j)
                # Keep longer body, merge image_files
                combined_images = list(best.image_files) + list(ads[j].image_files)
                if len(ads[j].body) > len(best.body):
                    best = Ad(
                        business_name=best.business_name,
                        body=ads[j].body,
                        image_files=combined_images,
                    )
                else:
                    best = Ad(
                        business_name=best.business_name,
                        body=best.body,
                        image_files=combined_images,
                    )
                sents_best = _split_sentences(best.body)
        merged.append(best)
    return merged


def _deduplicate_other_content(others: list[OtherContent]) -> list[OtherContent]:
    """Remove duplicate other_content by comparing title + body overlap."""
    if not others:
        return others
    merged = []
    used = set()
    for i, oc_a in enumerate(others):
        if i in used:
            continue
        best = oc_a
        title_a = _normalize(oc_a.title).lower()
        sents_best = _split_sentences(best.body)
        for j in range(i + 1, len(others)):
            if j in used:
                continue
            title_b = _normalize(others[j].title).lower()
            if title_a != title_b:
                continue
            sents_j = _split_sentences(others[j].body)
            if _sentence_overlap(sents_best, sents_j) > 0.6:
                used.add(j)
                if len(others[j].body) > len(best.body):
                    best = OtherContent(title=best.title, body=others[j].body)
                sents_best = _split_sentences(best.body)
        merged.append(best)
    return merged


# ── Post-processing ─────────────────────────────────────────────────


_AD_SIGNALS = [
    r'\$\d',                           # price
    r'(?i)\bsubscri(?:be|ption)\b',
    r'(?i)\bcall\s+\d{3}[\s-]\d{4}\b', # phone number CTA
    r'(?i)\bcoupon\b',
    r'(?i)\bfree\s+(?:trial|delivery|shipping)\b',
    r'(?i)\border\s+(?:now|today)\b',
    r'(?i)\bsave\s+\$?\d',
    r'(?i)\bspecial\s+offer\b',
]


def _normalize_byline(author: str) -> str:
    """Ensure author field consistently uses 'By ' prefix."""
    if not author:
        return author
    stripped = author.strip()
    # Remove existing "By" prefix (case-insensitive) then re-add consistently
    without_by = re.sub(r'^By\s+', '', stripped, flags=re.IGNORECASE)
    if not without_by:
        return ""
    return f"By {without_by}"


def _levenshtein(s1: str, s2: str) -> int:
    """Compute Levenshtein edit distance between two strings."""
    if len(s1) < len(s2):
        return _levenshtein(s2, s1)
    if len(s2) == 0:
        return len(s1)
    prev = list(range(len(s2) + 1))
    for i, c1 in enumerate(s1):
        curr = [i + 1]
        for j, c2 in enumerate(s2):
            curr.append(min(prev[j + 1] + 1, curr[j] + 1,
                            prev[j] + (0 if c1 == c2 else 1)))
        prev = curr
    return prev[-1]


def _check_proper_noun_consistency(
    articles: list[Article], diag: PageDiagnostics | None = None,
) -> dict[str, str]:
    """Detect likely OCR misspellings of proper nouns and build a correction map.

    Returns a dict mapping variant → canonical form, only when the canonical
    form appears at least 2x more often (safety guard against merging
    genuinely different names).
    """
    # Count occurrences of each capitalized multi-word name across all articles
    name_counts: dict[str, int] = {}
    for art in articles:
        for match in re.finditer(r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b', art.body):
            name = match.group(0)
            name_counts[name] = name_counts.get(name, 0) + 1

    # Compare all pairs for near-matches
    corrections: dict[str, str] = {}
    name_list = sorted(name_counts.keys())
    for i in range(len(name_list)):
        for j in range(i + 1, len(name_list)):
            dist = _levenshtein(name_list[i], name_list[j])
            if 1 <= dist <= 2:
                print(f"    -> Proper noun warning: '{name_list[i]}' vs '{name_list[j]}' (edit distance {dist})")
                if diag is not None:
                    diag.postprocessing.proper_noun_warnings.append({
                        "name_a": name_list[i],
                        "name_b": name_list[j],
                        "distance": dist,
                    })
                # Auto-correct: pick the more frequent variant as canonical
                count_i = name_counts[name_list[i]]
                count_j = name_counts[name_list[j]]
                if count_i >= 2 * count_j:
                    corrections[name_list[j]] = name_list[i]
                elif count_j >= 2 * count_i:
                    corrections[name_list[i]] = name_list[j]

    return corrections


def _apply_proper_noun_corrections(
    articles: list[Article],
    corrections: dict[str, str],
    diag: PageDiagnostics | None = None,
) -> list[Article]:
    """Replace OCR-misspelled proper nouns in article bodies using the correction map."""
    corrected_articles = []
    for art in articles:
        body = art.body
        for variant, canonical in corrections.items():
            pattern = re.compile(r'\b' + re.escape(variant) + r'\b')
            new_body = pattern.sub(canonical, body)
            if new_body != body:
                count = body.count(variant)
                print(f"    -> Corrected '{variant}' → '{canonical}' ({count}x)")
                if diag is not None:
                    diag.postprocessing.proper_noun_corrections.append({
                        "original": variant,
                        "corrected": canonical,
                        "count": count,
                    })
                body = new_body
        corrected_articles.append(Article(
            headline=art.headline,
            author=art.author,
            body=body,
            images=art.images,
            image_files=art.image_files,
        ))
    return corrected_articles


def postprocess_page_content(
    page_content: PageContent, diag: PageDiagnostics | None = None,
) -> PageContent:
    """Apply local post-processing fixes: byline normalization, ad reclassification, noun checks."""
    timer = StageTimer().start()

    # 1. Normalize bylines
    articles = []
    for art in page_content.articles:
        articles.append(Article(
            headline=art.headline,
            author=_normalize_byline(art.author),
            body=art.body,
            images=art.images,
            image_files=art.image_files,
        ))

    # 2. Reclassify articles that look like ads
    final_articles = []
    new_ads = list(page_content.ads)
    for art in articles:
        signal_count = sum(1 for pat in _AD_SIGNALS if re.search(pat, art.body))
        if signal_count >= 2 and not art.author:
            print(f"    -> Reclassified as ad: '{art.headline[:50]}' ({signal_count} ad signals)")
            new_ads.append(Ad(
                business_name=art.headline or "Untitled Ad",
                body=art.body,
                image_files=art.image_files,
            ))
            if diag is not None:
                diag.postprocessing.ad_reclassifications.append({
                    "headline": art.headline[:80],
                    "signal_count": signal_count,
                })
        else:
            final_articles.append(art)

    # 3. Proper noun consistency check and auto-correction
    corrections = _check_proper_noun_consistency(final_articles, diag=diag)
    if corrections:
        final_articles = _apply_proper_noun_corrections(final_articles, corrections, diag=diag)

    if diag is not None:
        diag.timings["postprocess"] = timer.stop()

    return PageContent(
        articles=final_articles,
        other_content=page_content.other_content,
        ads=new_ads,
        page_number=page_content.page_number,
        publication_info=page_content.publication_info,
    )


# ── Image preprocessing ──────────────────────────────────────────────


def _detect_skew_angle(image: Image.Image) -> float:
    """Detect rotation angle using horizontal projection profiles.

    Converts to binary, then for angles -5° to +5° in 0.1° steps,
    rotates and sums horizontal projections. The angle with the
    highest variance in row sums is the skew angle.
    Returns 0.0 if detected angle < 0.1°.
    """
    # Convert to numpy array and binarize
    arr = np.array(image.convert("L"))
    binary = (arr < 128).astype(np.float64)

    # Downsample for speed on large images
    scale = 1
    if binary.shape[0] > 1500:
        scale = binary.shape[0] // 1500
        binary = binary[::scale, ::scale]

    best_angle = 0.0
    best_variance = 0.0

    for angle_10x in range(-50, 51):  # -5.0° to +5.0° in 0.1° steps
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


def preprocess_image(
    image: Image.Image, diag: PageDiagnostics | None = None,
) -> Image.Image:
    """Preprocess a scanned newspaper page image for better OCR accuracy.

    Pipeline: EXIF auto-rotation → crop border → grayscale → deskew → contrast → sharpen.
    """
    timer = StageTimer().start()

    if diag is not None:
        diag.original_dimensions = image.size

    # 1. Fix EXIF orientation metadata FIRST (before any geometry operations)
    image = ImageOps.exif_transpose(image)

    # 2. Crop 10% border — remove scanner border by trimming 5% from each edge
    w, h = image.size
    margin_x = int(w * 0.05)
    margin_y = int(h * 0.05)
    image = image.crop((margin_x, margin_y, w - margin_x, h - margin_y))

    # 3. Convert to grayscale — removes color noise from yellowed paper
    image = ImageOps.grayscale(image)

    # 4. Deskew — correct slight rotation from scanning
    skew_angle = _detect_skew_angle(image)
    if skew_angle != 0.0:
        print(f"    -> Deskewing by {skew_angle:.1f}°")
        image = image.rotate(skew_angle, resample=Image.BICUBIC,
                             expand=True, fillcolor=255)

    # 5. Enhance contrast — sharpen text vs faded background
    image = ImageEnhance.Contrast(image).enhance(1.5)

    # 6. Gentle sharpening — recover soft-focus detail without amplifying noise
    image = image.filter(ImageFilter.UnsharpMask(
        radius=1.0, percent=80, threshold=3))

    if diag is not None:
        diag.skew_angle = skew_angle
        diag.preprocessed_dimensions = image.size
        diag.timings["preprocess"] = timer.stop()

    return image


# ── Image region detection (DocLayout-YOLO) ──────────────────────────


def detect_image_regions(
    image: Image.Image,
    diag: PageDiagnostics | None = None,
) -> list[tuple[int, int, int, int]]:
    """Detect photo/illustration regions using DocLayout-YOLO.

    Runs the DocLayout-YOLO model on the image and filters detections
    to only the 'figure' class above the confidence threshold.

    Args:
        image: PIL image (grayscale or RGB).
        diag: Optional diagnostics collector.

    Returns:
        List of (y_min, x_min, y_max, x_max) bounding boxes.
    """
    timer = StageTimer().start()

    model = _get_yolo_model()
    results = model.predict(
        image,
        imgsz=1024,
        conf=_YOLO_CONF_THRESHOLD,
        iou=_YOLO_NMS_IOU_THRESHOLD,  # Lower NMS = keep more overlapping boxes
        verbose=False
    )
    result = results[0]

    total_detections = len(result.boxes)
    candidates = []  # (y_min, x_min, y_max, x_max, confidence)

    if total_detections > 0:
        boxes = result.boxes.xyxy.cpu().numpy()
        confs = result.boxes.conf.cpu().numpy()
        classes = result.boxes.cls.cpu().numpy().astype(int)

        # Calculate page dimensions and max region area
        preprocessed_img = np.array(image)
        page_height, page_width = preprocessed_img.shape[:2]
        page_area = page_height * page_width
        max_region_area = page_area * _MAX_REGION_AREA_PERCENT

        filtered_by_class = 0
        filtered_by_area = 0
        filtered_by_aspect = 0

        for box, conf, cls in zip(boxes, confs, classes):
            class_name = result.names[cls]

            # Filter by class (keep only figures)
            if class_name not in _YOLO_FIGURE_CLASSES:
                filtered_by_class += 1
                continue

            # Extract coordinates
            x1, y1, x2, y2 = box
            region_width = int(x2 - x1)
            region_height = int(y2 - y1)
            region_area = region_width * region_height
            pct_of_page = (region_area / page_area) * 100

            print(f"    -> YOLO detected figure: {region_width}x{region_height} ({pct_of_page:.1f}% of page, conf={conf:.2f})")

            # Filter by area (reject tiny artifacts and page-covering regions)
            if region_area < _MIN_REGION_AREA_PIXELS or region_area > max_region_area:
                reason = "too small" if region_area < _MIN_REGION_AREA_PIXELS else f"too large (>{_MAX_REGION_AREA_PERCENT*100:.0f}%)"
                print(f"       ❌ FILTERED: {reason}")
                filtered_by_area += 1
                continue

            # Filter by aspect ratio (reject elongated regions)
            aspect_ratio = region_width / region_height if region_height > 0 else 0
            if aspect_ratio < _MIN_ASPECT_RATIO or aspect_ratio > _MAX_ASPECT_RATIO:
                print(f"       ❌ FILTERED: aspect ratio {aspect_ratio:.2f} out of range [{_MIN_ASPECT_RATIO}-{_MAX_ASPECT_RATIO}]")
                filtered_by_aspect += 1
                continue

            # Region passes all filters
            print(f"       ✅ KEPT")
            candidates.append((int(y1), int(x1), int(y2), int(x2), float(conf)))

    # Remove near-duplicate overlapping boxes (IoU > 0.5, keep higher confidence)
    regions = []
    for y1, x1, y2, x2, conf in sorted(candidates, key=lambda c: -c[4]):
        is_dup = False
        for ry1, rx1, ry2, rx2 in regions:
            # Compute IoU
            iy1, ix1 = max(y1, ry1), max(x1, rx1)
            iy2, ix2 = min(y2, ry2), min(x2, rx2)
            inter = max(0, iy2 - iy1) * max(0, ix2 - ix1)
            area_a = (y2 - y1) * (x2 - x1)
            area_b = (ry2 - ry1) * (rx2 - rx1)
            union = area_a + area_b - inter
            if union > 0 and inter / union > 0.5:
                is_dup = True
                break
        if not is_dup:
            regions.append((y1, x1, y2, x2))

    if diag is not None:
        diag.cv_info = CVRegionInfo(
            total_components_found=total_detections,
            filtered_by_class=filtered_by_class,
            filtered_by_area=filtered_by_area,
            filtered_by_aspect_ratio=filtered_by_aspect,
            regions_kept=len(regions),
            bounding_boxes=list(regions),
        )
        diag.timings["cv"] = timer.stop()

    return regions


# Map position strings from Gemini to normalized (row, col) in a 3x3 grid
_POSITION_MAP = {
    "top-left": (0, 0), "upper-left": (0, 0),
    "top-center": (0, 1), "upper-center": (0, 1), "top": (0, 1),
    "top-right": (0, 2), "upper-right": (0, 2),
    "center-left": (1, 0), "left": (1, 0), "middle-left": (1, 0),
    "center": (1, 1), "middle": (1, 1),
    "center-right": (1, 2), "right": (1, 2), "middle-right": (1, 2),
    "bottom-left": (2, 0), "lower-left": (2, 0),
    "bottom-center": (2, 1), "lower-center": (2, 1), "bottom": (2, 1),
    "bottom-right": (2, 2), "lower-right": (2, 2),
}


def _position_to_zone(position: str) -> tuple[float, float]:
    """Convert a position string to (row_frac, col_frac) in [0,1] range."""
    key = position.strip().lower()
    if key in _POSITION_MAP:
        r, c = _POSITION_MAP[key]
        return (r / 2.0, c / 2.0)  # normalize 0-2 to 0-1
    if key:
        print(f"    -> Warning: Unknown image position '{position}', defaulting to center")
    return (0.5, 0.5)  # default to center


def _region_center_zone(
    region: tuple[int, int, int, int], img_height: int, img_width: int
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
    """Match CV-detected image regions to articles using Gemini position hints.

    Returns:
        (region_to_article, unmatched_regions):
        - region_to_article: maps region index -> article index
        - unmatched_regions: region indices that couldn't be matched
    """
    timer = StageTimer().start()

    if not regions:
        if diag is not None:
            diag.timings["image_matching"] = timer.stop()
        return {}, []

    # Collect all article images with their zone positions
    article_zones = []  # (article_idx, image_idx, row_frac, col_frac)
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

        # Accept match if distance is reasonable (< 0.4 in normalized coords)
        if best_key is not None and best_dist < 0.4:
            region_to_article[ri] = best_ai
            used_article_images.add(best_key)
            if diag is not None:
                diag.image_matching.match_details.append({
                    "region_idx": ri, "article_idx": best_ai,
                    "distance": round(best_dist, 4),
                })
        else:
            unmatched.append(ri)

    if diag is not None:
        diag.image_matching.total_regions = len(regions)
        diag.image_matching.matched_count = len(region_to_article)
        diag.image_matching.unmatched_count = len(unmatched)
        diag.timings["image_matching"] = timer.stop()

    return region_to_article, unmatched


def crop_and_save_images(
    image: Image.Image,
    regions: list[tuple[int, int, int, int]],
    output_dir: str,
    page_stem: str,
    padding_frac: float = 0.02,
    quality: int = 95,
) -> dict[int, str]:
    """Crop detected image regions and save as JPEG files.

    Args:
        image: Preprocessed PIL image.
        regions: List of (y_min, x_min, y_max, x_max) bounding boxes.
        output_dir: Base output directory (e.g. output/1991-11-19).
        page_stem: Page filename stem (e.g. "0001_Page 1").
        padding_frac: Padding as fraction of box size.
        quality: JPEG quality.

    Returns:
        Dict mapping region index -> saved filename (relative to output_dir).
    """
    if not regions:
        return {}

    img_dir = os.path.join(output_dir, "images")
    os.makedirs(img_dir, exist_ok=True)

    w, h = image.size
    saved = {}

    for i, (y_min, x_min, y_max, x_max) in enumerate(regions):
        # Add padding
        pad_y = int((y_max - y_min) * padding_frac)
        pad_x = int((x_max - x_min) * padding_frac)
        crop_box = (
            max(0, x_min - pad_x),
            max(0, y_min - pad_y),
            min(w, x_max + pad_x),
            min(h, y_max + pad_y),
        )

        cropped = image.crop(crop_box)
        filename = f"{page_stem}_img{i+1}.jpg"
        filepath = os.path.join(img_dir, filename)
        cropped.save(filepath, "JPEG", quality=quality)

        saved[i] = os.path.join("images", filename)

    return saved


# ── Visual image-to-article matching ────────────────────────────────


def draw_region_annotations(
    image: Image.Image,
    regions: list[tuple[int, int, int, int]],
) -> Image.Image:
    """Draw numbered red rectangles on image at each CV bounding box.

    Args:
        image: Preprocessed grayscale PIL image.
        regions: List of (y_min, x_min, y_max, x_max) bounding boxes.

    Returns:
        RGB copy of the image with annotations drawn.
    """
    annotated = image.convert("RGB")
    draw = ImageDraw.Draw(annotated)

    # Scale line width and font size relative to image dimensions
    w, h = annotated.size
    line_width = max(3, min(w, h) // 300)
    font_size = max(20, min(w, h) // 40)

    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", font_size)
    except (OSError, IOError):
        try:
            font = ImageFont.truetype("DejaVuSans.ttf", font_size)
        except (OSError, IOError):
            font = ImageFont.load_default()

    for i, (y_min, x_min, y_max, x_max) in enumerate(regions):
        label = str(i + 1)

        # Draw red rectangle
        draw.rectangle(
            [(x_min, y_min), (x_max, y_max)],
            outline="red",
            width=line_width,
        )

        # Draw label with white background for readability
        bbox = font.getbbox(label)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
        padding = 4
        label_x = x_min + line_width
        label_y = y_min + line_width

        draw.rectangle(
            [(label_x, label_y),
             (label_x + text_w + 2 * padding, label_y + text_h + 2 * padding)],
            fill="white",
            outline="red",
            width=1,
        )
        draw.text(
            (label_x + padding, label_y + padding),
            label,
            fill="red",
            font=font,
        )

    return annotated


IMAGE_MATCHING_PROMPT = """\
You are analyzing a newspaper page image with numbered red rectangles drawn around detected photo/illustration regions.

Below is a list of articles and advertisements extracted from this page. For each numbered region in the image, determine which article or ad it belongs to, or mark it as standalone if it doesn't clearly belong to any content.

{content_list}

For each numbered region (1 through {num_regions}), return an assignment:
- region_number: the number shown on the image (1-based)
- content_type: "article", "ad", "standalone", or "not_image"
- content_index: the 0-based index from the list above (-1 for standalone or not_image)
- caption: a brief description of what the image shows

Assign every numbered region. If a region is not clearly associated with any listed content, mark it as "standalone".

If a region is NOT a meaningful photograph or editorial illustration, mark it as "not_image" with content_index -1. Reject: border artifacts, random shapes, decorative lines, partial drawings, logos, clip art, movie posters, promotional graphics, text-heavy ad banners, and any non-photographic element. Keep only: real photographs of people/places/events, editorial illustrations, maps, charts, or editorial cartoons.\
"""


def match_images_visual(
    client,
    annotated_image: Image.Image,
    page_content: PageContent,
    num_regions: int,
    diag: PageDiagnostics | None = None,
) -> ImageRegionAssignments | None:
    """Send annotated image + content list to Gemini for visual region matching.

    Returns ImageRegionAssignments on success, None on failure (caller should
    fall back to spatial matching).
    """
    timer = StageTimer().start()

    if diag is not None:
        diag.visual_matching.attempted = True

    # Build content list for prompt
    parts = []
    for i, article in enumerate(page_content.articles):
        headline = article.headline or "(no headline)"
        parts.append(f"  Article [{i}]: {headline}")
    for i, ad in enumerate(page_content.ads):
        parts.append(f"  Ad [{i}]: {ad.business_name}")

    content_list = "\n".join(parts) if parts else "  (no articles or ads extracted)"

    prompt = IMAGE_MATCHING_PROMPT.format(
        content_list=content_list,
        num_regions=num_regions,
    )

    try:
        response = gemini_generate_with_retry(
            client,
            model=GEMINI_MODEL,
            contents=[annotated_image, prompt],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=ImageRegionAssignments,
                safety_settings=SAFETY_OFF,
                media_resolution=types.MediaResolution.MEDIA_RESOLUTION_LOW,
                max_output_tokens=4096,
            ),
        )

        usage = response.usage_metadata
        print(f"    -> Visual matching tokens: {usage.prompt_token_count} in, {usage.candidates_token_count} out")

        if diag is not None:
            diag.visual_matching.tokens = TokenUsage(
                prompt_tokens=usage.prompt_token_count,
                candidates_tokens=usage.candidates_token_count,
                total_tokens=usage.total_token_count,
            )
            diag.timings["visual_matching"] = timer.stop()

        if response.parsed:
            if diag is not None:
                diag.visual_matching.succeeded = True
            return response.parsed

        print("    -> Visual matching response was empty or blocked")
        return None

    except Exception as e:
        print(f"    -> Visual matching failed: {e}")
        if diag is not None:
            diag.timings["visual_matching"] = timer.stop()
        return None


def _apply_visual_assignments(
    assignments: ImageRegionAssignments,
    page_content: PageContent,
    num_regions: int,
    diag: PageDiagnostics | None = None,
) -> tuple[dict[int, int], dict[int, int], list[int], dict[int, str]]:
    """Validate and apply visual region assignments.

    Args:
        assignments: Gemini's region assignments.
        page_content: Extracted page content (for index validation).
        num_regions: Total number of CV-detected regions.
        diag: Optional diagnostics collector.

    Returns:
        (region_to_article, region_to_ad, unmatched, captions):
        - region_to_article: maps region index (0-based) -> article index
        - region_to_ad: maps region index (0-based) -> ad index
        - unmatched: region indices that are standalone or invalid
        - captions: maps region index (0-based) -> caption string
    """
    region_to_article: dict[int, int] = {}
    region_to_ad: dict[int, int] = {}
    unmatched: list[int] = []
    captions: dict[int, str] = {}
    seen_regions: set[int] = set()
    invalid_count = 0

    num_articles = len(page_content.articles)
    num_ads = len(page_content.ads)

    if diag is not None:
        diag.visual_matching.assignments_returned = len(assignments.assignments)

    for assignment in assignments.assignments:
        rn = assignment.region_number
        ri = rn - 1  # convert to 0-based

        # Validate region number
        if ri < 0 or ri >= num_regions:
            print(f"    -> Warning: Invalid region_number {rn} (expected 1-{num_regions})")
            invalid_count += 1
            continue

        # Skip duplicates
        if ri in seen_regions:
            print(f"    -> Warning: Duplicate assignment for region {rn}")
            invalid_count += 1
            continue
        seen_regions.add(ri)

        if assignment.content_type == "not_image":
            print(f"    -> Region {rn} rejected as not a real image")
            if diag is not None:
                diag.visual_matching.rejected_not_image += 1
            continue

        if assignment.caption:
            captions[ri] = assignment.caption

        if assignment.content_type == "article":
            if 0 <= assignment.content_index < num_articles:
                region_to_article[ri] = assignment.content_index
            else:
                print(f"    -> Warning: Region {rn} article index {assignment.content_index} out of range (0-{num_articles - 1})")
                invalid_count += 1
                unmatched.append(ri)
        elif assignment.content_type == "ad":
            if 0 <= assignment.content_index < num_ads:
                region_to_ad[ri] = assignment.content_index
            else:
                print(f"    -> Warning: Region {rn} ad index {assignment.content_index} out of range (0-{num_ads - 1})")
                invalid_count += 1
                unmatched.append(ri)
        else:
            # "standalone" or any unrecognized type
            unmatched.append(ri)

    # Any regions not mentioned by Gemini become standalone
    for ri in range(num_regions):
        if ri not in seen_regions:
            unmatched.append(ri)

    if diag is not None:
        diag.visual_matching.valid_article_matches = len(region_to_article)
        diag.visual_matching.valid_ad_matches = len(region_to_ad)
        diag.visual_matching.standalone_count = len(unmatched)
        diag.visual_matching.invalid_assignments = invalid_count

        # Also populate legacy ImageMatchingInfo for backwards compatibility
        diag.image_matching.total_regions = num_regions
        diag.image_matching.matched_count = len(region_to_article)
        diag.image_matching.unmatched_count = len(unmatched) + len(region_to_ad)
        for ri, ai in region_to_article.items():
            diag.image_matching.match_details.append({
                "region_idx": ri, "article_idx": ai,
                "method": "visual",
            })

    return region_to_article, region_to_ad, unmatched, captions


# ── Cross-page article merging (pass 2) ─────────────────────────────


MERGE_PROMPT = """\
You are analyzing newspaper articles extracted from individual pages of a single edition.
Some articles start on one page and continue on another (e.g., "Continued on page 3",
or a matching headline/topic that picks up mid-sentence on a later page).

Below is a numbered list of articles with their page, headline, author, and a short preview.
Your task is to return ONLY grouping decisions — which articles should be merged together.

Rules:
1. Group articles that continue across pages by matching headlines, topic continuity,
   or explicit "continued on/from" references.
2. Every article must appear in exactly one group (even single-article groups).
3. Pick the best headline and author for each group.
4. Do NOT return any article body text — only article_ids, merged_headline, merged_author.

"""


_CONTINUATION_PATTERNS = [
    re.compile(p, re.IGNORECASE) for p in [
        r'\(continued (?:on|from) page \w[\w-]*\)',
        r'\bsee \w[\w\s]{0,40}, page \w[\w-]*\b',
        r'\bsee \w[\w\s]{0,40} on page \w[\w-]*\b',
        r'\b(?:please )?turn to page \w[\w-]*\b',
        r'\bcontinued on next page\b',
        r'\bcontinued from (?:previous|preceding) page\b',
        r'\bcontinued (?:on|from) (?:page )?\w[\w-]*\b',
        r'\bsee page \w[\w-]*\b',
    ]
]


def _strip_continuation_markers(text: str) -> str:
    """Remove continuation markers (various newspaper styles) from article text."""
    for pattern in _CONTINUATION_PATTERNS:
        text = pattern.sub('', text)
    return re.sub(r' +', ' ', text).strip()


def merge_edition_articles(
    client, page_results: list[tuple[str, PageContent]],
    report: PipelineReport | None = None,
) -> EditionContent | None:
    """Merge articles across pages for a single edition (pass 2 — decision only).

    page_results: list of (source_filename, PageContent) tuples, sorted by filename.
    """
    merge_timer = StageTimer().start()
    md = MergePassDiagnostics() if report is not None else None

    # Flatten all articles with their page context
    article_data = []
    all_ads = []
    all_other = []
    prompt_parts = [MERGE_PROMPT]

    for source_filename, page_content in page_results:
        page_label = page_content.page_number or source_filename
        all_ads.extend(page_content.ads)
        all_other.extend(page_content.other_content)

        for article in page_content.articles:
            idx = len(article_data)
            preview = article.body[:400].replace('\n', ' ')

            article_data.append({
                "page_label": page_label,
                "headline": article.headline,
                "author": article.author,
                "body": article.body,
                "images": list(article.images),
                "image_files": list(article.image_files),
            })

            prompt_parts.append(f"[{idx}] Page {page_label} | Headline: {article.headline}")
            if article.author:
                prompt_parts.append(f"     Author: {article.author}")
            prompt_parts.append(f"     Preview: {preview}...")
            prompt_parts.append("")

    if not article_data:
        print("  No articles found to merge.")
        return None

    if md is not None:
        md.articles_before_merge = len(article_data)

    merge_text = "\n".join(prompt_parts)

    try:
        response = gemini_generate_with_retry(
            client,
            model=GEMINI_MODEL,
            contents=[merge_text],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=MergeDecisions,
                safety_settings=SAFETY_OFF,
                max_output_tokens=8192,
            ),
        )

        usage = response.usage_metadata
        print(f"  Merge tokens: {usage.prompt_token_count} in, {usage.candidates_token_count} out")

        if md is not None:
            md.tokens = TokenUsage(
                prompt_tokens=usage.prompt_token_count,
                candidates_tokens=usage.candidates_token_count,
                total_tokens=usage.total_token_count,
            )

        if not response.parsed:
            print("  Merge response was empty or blocked.")
            if md is not None:
                md.error = "Merge response was empty or blocked"
                md.time_seconds = merge_timer.stop()
                report.merge_pass = md
            return None

        decisions: MergeDecisions = response.parsed

        # Validate: ensure every article is referenced exactly once
        referenced = set()
        for group in decisions.groups:
            deduped_ids = []
            for aid in group.article_ids:
                if aid in referenced:
                    print(f"  Warning: Article {aid} appears in multiple merge groups, skipping duplicate")
                    if md is not None:
                        md.duplicate_warnings.append(f"Article {aid} in multiple groups")
                else:
                    referenced.add(aid)
                    deduped_ids.append(aid)
            group.article_ids = deduped_ids

        # Add any unreferenced articles as singleton groups
        all_ids = set(range(len(article_data)))
        missing = all_ids - referenced
        if md is not None:
            md.unreferenced_articles = len(missing)
        for aid in sorted(missing):
            decisions.groups.append(MergeInstruction(
                article_ids=[aid],
                merged_headline=article_data[aid]["headline"],
                merged_author=article_data[aid]["author"],
            ))

        # Build merged articles programmatically from original text
        merged_articles = []
        for group in decisions.groups:
            valid_ids = [aid for aid in group.article_ids if 0 <= aid < len(article_data)]
            if not valid_ids:
                continue

            bodies = []
            all_images = []
            all_image_files = []
            source_pages = []
            for aid in valid_ids:
                ad = article_data[aid]
                cleaned_body = _strip_continuation_markers(ad["body"])
                bodies.append(cleaned_body)
                all_images.extend(ad["images"])
                all_image_files.extend(ad["image_files"])
                if ad["page_label"] not in source_pages:
                    source_pages.append(ad["page_label"])

            merged_body = "\n\n".join(bodies)

            merged_articles.append(MergedArticle(
                headline=group.merged_headline,
                author=_normalize_byline(group.merged_author),
                body=merged_body,
                images=all_images,
                image_files=all_image_files,
                source_pages=source_pages,
            ))

        if md is not None:
            md.articles_after_merge = len(merged_articles)
            md.singleton_groups = sum(1 for g in decisions.groups if len(g.article_ids) == 1)
            md.multi_article_groups = sum(1 for g in decisions.groups if len(g.article_ids) > 1)
            md.time_seconds = merge_timer.stop()
            report.merge_pass = md

        all_ads = _deduplicate_ads(all_ads)
        all_other = _deduplicate_other_content(all_other)

        return EditionContent(
            articles=merged_articles,
            ads=all_ads,
            other_content=all_other,
        )

    except Exception as e:
        print(f"  Merge failed: {e}")
        if md is not None:
            md.error = str(e)
            md.time_seconds = merge_timer.stop()
            report.merge_pass = md
        return None


# ── Core functions ──────────────────────────────────────────────────


def _extract_page_number_from_filename(filename: str) -> str:
    """Extract page number from filenames like 'Page 03.jpg' or 'Page03.tiff'."""
    match = re.search(r'Page\s*0*(\d+)', filename, re.IGNORECASE)
    return match.group(1) if match else ""


def process_page(
    client, image_path: str, diag: PageDiagnostics | None = None,
) -> tuple[PageContent, Image.Image, list[tuple[int, int, int, int]]]:
    """Send a full page image to Gemini and get structured article content.

    Returns:
        (page_content, preprocessed_image, detected_regions)
    """
    image = Image.open(image_path)
    image = preprocess_image(image, diag=diag)

    # Run local CV detection in parallel with Gemini (no API cost)
    regions = detect_image_regions(image, diag=diag)
    if regions:
        print(f"    -> Detected {len(regions)} image region(s) via local CV")

    gemini_timer = StageTimer().start()
    response = gemini_generate_with_retry(
        client,
        model=GEMINI_MODEL,
        contents=[image, "Extract all articles from this newspaper page."],
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            response_mime_type="application/json",
            response_schema=PageContent,
            safety_settings=SAFETY_OFF,
            media_resolution=types.MediaResolution.MEDIA_RESOLUTION_HIGH,
            max_output_tokens=65536,
        ),
    )
    gemini_elapsed = gemini_timer.stop()

    usage = response.usage_metadata
    print(f"    -> Tokens: {usage.prompt_token_count} in, {usage.candidates_token_count} out, {usage.total_token_count} total")

    if diag is not None:
        diag.gemini_tokens = TokenUsage(
            prompt_tokens=usage.prompt_token_count,
            candidates_tokens=usage.candidates_token_count,
            total_tokens=usage.total_token_count,
        )
        diag.timings["gemini"] = gemini_elapsed

    if response.parsed:
        page_content = deduplicate_articles(response.parsed, diag=diag)
        page_content = postprocess_page_content(page_content, diag=diag)
        if not page_content.page_number:
            page_content.page_number = _extract_page_number_from_filename(
                os.path.basename(image_path)
            )
        return page_content, image, regions

    # If we got blocked or empty, try chunked processing
    print("    -> Full page blocked or empty, trying chunked processing...")
    if diag is not None:
        diag.chunked_fallback_used = True
    page_content = process_page_chunked(client, image_path, image, diag=diag)
    return page_content, image, regions


def process_page_chunked(
    client, image_path: str, image: Image.Image | None = None,
    diag: PageDiagnostics | None = None,
) -> PageContent:
    """Safety filter workaround: split image into 3 overlapping vertical chunks."""
    if image is None:
        image = Image.open(image_path)
        image = preprocess_image(image, diag=diag)
    width, height = image.size

    # 3 chunks, each ~40% height, ~10% overlap
    chunk_height = int(height * 0.4)
    overlap = int(height * 0.1)
    offsets = [0, height // 2 - chunk_height // 2, height - chunk_height]

    all_articles = []
    all_other = []
    all_ads = []
    pub_info = ""
    page_num = ""

    for i, top in enumerate(offsets):
        bottom = min(top + chunk_height, height)
        chunk = image.crop((0, top, width, bottom))

        try:
            response = gemini_generate_with_retry(
                client,
                model=GEMINI_MODEL,
                contents=[chunk, "Extract all articles from this newspaper section."],
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    response_mime_type="application/json",
                    response_schema=PageContent,
                    safety_settings=SAFETY_OFF,
                    media_resolution=types.MediaResolution.MEDIA_RESOLUTION_HIGH,
                    max_output_tokens=65536,
                ),
            )

            if response.parsed:
                chunk_content = response.parsed
                all_articles.extend(chunk_content.articles)
                all_other.extend(chunk_content.other_content)
                all_ads.extend(chunk_content.ads)
                if chunk_content.publication_info and not pub_info:
                    pub_info = chunk_content.publication_info
                if chunk_content.page_number and not page_num:
                    page_num = chunk_content.page_number
                if diag is not None:
                    cu = response.usage_metadata
                    diag.chunk_tokens.append(TokenUsage(
                        prompt_tokens=cu.prompt_token_count,
                        candidates_tokens=cu.candidates_token_count,
                        total_tokens=cu.total_token_count,
                    ))
            else:
                print(f"    -> Chunk {i+1}/3 blocked or empty")
                if diag is not None:
                    diag.chunk_failures.append(f"Chunk {i+1}/3 blocked or empty")
        except Exception as e:
            print(f"    -> Chunk {i+1}/3 failed: {e}")
            if diag is not None:
                diag.chunk_failures.append(f"Chunk {i+1}/3 failed: {e}")

        time.sleep(0.5)  # Brief pause between chunks

    # Merge overlapping articles from adjacent chunks (50% threshold for chunk overlap)
    merged_articles = []
    used = set()
    for i, art_a in enumerate(all_articles):
        if i in used:
            continue
        best = art_a
        sents_best = _split_sentences(best.body)
        for j in range(i + 1, len(all_articles)):
            if j in used:
                continue
            sents_j = _split_sentences(all_articles[j].body)
            if _sentence_overlap(sents_best, sents_j) > 0.5:
                used.add(j)
                # Keep the longer/more complete version, preserve headline
                if len(all_articles[j].body) > len(best.body):
                    best = Article(
                        headline=best.headline or all_articles[j].headline,
                        author=best.author or all_articles[j].author,
                        body=all_articles[j].body,
                        images=best.images + all_articles[j].images,
                        image_files=best.image_files + all_articles[j].image_files,
                    )
                    sents_best = _split_sentences(best.body)
                elif not best.headline and all_articles[j].headline:
                    best = Article(
                        headline=all_articles[j].headline,
                        author=best.author or all_articles[j].author,
                        body=best.body,
                        images=best.images + all_articles[j].images,
                        image_files=best.image_files + all_articles[j].image_files,
                    )
        merged_articles.append(best)

    if not page_num:
        page_num = _extract_page_number_from_filename(os.path.basename(image_path))

    result = PageContent(
        articles=merged_articles,
        other_content=all_other,
        ads=all_ads,
        page_number=page_num,
        publication_info=pub_info,
    )
    result = deduplicate_articles(result, diag=diag)
    return postprocess_page_content(result, diag=diag)


def page_content_to_markdown(
    page_content: PageContent,
    page_name: str,
    standalone_images: list[str] | None = None,
) -> str:
    """Convert structured PageContent to readable Markdown."""
    lines = [f"# {page_name}"]

    if page_content.publication_info:
        lines.append(f"\n*{page_content.publication_info}*")

    if page_content.page_number:
        lines.append(f"\nPage {page_content.page_number}")

    for article in page_content.articles:
        lines.append("\n---\n")

        if article.headline:
            lines.append(f"## {article.headline}\n")

        if article.author:
            lines.append(f"*{article.author}*\n")

        # Ensure paragraphs have blank lines between them
        body = article.body.replace("\r\n", "\n")
        paragraphs = [p.strip() for p in body.split("\n") if p.strip()]
        lines.append("\n\n".join(paragraphs))

        for i, img in enumerate(article.images):
            caption = img.caption
            lines.append(f"\n> Photo: {caption}")
            # Pair with image file at same index if available
            if i < len(article.image_files):
                lines.append(f"\n![{caption}]({article.image_files[i]})")

        # Any extra image files beyond the caption count
        for img_file in article.image_files[len(article.images):]:
            lines.append(f"\n![Photo]({img_file})")

    for other in page_content.other_content:
        lines.append("\n---\n")

        if other.title:
            lines.append(f"## {other.title}\n")

        body = other.body.replace("\r\n", "\n")
        paragraphs = [p.strip() for p in body.split("\n") if p.strip()]
        lines.append("\n\n".join(paragraphs))

    if page_content.ads:
        lines.append("\n---\n")
        lines.append("## Advertisements\n")

        for ad in page_content.ads:
            lines.append(f"### {ad.business_name}\n")
            lines.append(ad.body.strip())
            for img_file in ad.image_files:
                lines.append(f"\n![Ad image]({img_file})")
            lines.append("")

    if standalone_images:
        lines.append("\n---\n")
        lines.append("## Images\n")
        for img_file in standalone_images:
            lines.append(f"![Page image]({img_file})\n")

    return "\n".join(lines) + "\n"


def edition_to_markdown(edition_date: str, edition_content: EditionContent) -> str:
    """Convert merged EditionContent to a single Markdown document."""
    lines = [f"# {edition_date}"]

    for article in edition_content.articles:
        lines.append("\n---\n")
        if article.headline:
            lines.append(f"## {article.headline}\n")
        if article.author:
            lines.append(f"*{article.author}*\n")
        if article.source_pages:
            lines.append(f"*Pages: {', '.join(article.source_pages)}*\n")

        body = article.body.replace("\r\n", "\n")
        paragraphs = [p.strip() for p in body.split("\n") if p.strip()]
        lines.append("\n\n".join(paragraphs))

        for i, img in enumerate(article.images):
            caption = img.caption
            lines.append(f"\n> Photo: {caption}")
            if i < len(article.image_files):
                lines.append(f"\n![{caption}]({article.image_files[i]})")

        for img_file in article.image_files[len(article.images):]:
            lines.append(f"\n![Photo]({img_file})")

    for other in edition_content.other_content:
        lines.append("\n---\n")
        if other.title:
            lines.append(f"## {other.title}\n")
        body = other.body.replace("\r\n", "\n")
        paragraphs = [p.strip() for p in body.split("\n") if p.strip()]
        lines.append("\n\n".join(paragraphs))

    if edition_content.ads:
        lines.append("\n---\n")
        lines.append("## Advertisements\n")
        for ad in edition_content.ads:
            lines.append(f"### {ad.business_name}\n")
            lines.append(ad.body.strip())
            for img_file in ad.image_files:
                lines.append(f"\n![Ad image]({img_file})")
            lines.append("")

    return "\n".join(lines) + "\n"


def process_image(
    client, image_path: str, output_dir: str,
    diag: PageDiagnostics | None = None,
) -> PageContent | None:
    """Process a single image, extract photos, write Markdown output, and return PageContent."""
    page_timer = StageTimer().start()
    base_name = os.path.basename(image_path)
    page_name = os.path.splitext(base_name)[0]
    print(f"Processing {base_name}...")

    if diag is not None:
        diag.filename = base_name

    try:
        page_content, preprocessed_image, regions = process_page(
            client, image_path, diag=diag,
        )

        if not page_content.articles and not page_content.ads and not page_content.other_content:
            print(f"    -> No content extracted")
            if diag is not None:
                diag.total_time_seconds = page_timer.stop()
            return None

        # Crop and save detected image regions
        saved_files = crop_and_save_images(
            preprocessed_image, regions, output_dir, page_name
        )

        if diag is not None:
            diag.images_saved = len(saved_files)

        # Match regions to articles/ads using visual matching (with spatial fallback)
        standalone_images = []
        if saved_files and regions:
            region_to_article = {}
            region_to_ad = {}
            unmatched = list(range(len(regions)))
            captions: dict[int, str] = {}
            used_visual = False

            # Skip visual matching if no articles and no ads (all regions standalone)
            if page_content.articles or page_content.ads:
                annotated = draw_region_annotations(preprocessed_image, regions)
                visual_result = match_images_visual(
                    client, annotated, page_content, len(regions), diag=diag,
                )
                if visual_result is not None:
                    region_to_article, region_to_ad, unmatched, captions = (
                        _apply_visual_assignments(
                            visual_result, page_content, len(regions), diag=diag,
                        )
                    )
                    used_visual = True
                else:
                    # Fall back to spatial matching
                    print("    -> Falling back to spatial matching")
                    if diag is not None:
                        diag.visual_matching.fallback_to_spatial = True
                    w, h = preprocessed_image.size
                    region_to_article, unmatched = match_images_to_articles(
                        regions, page_content.articles, h, w, diag=diag,
                    )

            # Attach matched images to their articles (with captions from visual matching)
            for ri, ai in region_to_article.items():
                if ri in saved_files:
                    page_content.articles[ai].image_files.append(saved_files[ri])
                    if ri in captions:
                        page_content.articles[ai].images.append(
                            ArticleImage(caption=captions[ri])
                        )

            # Log ad-matched regions but don't attach (ad graphics aren't useful)
            for ri, adi in region_to_ad.items():
                if ri in saved_files:
                    ad_name = page_content.ads[adi].business_name
                    print(f"    -> Region {ri+1} matched to ad (skipped): {ad_name}")

            # Collect unmatched images as standalone
            standalone_images = [saved_files[ri] for ri in unmatched if ri in saved_files]

            matched_article = len(region_to_article)
            matched_ad = len(region_to_ad)
            method = "visual" if used_visual else "spatial"
            print(f"    -> Images ({method}): {matched_article} to articles, {matched_ad} to ads, {len(standalone_images)} standalone")

        markdown = page_content_to_markdown(page_content, page_name, standalone_images)
        output_path = os.path.join(output_dir, page_name + ".md")

        with open(output_path, "w", encoding="utf-8") as f:
            f.write(markdown)

        print(f"    -> {len(page_content.articles)} articles -> {output_path}")

        if diag is not None:
            diag.page_number = page_content.page_number
            diag.final_article_count = len(page_content.articles)
            diag.final_ad_count = len(page_content.ads)
            diag.final_other_content_count = len(page_content.other_content)
            diag.total_time_seconds = page_timer.stop()

        return page_content

    except Exception as e:
        print(f"    -> Failed: {e}")
        if diag is not None:
            diag.error = str(e)
            diag.total_time_seconds = page_timer.stop()
        return None


def _process_edition(client, edition_dir: str, output_dir: str) -> None:
    """Process all pages in an edition directory, then merge articles."""
    edition_date = extract_edition_date(edition_dir)
    pipeline_start = time.time()

    report = PipelineReport(
        edition_date=edition_date,
        start_time=datetime.now(timezone.utc).isoformat(),
    )

    image_files = sorted(
        f for f in glob.glob(os.path.join(edition_dir, "*"))
        if os.path.splitext(f)[1].lower() in IMAGE_EXTENSIONS
    )

    if not image_files:
        print(f"No images found in {edition_dir}")
        return

    report.pages_attempted = len(image_files)

    edition_output = os.path.join(output_dir, edition_date)
    os.makedirs(edition_output, exist_ok=True)

    print(f"\n{'='*60}")
    print(f"Edition: {edition_date} ({len(image_files)} pages)")
    print(f"{'='*60}")

    # Pass 1: process each page
    page_results = []  # (source_filename, PageContent)
    for img in image_files:
        page_diag = PageDiagnostics()
        result = process_image(client, img, edition_output, diag=page_diag)
        report.page_diagnostics.append(page_diag)
        if result is not None:
            page_results.append((os.path.basename(img), result))
        if img != image_files[-1]:
            time.sleep(1)

    report.pages_processed = len(page_results)
    print(f"\nPass 1 done: {len(page_results)}/{len(image_files)} pages processed")

    # Pass 2: merge articles across pages
    if page_results:
        print(f"\nMerging articles across pages for {edition_date}...")
        merged = merge_edition_articles(client, page_results, report=report)
        if merged:
            md = edition_to_markdown(edition_date, merged)
            merged_path = os.path.join(output_dir, f"{edition_date}.md")
            with open(merged_path, "w", encoding="utf-8") as f:
                f.write(md)
            print(f"  -> {len(merged.articles)} merged articles -> {merged_path}")

            # Write structured JSON for frontend viewer
            pub_info = ""
            for _, pc in page_results:
                if pc.publication_info:
                    pub_info = pc.publication_info
                    break
            edition_json = {
                "edition_date": edition_date,
                "publication_info": pub_info,
                **merged.model_dump(),
            }
            json_path = os.path.join(edition_output, "edition.json")
            with open(json_path, "w", encoding="utf-8") as f:
                json.dump(edition_json, f, indent=2)
            print(f"  -> Edition JSON -> {json_path}")

    # Finalize and write diagnostics
    report.total_time_seconds = time.time() - pipeline_start
    report.finalize()

    diag_path = os.path.join(edition_output, "diagnostics.json")
    with open(diag_path, "w", encoding="utf-8") as f:
        f.write(report.to_json())
    print(f"\nDiagnostics written to {diag_path}")

    report.print_summary()


def main():
    # Use 'public/editions' directory for deployment
    output_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "editions")
    os.makedirs(output_dir, exist_ok=True)

    client = genai.Client()

    if len(sys.argv) > 1:
        path = sys.argv[1]
        if os.path.isfile(path):
            print(f"Processing single file: {path}")
            pipeline_start = time.time()
            report = PipelineReport(
                edition_date="single-file",
                start_time=datetime.now(timezone.utc).isoformat(),
                pages_attempted=1,
            )
            page_diag = PageDiagnostics()
            result = process_image(client, path, output_dir, diag=page_diag)
            report.page_diagnostics.append(page_diag)
            report.pages_processed = 1 if result is not None else 0
            report.total_time_seconds = time.time() - pipeline_start
            report.finalize()

            diag_path = os.path.join(output_dir, "diagnostics.json")
            with open(diag_path, "w", encoding="utf-8") as f:
                f.write(report.to_json())
            print(f"\nDiagnostics written to {diag_path}")
            report.print_summary()
        elif os.path.isdir(path):
            _process_edition(client, path, output_dir)
        else:
            print(f"Path not found: {path}")
            return
    else:
        editions_root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "editions")
        if not os.path.isdir(editions_root):
            print(f"Editions directory not found: {editions_root}")
            return

        edition_dirs = sorted(
            d for d in glob.glob(os.path.join(editions_root, "*"))
            if os.path.isdir(d)
        )

        if not edition_dirs:
            print("No edition directories found")
            return

        print(f"Found {len(edition_dirs)} edition(s) to process.")
        for edition_dir in edition_dirs:
            _process_edition(client, edition_dir, output_dir)

    print("\nAll done.")


if __name__ == "__main__":
    main()
