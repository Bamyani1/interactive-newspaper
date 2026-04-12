#!/usr/bin/env python3
"""Repair orphan continuation stubs in existing edition.json files.

For each affected edition, sends the unmerged source/stub articles to Gemini
to decide which pairs to merge, then applies the merges directly.

Usage:
    python3 scripts/repair-orphan-stubs.py --dry-run     # Preview changes
    python3 scripts/repair-orphan-stubs.py               # Apply changes
    python3 scripts/repair-orphan-stubs.py --date 2006-04-20  # Single edition
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from difflib import SequenceMatcher as SM
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OCR_SRC = ROOT / "ocr" / "src"
sys.path.insert(0, str(OCR_SRC))

from dotenv import load_dotenv
load_dotenv(ROOT / ".env.local")

from google import genai
from google.genai import types
from transcript_ocr.merging.continuation import _strip_continuation_markers

EDITIONS_DIR = ROOT / "public" / "editions"

SAFETY_OFF = [
    types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_CIVIC_INTEGRITY", threshold="OFF"),
]

REPAIR_PROMPT = """You are merging newspaper article continuations that were missed during OCR processing.

Below are articles from edition {date}. Some are SOURCES (articles that continue on another page) and some are STUBS (the continuation text on the target page, often with a different headline).

Your job: identify which source and stub pairs are actually the same article split across pages. Evidence to look for:
- Body text flows naturally from source tail to stub head (e.g., source ends "the sys-" and stub starts "tem and")
- Continuation markers like "(from opposite page)" or "(continued from page X)"
- Related topic and context

For each valid pair, return a JSON array of merge instructions:
```json
[
  {{
    "source_idx": <source article index>,
    "stub_idx": <stub article index>,
    "merged_headline": "<best headline for the combined article>",
    "confidence": <0.0 to 1.0>
  }}
]
```

Rules:
- Only merge when body text genuinely continues (not just same topic)
- Each article can appear in at most one pair
- Confidence: 1.0 = clear continuation, 0.7 = likely, 0.5 = uncertain
- Skip pairs with confidence < 0.5
- Return empty array [] if no valid pairs found

