"""Issue report generation utilities."""

from __future__ import annotations

import glob
import json
import os
import re

from ..contracts.diagnostics_models import PipelineReport


def _load_json(path: str) -> dict | list | None:
    """Load JSON helper used by diagnostics post-processing."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _build_issue_report(
    report: PipelineReport,
    snapshots_dir: str | None,
    edition_json_path: str,
) -> list[dict]:
    """Build a normalized issue list from diagnostics and saved snapshots."""
    issues: list[dict] = []
    next_id = 1

    def add_issue(*, failing_steps: list[str], observed: str, expected: str, root_cause_type: str, evidence_paths: list[str]) -> None:
        nonlocal next_id
        issues.append(
            {
                "id": f"ISSUE-{next_id:03d}",
                "failing_steps": failing_steps,
                "observed": observed,
                "expected": expected,
                "root_cause_type": root_cause_type,
                "evidence_paths": evidence_paths,
            }
        )
        next_id += 1

    for pd in report.page_diagnostics:
        if pd.error:
            add_issue(
                failing_steps=["process_image"],
                observed=f"{pd.filename} failed: {pd.error}",
                expected="Page should process without stage failure.",
                root_cause_type="bug",
                evidence_paths=[pd.filename],
            )

    if snapshots_dir and os.path.isdir(snapshots_dir):
        category_loss_pages: list[str] = []
        continuation_loss_pages: list[str] = []
        raw_paths = sorted(glob.glob(os.path.join(snapshots_dir, "raw_gemini_page*.json")))
        for raw_path in raw_paths:
            page_match = re.search(r"page(\d+)\.json$", os.path.basename(raw_path))
            if not page_match:
                continue
            page = page_match.group(1)
            post_path = os.path.join(snapshots_dir, f"post_process_page{page}.json")
            raw = _load_json(raw_path)
            post = _load_json(post_path)
            if not isinstance(raw, dict) or not isinstance(post, dict):
                continue

            raw_articles = raw.get("articles", []) or []
            post_articles = post.get("articles", []) or []
            raw_categories = sorted(
                {
                    (a.get("category") or "").strip()
                    for a in raw_articles
                    if isinstance(a, dict) and (a.get("category") or "").strip()
                }
            )
            post_categories = sorted(
                {
                    (a.get("category") or "").strip()
                    for a in post_articles
                    if isinstance(a, dict) and (a.get("category") or "").strip()
                }
            )
            if len(raw_categories) > 1 and post_categories == ["Campus News"]:
                category_loss_pages.append(page)

            raw_cont = sum(
                1
                for a in raw_articles
                if isinstance(a, dict) and ((a.get("continues_on") or "").strip() or (a.get("continued_from") or "").strip())
            )
            post_cont = sum(
                1
                for a in post_articles
                if isinstance(a, dict) and ((a.get("continues_on") or "").strip() or (a.get("continued_from") or "").strip())
            )
            if raw_cont > post_cont:
                continuation_loss_pages.append(page)

        if category_loss_pages:
            add_issue(
                failing_steps=["postprocess_page_content"],
                observed=f"Category diversity collapsed to Campus News on page(s): {', '.join(category_loss_pages)}.",
                expected="Post-process should preserve OCR-extracted categories unless explicit correction is applied.",
                root_cause_type="logic_issue",
                evidence_paths=[os.path.join(snapshots_dir, f"raw_gemini_page{p}.json") for p in category_loss_pages]
                + [os.path.join(snapshots_dir, f"post_process_page{p}.json") for p in category_loss_pages],
            )

        if continuation_loss_pages:
            add_issue(
                failing_steps=["deduplicate_articles", "postprocess_page_content"],
                observed=f"Continuation markers were reduced after post-process on page(s): {', '.join(continuation_loss_pages)}.",
                expected="Continuation metadata should be preserved through post-processing for merge accuracy.",
                root_cause_type="logic_issue",
                evidence_paths=[os.path.join(snapshots_dir, f"raw_gemini_page{p}.json") for p in continuation_loss_pages]
                + [os.path.join(snapshots_dir, f"post_process_page{p}.json") for p in continuation_loss_pages],
            )

    edition_obj = _load_json(edition_json_path)
    if isinstance(edition_obj, dict):
        articles = edition_obj.get("articles", []) or []
        empty_indices = []
        mismatch_indices = []
        for i, article in enumerate(articles):
            if not isinstance(article, dict):
                continue
            headline = (article.get("headline") or "").strip()
            body = (article.get("body") or "").strip()
            image_files = [f for f in (article.get("image_files") or []) if isinstance(f, str) and f.strip()]
            images = article.get("images") or []
            if not headline and not body and not image_files:
                empty_indices.append(i)
            if len(images) != len(article.get("image_files") or []):
                mismatch_indices.append(i)

        if empty_indices:
            add_issue(
                failing_steps=["merge_edition_articles", "finalize_output"],
                observed=f"Found {len(empty_indices)} empty article(s) in final edition output: indices {empty_indices}.",
                expected="Final edition should not include articles with empty headline/body/image_files.",
                root_cause_type="logic_issue",
                evidence_paths=[edition_json_path],
            )
        if mismatch_indices:
            add_issue(
                failing_steps=["merge_edition_articles"],
                observed=f"Found {len(mismatch_indices)} article(s) with images/image_files length mismatch: indices {mismatch_indices}.",
                expected="Each extracted image file should have aligned metadata; no mismatched cardinality.",
                root_cause_type="logic_issue",
                evidence_paths=[edition_json_path],
            )

    if report.merge_pass and report.merge_pass.error:
        add_issue(
            failing_steps=["merge_edition_articles"],
            observed=f"Merge pass failed: {report.merge_pass.error}",
            expected="Cross-page merge pass should complete without runtime error.",
            root_cause_type="bug",
            evidence_paths=[],
        )

    return issues


def _write_issue_report_files(run_root: str, issues: list[dict]) -> tuple[str, str]:
    """Write issue_report.json and issue_report.md in run root."""
    os.makedirs(run_root, exist_ok=True)
    json_path = os.path.join(run_root, "issue_report.json")
    md_path = os.path.join(run_root, "issue_report.md")

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({"issues": issues}, f, indent=2)

    lines = ["# OCR Issue Report", ""]
    if not issues:
        lines.append("No issues detected by automatic checks.")
    else:
        for issue in issues:
            lines.append(f"## {issue['id']}")
            lines.append(f"- Failing step(s): {', '.join(issue['failing_steps'])}")
            lines.append(f"- Observed: {issue['observed']}")
            lines.append(f"- Expected: {issue['expected']}")
            lines.append(f"- Root cause type: {issue['root_cause_type']}")
            if issue["evidence_paths"]:
                lines.append("- Evidence:")
                for path in issue["evidence_paths"]:
                    lines.append(f"  - {path}")
            else:
                lines.append("- Evidence: (none recorded)")
            lines.append("")

    with open(md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines).rstrip() + "\n")

    return json_path, md_path


build_issue_report = _build_issue_report
write_issue_report_files = _write_issue_report_files
load_json = _load_json

__all__ = [
    "_build_issue_report",
    "_load_json",
    "_write_issue_report_files",
    "build_issue_report",
    "load_json",
    "write_issue_report_files",
]
