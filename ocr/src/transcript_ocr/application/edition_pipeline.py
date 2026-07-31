"""Manifest-accounted OCR edition pipeline.

This module builds a validated candidate only.  R2 upload and the atomic public
directory swap are owned by ``scripts/ocr/process-edition.sh``.
"""

from __future__ import annotations

import copy
import json
import os
import shutil
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..config.prompts_loader import MODELS
from ..contracts.content_models import (
    EditionContent,
    MergedArticle,
    PageContent,
)
from ..contracts.diagnostics_models import PageDiagnostics, PipelineReport, TokenUsage
from ..contracts.page_state import PageOutcome, PageState, may_publish, publication_ratio
from ..diagnostics.costing import estimate_gemini_cost
from ..diagnostics.failure_log import append_failure
from ..export.edition_writer import align_existing_image_files, finalize_and_write_edition_json, write_edition_json
from ..export.provenance import write_provenance
from ..export.validation import validate_candidate_file
from ..ingestion.discovery import extract_edition_date
from ..ingestion.manifest import EditionPageInventory, PageExpectation, discover_page_inventory
from ..ingestion.pathing import RunPaths
from ..merging.llm_merge import merge_edition_articles
from ..preprocessing.image_converter import convert_edition_images_tolerant
from ..shared.console import banner, error, stage, success, warning
from ..shared.retry import observe_gemini_failures
from ..shared.text import normalize_whitespace
from .ad_enrichment import enrich_edition
from .content_rescue import triage_edition
from .page_pipeline import extract_page_docai, structure_and_link_page


class EditionPipelineError(RuntimeError):
    """Fatal candidate outcome that must prevent public promotion."""


@dataclass(frozen=True)
class EditionRunResult:
    edition_date: str
    edition_json_path: str
    manifest_canvas_count: int
    pass_ratio: float
    outcomes: tuple[PageOutcome, ...]
    estimated_gemini_cost_usd: float


def _log_failure(edition: str, stage_name: str, exc: BaseException | str, **metadata) -> None:
    try:
        append_failure(edition=edition, stage=stage_name, error=exc, **metadata)
    except Exception as log_exc:
        warning(f"Could not append failure metadata: {log_exc}")


def _page_state(content: PageContent) -> PageState:
    visual_paths = [
        path
        for article in content.articles
        for path in article.image_files
    ] + [path for ad in content.ads for path in ad.image_files]
    visual_paths.extend(
        item.body for item in content.other_content if (item.body or "").startswith("images/")
    )
    has_historical_text = bool(
        content.articles
        or content.ads
        or content.publication_info.strip()
        or any(
            (item.title or "").strip()
            or ((item.body or "").strip() and not (item.body or "").startswith("images/"))
            for item in content.other_content
        )
    )
    if has_historical_text:
        return PageState.PASSED_CONTENT
    if visual_paths:
        return PageState.PASSED_VISUAL
    return PageState.CONFIRMED_BLANK


def _unmerged_edition(page_results: list[tuple[str, PageContent]]) -> EditionContent:
    articles: list[MergedArticle] = []
    ads = []
    other = []
    for source_filename, page in page_results:
        page_label = str(page.page_number or source_filename)
        for article in page.articles:
            merged_article = MergedArticle(
                headline=article.headline,
                author=article.author,
                writer_position=article.writer_position,
                category=article.category,
                continues_on=article.continues_on,
                continued_from=article.continued_from,
                body=article.body,
                images=list(article.images),
                image_files=list(article.image_files),
                source_pages=[page_label],
            )
            merged_article._category_fallback_used = article._category_fallback_used
            merged_article._source_pages_internal = [page_label]
            articles.append(merged_article)
        ads.extend(page.ads)
        other.extend(page.other_content)
    return EditionContent.model_construct(
        articles=articles,
        ads=ads,
        other_content=other,
    )