ARTICLES:
{articles}
"""


def find_orphan_stubs(articles):
    """Find stubs with continued_from that are on a single page (unmerged)."""
    stubs = []
    for i, a in enumerate(articles):
        cont_from = a.get("continued_from", "")
        pages = a.get("source_pages", [])
        if cont_from and cont_from not in ("?", "") and len(pages) == 1:
            stubs.append(i)
    return stubs


def find_candidate_sources(articles, from_page):
    """Find articles on from_page that might be the source of a continuation."""
    candidates = []
    for i, a in enumerate(articles):
        pages = a.get("source_pages", [])
        if len(pages) != 1 or pages[0] != from_page:
            continue
        # Has explicit continues_on marker
        if a.get("continues_on", ""):
            candidates.append(i)
            continue
        # Dangling tail (body doesn't end with punctuation)
        body = (a.get("body", "") or "").rstrip()
        if body and body[-1] not in '.!?"\'\u201d\u2019':
            candidates.append(i)
    return candidates


def build_repair_prompt(date, articles, stub_indices, source_indices):
    """Build the Gemini prompt for merge decisions."""
    all_indices = sorted(set(stub_indices) | set(source_indices))
    parts = []
    for idx in all_indices:
        a = articles[idx]
        role = "STUB" if idx in stub_indices else "SOURCE"
        body = a.get("body", "") or ""
        pages = a.get("source_pages", [])
        cont_on = a.get("continues_on", "")
        cont_from = a.get("continued_from", "")

        parts.append(f"[{idx}] ({role}) Page {pages[0] if pages else '?'}")
        parts.append(f"  Headline: {a.get('headline', '')}")
        if cont_on:
            parts.append(f"  Continues on: page {cont_on}")
        if cont_from:
            parts.append(f"  Continued from: page {cont_from}")
        # Show tail for sources, head for stubs
        if role == "SOURCE":
            parts.append(f"  Body tail (last 400 chars): ...{body[-400:]}")
        else:
            parts.append(f"  Body head (first 400 chars): {body[:400]}...")
        parts.append("")

    return REPAIR_PROMPT.format(date=date, articles="\n".join(parts))


def apply_merge(articles, source_idx, stub_idx, merged_headline):
    """Merge stub into source article."""
    source = articles[source_idx]
    stub = articles[stub_idx]

    # Strip continuation markers from both bodies
    source_body = _strip_continuation_markers(source.get("body", "") or "")
    stub_body = _strip_continuation_markers(stub.get("body", "") or "")

    # Concatenate bodies
    merged_body = source_body.rstrip() + "\n\n" + stub_body.lstrip()

    # Update source article
    source["headline"] = merged_headline
    source["body"] = merged_body.strip()

    # Combine source_pages
    src_pages = list(source.get("source_pages", []))
    for p in stub.get("source_pages", []):
        if p not in src_pages:
            src_pages.append(p)
    source["source_pages"] = src_pages

    # Combine images
    src_images = list(source.get("images", []))
    src_images.extend(stub.get("images", []))
    source["images"] = src_images

    src_files = list(source.get("image_files", []))
    src_files.extend(stub.get("image_files", []))
    source["image_files"] = src_files

    # Clear continuation markers on merged article
    source["continues_on"] = ""
    source["continued_from"] = stub.get("continued_from", "")
    if not any(a.get("continued_from", "") == source.get("source_pages", [""])[0]
               for i, a in enumerate(articles) if i != stub_idx and i != source_idx):
        source["continued_from"] = ""

    return source


def repair_edition(date, client, dry_run=False):
    """Repair orphan stubs in a single edition."""
    path = EDITIONS_DIR / date / "edition.json"
    if not path.exists():
        return None

    with open(path) as f:
        data = json.load(f)

    articles = data.get("articles", [])
    stubs = find_orphan_stubs(articles)
    if not stubs:
        return None

    # Find candidate sources for each stub
    all_sources = set()
    for stub_idx in stubs:
        from_page = articles[stub_idx]["continued_from"]
        sources = find_candidate_sources(articles, from_page)
        all_sources.update(sources)

    if not all_sources:
        return {"date": date, "stubs": len(stubs), "merged": 0, "reason": "no sources found"}

    # Ask Gemini to decide pairings
    prompt = build_repair_prompt(date, articles, set(stubs), all_sources)

    try:
        response = client.models.generate_content(
            model="gemini-3-flash-preview",
            contents=[prompt],
            config=types.GenerateContentConfig(
                safety_settings=SAFETY_OFF,
                response_mime_type="application/json",
                max_output_tokens=8192,
            ),
        )
        raw = (response.text or "").strip()
        decisions = json.loads(raw)
    except Exception as e:
        return {"date": date, "stubs": len(stubs), "merged": 0, "reason": f"Gemini error: {e}"}

    if not decisions:
        return {"date": date, "stubs": len(stubs), "merged": 0, "reason": "no pairs found by LLM"}

    # Apply merges (process in reverse order to preserve indices)
    merged_count = 0
    removed_indices = []
    merge_log = []

    for decision in decisions:
        src_idx = decision.get("source_idx")
        stub_idx = decision.get("stub_idx")
        headline = decision.get("merged_headline", "")
        confidence = decision.get("confidence", 0)

        if confidence < 0.5:
            merge_log.append(f"  SKIP [{src_idx}]↔[{stub_idx}] conf={confidence:.2f}")
            continue
        if src_idx is None or stub_idx is None:
            continue
        if not (0 <= src_idx < len(articles) and 0 <= stub_idx < len(articles)):
            merge_log.append(f"  SKIP [{src_idx}]↔[{stub_idx}] out of range")
            continue
        if stub_idx in removed_indices or src_idx in removed_indices:
            merge_log.append(f"  SKIP [{src_idx}]↔[{stub_idx}] already used")
            continue

        src_headline = articles[src_idx].get("headline", "")
        stub_headline = articles[stub_idx].get("headline", "")
        merge_log.append(
            f"  MERGE [{src_idx}] \"{src_headline}\" + [{stub_idx}] \"{stub_headline}\" "
            f"→ \"{headline}\" (conf={confidence:.2f})"
        )

        if not dry_run:
            apply_merge(articles, src_idx, stub_idx, headline)
            removed_indices.append(stub_idx)
            merged_count += 1

    # Remove merged stubs (reverse order to preserve indices)
    if not dry_run and removed_indices:
        for idx in sorted(removed_indices, reverse=True):
            articles.pop(idx)
        data["articles"] = articles
        with open(path, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    return {
        "date": date,
        "stubs": len(stubs),
        "merged": merged_count if not dry_run else len([l for l in merge_log if "MERGE" in l]),
        "log": merge_log,
        "dry_run": dry_run,
    }


def main():
    parser = argparse.ArgumentParser(description="Repair orphan continuation stubs")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without applying")
    parser.add_argument("--date", help="Repair a single edition")
    args = parser.parse_args()

    client = genai.Client()

    # Find affected editions
    if args.date:
        dates = [args.date]
    else:
        dates = []
        for ed_dir in sorted(EDITIONS_DIR.iterdir()):
            if not ed_dir.is_dir():
                continue
            path = ed_dir / "edition.json"
            if not path.exists():
                continue
            with open(path) as f:
                data = json.load(f)
            stubs = find_orphan_stubs(data.get("articles", []))
            if stubs:
                dates.append(ed_dir.name)

    print(f"{'DRY RUN — ' if args.dry_run else ''}Repairing {len(dates)} editions\n")

    total_merged = 0
    results = []

    for date in dates:
        print(f"{'─' * 60}")
        print(f"Edition: {date}")
        result = repair_edition(date, client, dry_run=args.dry_run)
        if result is None:
            print("  No stubs found")
            continue
        results.append(result)
        total_merged += result["merged"]
        print(f"  Stubs: {result['stubs']}, Merged: {result['merged']}")
        if result.get("reason"):
            print(f"  Reason: {result['reason']}")
        for line in result.get("log", []):
            print(line)
        print()

    print(f"{'=' * 60}")
    print(f"TOTAL: {total_merged} merges across {len(results)} editions")
    if args.dry_run:
        print("\nThis was a dry run. Run without --dry-run to apply changes.")
    else:
        affected = [r["date"] for r in results if r["merged"] > 0]
        if affected:
            print(f"\nRe-seed affected editions:")
            print(f"  npm run db:seed -- --date {','.join(affected)}")


if __name__ == "__main__":
    main()
