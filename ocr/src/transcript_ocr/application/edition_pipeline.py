"""Edition-level pipeline entrypoints.

Seven-phase pipeline:
  Phase 0: TIF → PNG conversion (lossless, runs first)
  Phase 1: DocAI extraction (all pages, fail-fast)
  Phase 2: Gemini structuring (all pages, uses DocAI text)
  Phase 3: Cross-page merge
  Phase 4: Ad enrichment
  Phase 5: Content triage (rescue misclassified articles)
  Phase 6: Summary + diagnostics
"""

from __future__ import annotations

import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any

from ..contracts.content_models import EditionContent, MergedArticle
from ..contracts.diagnostics_models import PageDiagnostics, PipelineReport
from ..diagnostics.run_manifest import _get_git_commit_hash
from ..diagnostics.snapshots import save_snapshot
from ..export.artifact_writer import write_diagnostics_json, write_issue_reports
from ..export.edition_writer import align_existing_image_files, finalize_and_write_edition_json
from ..export.markdown_writer import edition_to_markdown
from ..ingestion.discovery import discover_page_images, extract_edition_date
from ..preprocessing.image_converter import convert_edition_images
from ..config.paths import REPO_ROOT
from ..ingestion.pathing import RunPaths
from ..merging.llm_merge import merge_edition_articles
from ..recognition.docai_provider import DocAIError
from ..shared.console import banner, stage, substep, success, warning, error, file_written, page_progress, print_summary_table
from .ad_enrichment import enrich_edition
from .content_rescue import triage_edition
from .page_pipeline import extract_page_docai, structure_and_link_page


def _is_gemini_transient(exc: BaseException) -> bool:
    """Return True if `exc` looks like a transient Gemini 5xx / quota failure.

    Used by the broad `except` blocks in Phases 4 and 5 to tag warning
    messages so operators can distinguish transient outages from genuine
    config or schema errors in logs, without narrowing the except itself
    (which would start failing editions that currently tolerate these).
    """
    code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    if code is not None:
        try:
            code_int = int(code)
            if code_int in {429, 500, 502, 503, 504}:
                return True
        except (ValueError, TypeError):
            pass
    exc_str = str(exc).lower()
    return any(
        term in exc_str
        for term in (
            "503",
            "502",
            "504",
            "unavailable",
            "resource exhausted",
            "resource_exhausted",
            "quota",
            "rate limit",
            "deadline exceeded",
            "deadline_exceeded",
        )
    )