def _deduplicate_exact_articles(edition: EditionContent) -> None:
    """Remove only exact normalized headline+body duplicates, preserving evidence."""
    seen: dict[tuple[str, str], MergedArticle] = {}
    kept: list[MergedArticle] = []
    for article in edition.articles:
        key = (
            normalize_whitespace(article.headline),
            normalize_whitespace(article.body),
        )
        previous = seen.get(key)
        if previous is None:
            seen[key] = article
            kept.append(article)
            continue
        for page in article.source_pages:
            if page not in previous.source_pages:
                previous.source_pages.append(page)
        for image, image_file in zip(article.images, article.image_files):
            if image_file not in previous.image_files:
                previous.image_files.append(image_file)
                previous.images.append(image)
        previous._category_fallback_used = (
            previous._category_fallback_used or article._category_fallback_used
        )
        for page in article._source_pages_internal:
            if page not in previous._source_pages_internal:
                previous._source_pages_internal.append(page)
    edition.articles = kept


def _build_review_hints(edition: EditionContent) -> dict[str, dict[str, Any]]:
    """Expose private page-stage evidence to one review call without persisting it."""
    hints: dict[str, dict[str, Any]] = {}
    collections = (
        ("article", edition.articles),
        ("ad", edition.ads),
        ("other", edition.other_content),
    )
    for item_type, items in collections:
        for index, item in enumerate(items):
            item_hints: dict[str, Any] = {}
            if getattr(item, "_category_fallback_used", False):
                item_hints["category_fallback_used"] = True
            if item._review_unresolved:
                item_hints["classification_state"] = "unresolved"
            if item._visual_kind_conflict:
                item_hints["visual_kind_conflict"] = True
            source_pages = (
                list(item.source_pages)
                if item_type == "article"
                else list(item._source_pages_internal)
            )
            if source_pages:
                item_hints["source_pages"] = source_pages
            if item_hints:
                hints[f"{item_type}-{index}"] = item_hints
    return hints


def _publication_info(page_results: list[tuple[str, PageContent]]) -> str:
    """Keep the front-page identity and most complete masthead, not page furniture."""
    values: list[str] = []
    for _filename, page in page_results:
        value = page.publication_info.strip()
        if value and value not in values:
            values.append(value)
    if not values:
        return ""
    first = values[0]
    longest = max(values, key=len)
    if longest == first or normalize_whitespace(first) in normalize_whitespace(longest):
        return longest
    return f"{first}\n\n{longest}"


def _usage_from_event(event: dict[str, Any]) -> TokenUsage:
    tokens = event.get("tokens") or {}
    return TokenUsage(
        prompt_tokens=int(tokens.get("prompt_tokens", 0) or 0),
        candidates_tokens=int(tokens.get("candidates_tokens", 0) or 0),
        thoughts_tokens=int(tokens.get("thoughts_tokens", 0) or 0),
        tool_use_prompt_tokens=int(tokens.get("tool_use_prompt_tokens", 0) or 0),
        cached_content_tokens=int(tokens.get("cached_content_tokens", 0) or 0),
        total_tokens=int(tokens.get("total_tokens", 0) or 0),
    )


def _estimate_report_cost(
    report: PipelineReport,
    extra_model_events: list[dict[str, Any]] | None = None,
) -> float:
    total = 0.0
    for page in report.page_diagnostics:
        total += estimate_gemini_cost("gemini-3.5-flash-lite", page.gemini_tokens).usd
        if page.visual_matching.attempted:
            total += estimate_gemini_cost(
                "gemini-3.5-flash-lite", page.visual_matching.tokens
            ).usd
    if report.merge_pass is not None:
        total += estimate_gemini_cost("gemini-3.6-flash", report.merge_pass.tokens).usd
    for event in extra_model_events or []:
        total += estimate_gemini_cost(
            str(event["model"]),
            _usage_from_event(event),
        ).usd
    return total


def _safe_remove_new_candidate(candidate: Path, output_root: Path) -> None:
    try:
        candidate.resolve().relative_to(output_root.resolve())
    except ValueError:
        return
    if candidate != output_root and candidate.exists():
        shutil.rmtree(candidate)


