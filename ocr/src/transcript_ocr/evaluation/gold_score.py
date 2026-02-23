#!/usr/bin/env python3
"""Score OCR output against page-level gold transcripts."""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
from dataclasses import dataclass


WORD_RE = re.compile(r"[A-Za-z0-9']+")


def _tokenize(text: str) -> list[str]:
    return [m.group(0).lower() for m in WORD_RE.finditer(text)]


def _markdown_to_text(md: str) -> str:
    # Remove images and markdown headings/quote prefixes for scoring text.
    md = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", md)
    md = re.sub(r"^#{1,6}\s*", "", md, flags=re.MULTILINE)
    md = re.sub(r"^>\s*", "", md, flags=re.MULTILINE)
    md = re.sub(r"[*_`]+", "", md)
    return md


@dataclass
class Alignment:
    substitutions: int
    deletions: int
    insertions: int


def _align(gold: list[str], pred: list[str]) -> Alignment:
    m, n = len(gold), len(pred)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    bt = [[""] * (n + 1) for _ in range(m + 1)]

    for i in range(1, m + 1):
        dp[i][0] = i
        bt[i][0] = "D"
    for j in range(1, n + 1):
        dp[0][j] = j
        bt[0][j] = "I"

    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if gold[i - 1] == pred[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
                bt[i][j] = "M"
            else:
                subs = dp[i - 1][j - 1] + 1
                delete = dp[i - 1][j] + 1
                insert = dp[i][j - 1] + 1
                best = min(subs, delete, insert)
                dp[i][j] = best
                bt[i][j] = "S" if best == subs else ("D" if best == delete else "I")

    i, j = m, n
    s = d = ins = 0
    while i > 0 or j > 0:
        op = bt[i][j]
        if op in ("M", "S"):
            if op == "S":
                s += 1
            i -= 1
            j -= 1
        elif op == "D":
            d += 1
            i -= 1
        else:
            ins += 1
            j -= 1

    return Alignment(substitutions=s, deletions=d, insertions=ins)


def _candidate_markdown_for_page(run_dir: str, page: int) -> str:
    pattern = os.path.join(run_dir, f"*_Page {page}.md")
    matches = sorted(glob.glob(pattern))
    if not matches:
        return ""
    return matches[0]


def main() -> None:
    parser = argparse.ArgumentParser(description="Score OCR output against gold page transcripts")
    parser.add_argument("--gold-dir", required=True, help="Directory containing page*.reference.txt files")
    parser.add_argument("--run-dir", required=True, help="OCR run directory (contains per-page markdown files)")
    parser.add_argument("--output-json", default="", help="Optional output JSON path")
    parser.add_argument("--output-md", default="", help="Optional output markdown path")
    args = parser.parse_args()

    gold_files = sorted(glob.glob(os.path.join(args.gold_dir, "page*.reference.txt")))
    if not gold_files:
        raise SystemExit(f"No gold reference files found in {args.gold_dir}")

    page_results = []
    total_gold = 0
    total_s = total_d = total_i = 0

    for gold_path in gold_files:
        m = re.search(r"page(\d+)\.reference\.txt$", os.path.basename(gold_path))
        if not m:
            continue
        page = int(m.group(1))
        with open(gold_path, "r", encoding="utf-8") as f:
            gold_raw = f.read().strip()

        if not gold_raw or "TODO" in gold_raw.upper():
            page_results.append({
                "page": page,
                "status": "skipped",
                "reason": "gold reference missing or placeholder",
                "gold_path": gold_path,
            })
            continue

        candidate_path = _candidate_markdown_for_page(args.run_dir, page)
        if not candidate_path:
            page_results.append({
                "page": page,
                "status": "missing_candidate",
                "gold_path": gold_path,
            })
            continue

        with open(candidate_path, "r", encoding="utf-8") as f:
            candidate_md = f.read()

        gold_tokens = _tokenize(gold_raw)
        pred_tokens = _tokenize(_markdown_to_text(candidate_md))
        alignment = _align(gold_tokens, pred_tokens)

        n = max(1, len(gold_tokens))
        wer = (alignment.substitutions + alignment.deletions + alignment.insertions) / n
        missing_rate = alignment.deletions / n
        extra_rate = alignment.insertions / n

        page_results.append({
            "page": page,
            "status": "scored",
            "gold_path": gold_path,
            "candidate_path": candidate_path,
            "gold_words": len(gold_tokens),
            "pred_words": len(pred_tokens),
            "substitutions": alignment.substitutions,
            "deletions": alignment.deletions,
            "insertions": alignment.insertions,
            "wer": round(wer, 6),
            "missing_word_rate": round(missing_rate, 6),
            "extra_word_rate": round(extra_rate, 6),
        })

        total_gold += len(gold_tokens)
        total_s += alignment.substitutions
        total_d += alignment.deletions
        total_i += alignment.insertions

    scored_pages = [p for p in page_results if p.get("status") == "scored"]
    n = max(1, total_gold)
    aggregate = {
        "scored_pages": len(scored_pages),
        "total_gold_words": total_gold,
        "substitutions": total_s,
        "deletions": total_d,
        "insertions": total_i,
        "wer": round((total_s + total_d + total_i) / n, 6),
        "missing_word_rate": round(total_d / n, 6),
        "extra_word_rate": round(total_i / n, 6),
    }

    report = {
        "gold_dir": os.path.abspath(args.gold_dir),
        "run_dir": os.path.abspath(args.run_dir),
        "aggregate": aggregate,
        "pages": page_results,
    }

    output_json = args.output_json or os.path.join(args.run_dir, "gold_score.json")
    output_md = args.output_md or os.path.join(args.run_dir, "gold_score.md")
    os.makedirs(os.path.dirname(output_json), exist_ok=True)

    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    lines = [
        "# Gold Scoring Report",
        "",
        f"- Run dir: `{report['run_dir']}`",
        f"- Gold dir: `{report['gold_dir']}`",
        f"- Scored pages: {aggregate['scored_pages']}",
        f"- WER: {aggregate['wer']:.6f}",
        f"- Missing-word rate: {aggregate['missing_word_rate']:.6f}",
        f"- Extra-word rate: {aggregate['extra_word_rate']:.6f}",
        "",
        "## Per Page",
        "",
    ]
    for page in page_results:
        lines.append(f"- Page {page.get('page')}: {page.get('status')}")
        if page.get("status") == "scored":
            lines.append(
                f"  WER={page['wer']:.6f}, missing={page['missing_word_rate']:.6f}, extra={page['extra_word_rate']:.6f}"
            )
    with open(output_md, "w", encoding="utf-8") as f:
        f.write("\n".join(lines).rstrip() + "\n")

    print(f"Gold score JSON written to {output_json}")
    print(f"Gold score markdown written to {output_md}")


if __name__ == "__main__":
    main()
