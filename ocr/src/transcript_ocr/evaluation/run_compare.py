#!/usr/bin/env python3
"""Compare two OCR pipeline runs and emit structural/quality deltas."""

from __future__ import annotations

import argparse
import glob
import json
import os
from collections import Counter
from dataclasses import dataclass
from typing import Any


def _load_json(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _safe_load_json(path: str) -> Any | None:
    try:
        return _load_json(path)
    except Exception:
        return None


def _edition_path_from_manifest(run_dir: str) -> str:
    manifest_path = os.path.join(run_dir, "run_manifest.json")
    manifest = _safe_load_json(manifest_path)
    if isinstance(manifest, dict):
        out_dir = manifest.get("output_edition_dir", "")
        if out_dir:
            return os.path.join(out_dir, "edition.json")
    return ""


def _metrics_from_edition(edition: dict) -> dict:
    articles = edition.get("articles", []) or []
    ads = edition.get("ads", []) or []
    other = edition.get("other_content", []) or []

    category_counter = Counter(
        (a.get("category") or "").strip() or "<missing>"
        for a in articles
        if isinstance(a, dict)
    )

    continuation_nonempty = sum(
        1
        for a in articles
        if isinstance(a, dict)
        and (((a.get("continues_on") or "").strip()) or ((a.get("continued_from") or "").strip()))
    )

    image_mismatches = []
    empty_articles = []
    for i, a in enumerate(articles):
        if not isinstance(a, dict):
            continue
        images = a.get("images", []) or []
        files = a.get("image_files", []) or []
        if len(images) != len(files):
            image_mismatches.append(i)
        has_headline = bool((a.get("headline") or "").strip())
        has_body = bool((a.get("body") or "").strip())
        has_file = any((f or "").strip() for f in files)
        if not has_headline and not has_body and not has_file:
            empty_articles.append(i)

    return {
        "article_count": len(articles),
        "ad_count": len(ads),
        "other_content_count": len(other),
        "category_distribution": dict(sorted(category_counter.items())),
        "continuation_nonempty": continuation_nonempty,
        "image_alignment_mismatches": image_mismatches,
        "empty_articles": empty_articles,
    }


def _snapshot_signals(run_dir: str) -> dict:
    snapshots_dir = os.path.join(run_dir, "snapshots")
    if not os.path.isdir(snapshots_dir):
        return {
            "pages_with_category_collapse": [],
            "pages_with_continuation_loss": [],
        }

    category_collapse = []
    continuation_loss = []
    for raw_path in sorted(glob.glob(os.path.join(snapshots_dir, "raw_gemini_page*.json"))):
        m = os.path.basename(raw_path)
        page = m.replace("raw_gemini_page", "").replace(".json", "")
        post_path = os.path.join(snapshots_dir, f"post_process_page{page}.json")
        raw = _safe_load_json(raw_path)
        post = _safe_load_json(post_path)
        if not isinstance(raw, dict) or not isinstance(post, dict):
            continue

        raw_articles = raw.get("articles", []) or []
        post_articles = post.get("articles", []) or []

        raw_categories = {
            (a.get("category") or "").strip()
            for a in raw_articles
            if isinstance(a, dict) and (a.get("category") or "").strip()
        }
        post_categories = {
            (a.get("category") or "").strip()
            for a in post_articles
            if isinstance(a, dict) and (a.get("category") or "").strip()
        }
        if len(raw_categories) > 1 and post_categories == {"Campus News"}:
            category_collapse.append(page)

        raw_cont = sum(
            1
            for a in raw_articles
            if isinstance(a, dict)
            and (((a.get("continues_on") or "").strip()) or ((a.get("continued_from") or "").strip()))
        )
        post_cont = sum(
            1
            for a in post_articles
            if isinstance(a, dict)
            and (((a.get("continues_on") or "").strip()) or ((a.get("continued_from") or "").strip()))
        )
        if raw_cont > post_cont:
            continuation_loss.append(page)

    return {
        "pages_with_category_collapse": category_collapse,
        "pages_with_continuation_loss": continuation_loss,
    }


def _page_counts(diag: dict) -> list[dict]:
    rows = []
    for pd in diag.get("page_diagnostics", []) or []:
        rows.append({
            "filename": pd.get("filename", ""),
            "page_number": pd.get("page_number", ""),
            "final_article_count": pd.get("final_article_count", 0),
            "final_ad_count": pd.get("final_ad_count", 0),
            "final_other_content_count": pd.get("final_other_content_count", 0),
            "error": pd.get("error", ""),
        })
    return rows


def _compare_numeric(before: int, after: int) -> dict:
    return {"baseline": before, "candidate": after, "delta": after - before}


def _build_report(baseline_run: str, candidate_run: str) -> dict:
    baseline_diag = _load_json(os.path.join(baseline_run, "diagnostics.json"))
    candidate_diag = _load_json(os.path.join(candidate_run, "diagnostics.json"))

    baseline_edition_path = _edition_path_from_manifest(baseline_run)
    candidate_edition_path = _edition_path_from_manifest(candidate_run)
    baseline_edition = _safe_load_json(baseline_edition_path) if baseline_edition_path else None
    candidate_edition = _safe_load_json(candidate_edition_path) if candidate_edition_path else None

    baseline_metrics = _metrics_from_edition(baseline_edition or {})
    candidate_metrics = _metrics_from_edition(candidate_edition or {})

    baseline_snapshot = _snapshot_signals(baseline_run)
    candidate_snapshot = _snapshot_signals(candidate_run)

    return {
        "baseline_run": os.path.abspath(baseline_run),
        "candidate_run": os.path.abspath(candidate_run),
        "baseline_edition_path": baseline_edition_path,
        "candidate_edition_path": candidate_edition_path,
        "comparisons": {
            "article_count": _compare_numeric(baseline_metrics["article_count"], candidate_metrics["article_count"]),
            "ad_count": _compare_numeric(baseline_metrics["ad_count"], candidate_metrics["ad_count"]),
            "other_content_count": _compare_numeric(baseline_metrics["other_content_count"], candidate_metrics["other_content_count"]),
            "continuation_nonempty": _compare_numeric(baseline_metrics["continuation_nonempty"], candidate_metrics["continuation_nonempty"]),
            "empty_article_count": _compare_numeric(len(baseline_metrics["empty_articles"]), len(candidate_metrics["empty_articles"])),
            "image_alignment_mismatch_count": _compare_numeric(len(baseline_metrics["image_alignment_mismatches"]), len(candidate_metrics["image_alignment_mismatches"])),
        },
        "category_distribution": {
            "baseline": baseline_metrics["category_distribution"],
            "candidate": candidate_metrics["category_distribution"],
        },
        "page_level": {
            "baseline": _page_counts(baseline_diag),
            "candidate": _page_counts(candidate_diag),
        },
        "snapshot_signals": {
            "baseline": baseline_snapshot,
            "candidate": candidate_snapshot,
        },
        "raw": {
            "baseline_metrics": baseline_metrics,
            "candidate_metrics": candidate_metrics,
        },
    }


def _write_markdown(path: str, report: dict) -> None:
    c = report["comparisons"]
    lines = [
        "# OCR Run Comparison",
        "",
        f"- Baseline run: `{report['baseline_run']}`",
        f"- Candidate run: `{report['candidate_run']}`",
        "",
        "## Structural Metrics",
        "",
        f"- Articles: {c['article_count']['baseline']} -> {c['article_count']['candidate']} (delta {c['article_count']['delta']:+d})",
        f"- Ads: {c['ad_count']['baseline']} -> {c['ad_count']['candidate']} (delta {c['ad_count']['delta']:+d})",
        f"- Other content: {c['other_content_count']['baseline']} -> {c['other_content_count']['candidate']} (delta {c['other_content_count']['delta']:+d})",
        f"- Non-empty continuation fields: {c['continuation_nonempty']['baseline']} -> {c['continuation_nonempty']['candidate']} (delta {c['continuation_nonempty']['delta']:+d})",
        f"- Empty articles: {c['empty_article_count']['baseline']} -> {c['empty_article_count']['candidate']} (delta {c['empty_article_count']['delta']:+d})",
        f"- Image alignment mismatches: {c['image_alignment_mismatch_count']['baseline']} -> {c['image_alignment_mismatch_count']['candidate']} (delta {c['image_alignment_mismatch_count']['delta']:+d})",
        "",
        "## Category Distribution",
        "",
        f"- Baseline: {report['category_distribution']['baseline']}",
        f"- Candidate: {report['category_distribution']['candidate']}",
        "",
        "## Snapshot Signals",
        "",
        f"- Baseline category-collapse pages: {report['snapshot_signals']['baseline']['pages_with_category_collapse']}",
        f"- Candidate category-collapse pages: {report['snapshot_signals']['candidate']['pages_with_category_collapse']}",
        f"- Baseline continuation-loss pages: {report['snapshot_signals']['baseline']['pages_with_continuation_loss']}",
        f"- Candidate continuation-loss pages: {report['snapshot_signals']['candidate']['pages_with_continuation_loss']}",
        "",
    ]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines).rstrip() + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare OCR baseline and candidate runs")
    parser.add_argument("--baseline-run", required=True, help="Path to baseline run directory")
    parser.add_argument("--candidate-run", required=True, help="Path to candidate run directory")
    parser.add_argument("--output-json", default="", help="Optional output JSON path")
    parser.add_argument("--output-md", default="", help="Optional output markdown path")
    args = parser.parse_args()

    report = _build_report(args.baseline_run, args.candidate_run)

    output_json = args.output_json or os.path.join(args.candidate_run, "comparison_report.json")
    output_md = args.output_md or os.path.join(args.candidate_run, "comparison_report.md")

    os.makedirs(os.path.dirname(output_json), exist_ok=True)
    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    _write_markdown(output_md, report)

    print(f"Comparison JSON written to {output_json}")
    print(f"Comparison markdown written to {output_md}")


if __name__ == "__main__":
    main()