def process_edition(
    settings: Any,
    client: Any,
    paths: RunPaths,
    workers: int = 1,
) -> EditionRunResult:
    """Process every available canvas and return a promotable candidate."""
    del settings
    workers = workers or int(os.getenv("OCR_WORKERS", "1"))
    workers = max(1, workers)
    edition_dir = Path(paths.edition_dir).resolve()
    output_root = Path(paths.public_output_root).resolve()
    edition_date = extract_edition_date(str(edition_dir))
    candidate = output_root / edition_date
    if candidate.exists():
        raise EditionPipelineError(f"candidate already exists: {candidate}")
    candidate.mkdir(parents=True, exist_ok=True)

    owned_work: tempfile.TemporaryDirectory[str] | None = None
    if paths.work_root:
        work_root = Path(paths.work_root).resolve()
        work_root.mkdir(parents=True, exist_ok=True)
    else:
        work_parent = edition_dir.parent / ".ocr-work"
        work_parent.mkdir(parents=True, exist_ok=True)
        owned_work = tempfile.TemporaryDirectory(prefix=f"{edition_date}.", dir=work_parent)
        work_root = Path(owned_work.name)

    started = time.time()
    report = PipelineReport(edition_date=edition_date, pages_attempted=0)
    extra_model_events: list[dict[str, Any]] = []

    def record_model_event(event: dict[str, Any]) -> None:
        if event.get("status") == "success":
            extra_model_events.append(copy.deepcopy(event))

    def attempt_failure_observer(canvas: int | None = None, page: str = ""):
        def record(event: dict[str, Any]) -> None:
            model = str(event.get("model") or "")
            token_event = {"model": model, "tokens": event.get("tokens") or {}}
            usage = _usage_from_event(token_event)
            if (
                usage.prompt_tokens
                or usage.tool_use_prompt_tokens
                or usage.candidates_tokens
                or usage.thoughts_tokens
            ):
                extra_model_events.append(token_event)
            estimated = estimate_gemini_cost(model, usage).usd if model else None
            _log_failure(
                edition_date,
                str(event.get("stage") or "gemini"),
                str(event.get("error") or "Gemini attempt failed"),
                canvas=canvas,
                page=page,
                attempt=event.get("attempt"),
                model=model,
                config_id=f"{event.get('stage', 'gemini')}-v1",
                status=str(event.get("status") or "failed"),
                finish_reason=str(event.get("finish_reason") or ""),
                latency_ms=event.get("latency_ms"),
                tokens=event.get("tokens") or {},
                estimated_cost_usd=estimated,
            )

        return record
    outcomes_by_canvas: dict[int, PageOutcome] = {}
    page_results_by_canvas: dict[int, tuple[str, PageContent]] = {}
    succeeded = False
    try:
        conversion_failures = convert_edition_images_tolerant(str(edition_dir))
        inventory: EditionPageInventory = discover_page_inventory(
            edition_dir, paths.manifest_path
        )
        expected = inventory.expected_pages
        report.pages_attempted = expected
        if expected <= 0:
            raise EditionPipelineError("edition has no manifest canvases or local pages")
        if not inventory.authoritative:
            warning("No IIIF manifest found; treating each discovered page as a synthetic canvas")

        banner(edition_date, expected, str(candidate))
        for page in inventory.pages:
            if page.local_path is None:
                reason = "manifest canvas has no downloaded image"
                outcomes_by_canvas[page.index] = PageOutcome(page.index, PageState.FAILED, reason=reason)
                _log_failure(edition_date, "download", reason, canvas=page.index, page=str(page.index))
            elif Path(page.local_path).name in conversion_failures:
                reason = conversion_failures[Path(page.local_path).name]
                outcomes_by_canvas[page.index] = PageOutcome(
                    page.index, PageState.FAILED, Path(page.local_path).name, reason
                )
                _log_failure(edition_date, "conversion", reason, canvas=page.index, page=str(page.index))

        available = [
            page
            for page in inventory.pages
            if page.local_path is not None and page.index not in outcomes_by_canvas
        ]
        stage("Document AI + source visual detection", 1, 5)
        extracted: dict[int, tuple] = {}
        diagnostics: dict[int, PageDiagnostics] = {}

        def extract_one(page: PageExpectation):
            diag = PageDiagnostics(filename=Path(page.local_path or "").name)
            page_work = work_root / f"canvas-{page.index:04d}"
            page_work.mkdir(parents=True, exist_ok=True)
            result = extract_page_docai(
                page.local_path or "",
                diag=diag,
                work_dir=str(page_work),
            )
            return page.index, diag, result

        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(extract_one, page): page for page in available}
            for future in as_completed(futures):
                page = futures[future]
                try:
                    canvas, diag, result = future.result()
                    diagnostics[canvas] = diag
                    extracted[canvas] = result
                except Exception as exc:
                    diag = PageDiagnostics(filename=Path(page.local_path or "").name, error=str(exc))
                    diagnostics[page.index] = diag
                    outcomes_by_canvas[page.index] = PageOutcome(
                        page.index, PageState.FAILED, diag.filename, str(exc)
                    )
                    _log_failure(
                        edition_date,
                        "document_ai_or_detection",
                        exc,
                        canvas=page.index,
                        page=str(page.index),
                        model="document-ai-enterprise-ocr+hybrid-layout",
                        config_id="processorVersions/stable",
                    )

        stage("Gemini page structuring + visual assignment", 2, 5)

        def structure_one(page: PageExpectation):
            docai, ocr_image, regions, source_image = extracted[page.index]
            diag = diagnostics[page.index]
            with observe_gemini_failures(
                attempt_failure_observer(page.index, str(page.index))
            ):
                content = structure_and_link_page(
                    client,
                    page.local_path or "",
                    docai,
                    ocr_image,
                    regions,
                    str(candidate),
                    diag=diag,
                    source_image=source_image,
                )
            return page.index, diag, content

        structured_pages = [page for page in available if page.index in extracted]
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(structure_one, page): page for page in structured_pages}
            for future in as_completed(futures):
                page = futures[future]
                try:
                    canvas, diag, content = future.result()
                except Exception as exc:
                    diag = diagnostics[page.index]
                    diag.error = str(exc)
                    content = None
                    canvas = page.index
                if content is None:
                    reason = diag.error or "page structuring returned no valid contract"
                    outcomes_by_canvas[canvas] = PageOutcome(
                        canvas, PageState.FAILED, diag.filename, reason
                    )
                    _log_failure(
                        edition_date,
                        "page_structuring_or_visual",
                        reason,
                        canvas=canvas,
                        page=str(canvas),
                        model="gemini-3.5-flash-lite",
                        config_id="page-visual-v1",
                    )
                    continue
                if not str(content.page_number or "").isdigit():
                    content.page_number = str(canvas)
                source_page = str(canvas)
                for item in [*content.articles, *content.ads, *content.other_content]:
                    item._source_pages_internal = [source_page]
                state = _page_state(content)
                outcomes_by_canvas[canvas] = PageOutcome(
                    canvas, state, diag.filename, ""
                )
                page_results_by_canvas[canvas] = (diag.filename, content)

        for page in inventory.pages:
            if page.index not in outcomes_by_canvas:
                reason = "canvas did not reach a terminal state"
                outcomes_by_canvas[page.index] = PageOutcome(
                    page.index,
                    PageState.FAILED,
                    Path(page.local_path or "").name,
                    reason,
                )
                _log_failure(edition_date, "page_state", reason, canvas=page.index, page=str(page.index))

        outcomes = [outcomes_by_canvas[index] for index in sorted(outcomes_by_canvas)]
        ratio = publication_ratio(outcomes, expected)
        report.pages_processed = sum(outcome.state != PageState.FAILED for outcome in outcomes)
        report.page_diagnostics = [diagnostics[index] for index in sorted(diagnostics)]
        if not may_publish(outcomes, expected):
            raise EditionPipelineError(
                f"only {report.pages_processed}/{expected} manifest canvases passed ({ratio:.1%}); 70% required"
            )

        page_results = [page_results_by_canvas[index] for index in sorted(page_results_by_canvas)]
        stage("Edition article grouping + seam review", 3, 5)
        try:
            with observe_gemini_failures(attempt_failure_observer()):
                merged = merge_edition_articles(
                    client,
                    page_results,
                    report=report,
                )
        except Exception as exc:
            warning(f"Edition merge stage failed; preserving source fragments: {exc}")
            _log_failure(
                edition_date,
                "article_grouping_or_seam",
                exc,
                model="gemini-3.6-flash",
                config_id="merge-seam-v1",
            )
            merged = None
        if merged is None:
            merged = _unmerged_edition(page_results)
        _deduplicate_exact_articles(merged)
        align_existing_image_files(str(candidate), merged)

        edition_json_path = candidate / "edition.json"
        finalize_and_write_edition_json(
            str(edition_json_path),
            edition_date,
            _publication_info(page_results),
            merged,
            merge_diag=report.merge_pass,
        )
        review_hints = _build_review_hints(merged)
        validate_candidate_file(edition_json_path, expected_date=edition_date)

        stage("Ad enrichment + targeted final review", 4, 5)
        before_enrichment = copy.deepcopy(
            json.loads(edition_json_path.read_text(encoding="utf-8"))
        )
        try:
            with observe_gemini_failures(attempt_failure_observer()):
                enrich_edition(
                    str(edition_json_path),
                    client,
                    telemetry_hook=record_model_event,
                )
            validate_candidate_file(edition_json_path, expected_date=edition_date)
        except Exception as exc:
            warning(f"Discarding failed or invalid enrichment result: {exc}")
            write_edition_json(str(edition_json_path), before_enrichment)
            _log_failure(edition_date, "ad_enrichment", exc, model="gemini-3.5-flash-lite")

        before_review = copy.deepcopy(
            json.loads(edition_json_path.read_text(encoding="utf-8"))
        )
        try:
            with observe_gemini_failures(attempt_failure_observer()):
                triage_edition(
                    str(edition_json_path),
                    client,
                    review_hints=review_hints,
                    telemetry_hook=record_model_event,
                )
            validate_candidate_file(edition_json_path, expected_date=edition_date)
        except Exception as exc:
            warning(f"Discarding failed or invalid final-review result: {exc}")
            write_edition_json(str(edition_json_path), before_review)
            _log_failure(edition_date, "final_content_review", exc, model="gemini-3.5-flash-lite")

        validate_candidate_file(edition_json_path, expected_date=edition_date)
        report.total_time_seconds = time.time() - started
        report.finalize()
        estimated_cost = _estimate_report_cost(report, extra_model_events)
        write_provenance(
            candidate / "provenance.json",
            edition_date=edition_date,
            edition_dir=edition_dir,
            manifest_path=inventory.manifest_path,
            outcomes=outcomes,
            project=os.getenv("GOOGLE_CLOUD_PROJECT", ""),
            location="global",
            model_routes=MODELS,
        )
        stage("Candidate summary", 5, 5)
        success(
            f"{report.pages_processed}/{expected} canvases passed ({ratio:.1%}); "
            f"estimated Gemini cost captured so far: ${estimated_cost:.4f}"
        )
        succeeded = True
        return EditionRunResult(
            edition_date=edition_date,
            edition_json_path=str(edition_json_path),
            manifest_canvas_count=expected,
            pass_ratio=ratio,
            outcomes=tuple(outcomes),
            estimated_gemini_cost_usd=estimated_cost,
        )
    except Exception as exc:
        error(str(exc))
        _log_failure(edition_date, "edition", exc)
        if isinstance(exc, EditionPipelineError):
            raise
        raise EditionPipelineError(str(exc)) from exc
    finally:
        if owned_work is not None:
            owned_work.cleanup()
            try:
                owned_work_path = Path(owned_work.name).parent
                owned_work_path.rmdir()
            except OSError:
                pass
        if not succeeded:
            _safe_remove_new_candidate(candidate, output_root)


__all__ = [
    "EditionPipelineError",
    "EditionRunResult",
    "RunPaths",
    "process_edition",
]