def process_edition(
    settings: Any,
    client: Any,
    paths: RunPaths,
    run_id: str = "",
    workers: int = 1,
) -> None:
    """Process all pages in an edition directory using the five-phase pipeline."""
    del settings
    workers = workers or int(os.getenv("OCR_WORKERS", "1"))
    edition_dir = paths.edition_dir
    output_dir = paths.public_output_root
    ocr_output_dir = paths.ocr_output_root

    edition_date = extract_edition_date(edition_dir)
    resolved_run_id = run_id or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    pipeline_start = time.time()
    edition_output = os.path.join(output_dir, edition_date)
    os.makedirs(edition_output, exist_ok=True)
    output_edition_abs = os.path.abspath(edition_output)

    report = PipelineReport(
        edition_date=edition_date,
        run_id=resolved_run_id,
        input_edition_dir=os.path.abspath(edition_dir),
        output_edition_dir=output_edition_abs,
        git_commit_hash=_get_git_commit_hash(str(REPO_ROOT)),
        start_time=datetime.now(timezone.utc).isoformat(),
    )

    # ── Phase 0: Convert TIF scans to optimized PNG ──────────
    convert_edition_images(edition_dir)

    image_files = discover_page_images(edition_dir)
    if not image_files:
        warning(f"No images found in {edition_dir}")
        return

    report.pages_attempted = len(image_files)

    edition_ocr_output = None
    if ocr_output_dir:
        if run_id:
            edition_ocr_output = os.path.join(ocr_output_dir, edition_date, "runs", resolved_run_id)
        else:
            edition_ocr_output = os.path.join(ocr_output_dir, edition_date)
        os.makedirs(edition_ocr_output, exist_ok=True)
        report.run_root = os.path.abspath(edition_ocr_output)
    else:
        report.run_root = output_edition_abs

    snapshots_dir = None
    if edition_ocr_output:
        snapshots_dir = os.path.join(edition_ocr_output, "snapshots")
        os.makedirs(snapshots_dir, exist_ok=True)
        file_written("Snapshots", snapshots_dir)

    if report.run_root:
        from ..diagnostics.run_manifest import _write_run_manifest

        report.run_manifest_path = _write_run_manifest(report.run_root, edition_dir, image_files, report)
        file_written("Run manifest", report.run_manifest_path)

    banner(edition_date, len(image_files), output_edition_abs, resolved_run_id, edition_ocr_output or "")

    # ── Phase 1: DocAI extraction (all pages, fail-fast) ──────────
    stage("DocAI extraction", 1, 6)

    docai_results: dict[str, tuple] = {}  # img_path -> (docai_result, preprocessed_image, regions)
    page_diag_map: dict[str, PageDiagnostics] = {}

    def _run_phase1_page(img: str) -> tuple[str, PageDiagnostics, tuple | None]:
        """Worker function for Phase 1 — returns (img, diag, extraction_result_or_None)."""
        page_diag = PageDiagnostics()
        result = extract_page_docai(
            img, diag=page_diag, snapshots_dir=snapshots_dir,
        )
        # extract_page_docai returns (None, None, []) for skipped pages (quality check)
        if result[0] is None:
            return img, page_diag, None
        return img, page_diag, result

    with page_progress(len(image_files)) as progress:
        task_id = progress.add_task("DocAI extraction", total=len(image_files))
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(_run_phase1_page, img): img for img in image_files}
            for future in as_completed(futures):
                img = futures[future]
                try:
                    _, page_diag, result = future.result()
                    page_diag_map[img] = page_diag
                    if result is not None:
                        docai_results[img] = result
                except DocAIError as exc:
                    page_diag = PageDiagnostics()
                    page_diag.error = str(exc)
                    page_diag_map[img] = page_diag
                    error(f"DocAI failed on {os.path.basename(img)}: {exc} — skipping page")
                except Exception as exc:
                    page_diag = PageDiagnostics()
                    page_diag.error = str(exc)
                    page_diag_map[img] = page_diag
                    error(f"Phase 1 failed on {os.path.basename(img)}: {exc} — skipping page")
                progress.advance(task_id)

    phase1_succeeded = len(docai_results)
    phase1_failed = len(image_files) - phase1_succeeded
    if phase1_failed > 0:
        warning(f"Phase 1: {phase1_failed}/{len(image_files)} pages failed — continuing with {phase1_succeeded} pages")
    if phase1_succeeded == 0:
        error("All pages failed in Phase 1 — aborting edition")
        report.page_diagnostics.extend(page_diag_map.values())
        report.total_time_seconds = time.time() - pipeline_start
        report.finalize()
        _write_diagnostics_and_issues(report, edition_ocr_output, edition_output, snapshots_dir, "")
        return

    success(f"Phase 1 done: {phase1_succeeded}/{len(image_files)} pages extracted via DocAI")

    # ── Phase 2: Gemini structuring (all pages) ───────────────────
    stage("Gemini structuring", 2, 6)

    page_results: list[tuple[str, Any]] = []

    # Only process pages that succeeded in Phase 1
    phase2_images = [img for img in image_files if img in docai_results]

    def _run_phase2_page(img: str) -> tuple[str, PageDiagnostics, Any]:
        """Worker function for Phase 2 — returns (img, diag, result)."""
        docai_result, preprocessed_image, regions = docai_results[img]
        page_diag = page_diag_map[img]
        result = structure_and_link_page(
            client, img, docai_result, preprocessed_image, regions,
            edition_output, diag=page_diag, ocr_output_dir=edition_ocr_output,
            snapshots_dir=snapshots_dir,
        )
        return img, page_diag, result

    with page_progress(len(phase2_images)) as progress:
        task_id = progress.add_task("Gemini structuring", total=len(phase2_images))
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(_run_phase2_page, img): img for img in phase2_images}
            collected: list[tuple[str, PageDiagnostics, Any]] = []
            for future in as_completed(futures):
                img, page_diag, result = future.result()
                collected.append((img, page_diag, result))
                progress.advance(task_id)

    # Include diagnostics for pages that were skipped/failed in Phase 1
    for img in image_files:
        if img not in docai_results and img in page_diag_map:
            report.page_diagnostics.append(page_diag_map[img])

    # Restore page ordering (sorted by filename) for deterministic merge
    collected.sort(key=lambda t: t[0])
    for img, page_diag, result in collected:
        report.page_diagnostics.append(page_diag)
        if result is not None:
            page_results.append((os.path.basename(img), result))

    report.pages_processed = len(page_results)
    success(f"Phase 2 done: {len(page_results)}/{len(image_files)} pages structured")

    # Free preprocessed images — Phase 3+ only needs article text
    docai_results.clear()

    # ── Phase 3: Cross-page merge ─────────────────────────────────
    edition_json_path = os.path.join(edition_output, "edition.json")
    if page_results:
        stage("Cross-page merge", 3, 6)
        substep(f"Merging articles across pages for {edition_date}...")
        merged = merge_edition_articles(client, page_results, report=report, snapshots_dir=snapshots_dir)
        save_snapshot(snapshots_dir, "post_merge_edition.json", merged)
        if not merged:
            warning("Merge failed — falling back to unmerged edition.")
            all_articles = []
            all_ads = []
            all_other = []
            for source_filename, pc in page_results:
                page_label = pc.page_number or source_filename
                for art in pc.articles:
                    all_articles.append(
                        MergedArticle(
                            headline=art.headline,
                            author=art.author,
                            writer_position=art.writer_position,
                            category=art.category,
                            continues_on=art.continues_on,
                            continued_from=art.continued_from,
                            body=art.body,
                            images=list(art.images),
                            image_files=list(art.image_files),
                            source_pages=[str(page_label)],
                        )
                    )
                all_ads.extend(pc.ads)
                all_other.extend(pc.other_content)
            merged = EditionContent(articles=all_articles, ads=all_ads, other_content=all_other)
            substep(f"{len(merged.articles)} unmerged articles")

        # ── Drop articles linked to failed pages ──
        failed_pages = set()
        for pd in report.page_diagnostics:
            if pd.error and pd.final_article_count == 0 and pd.final_ad_count == 0:
                # page_number may be empty if page failed before Gemini assigned it
                pg = pd.page_number or ""
                if not pg and pd.filename:
                    from .page_pipeline import _extract_page_number_from_filename
                    pg = _extract_page_number_from_filename(pd.filename) or ""
                if pg:
                    failed_pages.add(str(pg))

        if failed_pages and merged:
            before = len(merged.articles)
            merged.articles = [
                a for a in merged.articles
                if not (
                    a.continues_on in failed_pages
                    or a.continued_from in failed_pages
                    or any(p in failed_pages for p in a.source_pages)
                )
            ]
            dropped = before - len(merged.articles)
            if dropped:
                warning(f"Dropped {dropped} articles linked to failed pages {sorted(failed_pages)}")

        if merged:
            md = edition_to_markdown(edition_date, merged)
            merged_dir = edition_ocr_output if edition_ocr_output else output_dir
            merged_path = os.path.join(merged_dir, "summary.md")
            with open(merged_path, "w", encoding="utf-8") as f:
                f.write(md)
            substep(f"{len(merged.articles)} articles -> {merged_path}")

            pub_info = ""
            for _, pc in page_results:
                if pc.publication_info:
                    pub_info = pc.publication_info
                    break

            align_existing_image_files(edition_output, merged)
            finalize_and_write_edition_json(
                edition_json_path,
                edition_date,
                pub_info,
                merged,
                merge_diag=report.merge_pass,
            )
            file_written("Edition JSON", edition_json_path)

    # ── Phase 4: Ad enrichment ────────────────────────────────────
    if os.path.isfile(edition_json_path):
        stage("Ad enrichment", 4, 6)
        substep(f"Enriching ads for {edition_date}...")
        try:
            performed, tokens, elapsed = enrich_edition(edition_json_path, client)
            if performed:
                substep(f"Ad enrichment: {tokens} tokens, {elapsed:.1f}s")
            else:
                substep("Ad enrichment: skipped (already enriched or no ads)")
        except Exception as exc:
            # Kept intentionally broad — narrowing it would start failing
            # editions that currently complete under transient Gemini hiccups.
            # We add a cause tag for Gemini 5xx / quota so operators can
            # distinguish "bad day" from "bad config" in logs without losing
            # the tolerant behavior. See docs/issues/0011.
            warning(
                f"Ad enrichment failed (non-fatal): {exc}"
                + (" [cause=gemini_5xx_or_quota]" if _is_gemini_transient(exc) else "")
            )

    # ── Phase 5: Content triage ────────────────────────────────────
    if os.path.isfile(edition_json_path):
        stage("Content triage", 5, 6)
        substep(f"Triaging content for {edition_date}...")
        try:
            performed, tokens, elapsed = triage_edition(edition_json_path, client)
            if performed:
                substep(f"Content triage: {tokens} tokens, {elapsed:.1f}s")
            else:
                substep("Content triage: skipped (already triaged or nothing to triage)")
        except Exception as exc:
            # See Phase 4 comment above — same reasoning, same tolerant policy.
            warning(
                f"Content triage failed (non-fatal): {exc}"
                + (" [cause=gemini_5xx_or_quota]" if _is_gemini_transient(exc) else "")
            )

    # ── Phase 6: Summary + diagnostics ────────────────────────────
    report.total_time_seconds = time.time() - pipeline_start
    report.finalize()

    _write_diagnostics_and_issues(report, edition_ocr_output, edition_output, snapshots_dir, edition_json_path)

    stage("Summary", 6, 6)
    print_summary_table(report)


def _write_diagnostics_and_issues(
    report: PipelineReport,
    edition_ocr_output: str | None,
    edition_output: str,
    snapshots_dir: str | None,
    edition_json_path: str,
) -> None:
    """Write issue reports and diagnostics JSON (shared by normal and abort paths)."""
    issue_root = report.run_root or (edition_ocr_output if edition_ocr_output else edition_output)
    issue_json_path, issue_md_path = write_issue_reports(issue_root, report, snapshots_dir, edition_json_path)
    report.issue_report_path = issue_json_path
    file_written("Issue report", issue_json_path)
    file_written("Issue report markdown", issue_md_path)

    diag_dir = edition_ocr_output if edition_ocr_output else edition_output
    diag_path = os.path.join(diag_dir, "diagnostics.json")
    write_diagnostics_json(diag_path, report)
    file_written("Diagnostics", diag_path)


__all__ = ["RunPaths", "process_edition"]
