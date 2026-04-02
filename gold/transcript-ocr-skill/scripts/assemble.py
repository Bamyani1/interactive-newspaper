#!/usr/bin/env python3
"""
Assembly script for transcript-ocr skill.

Handles Phase 5: builds final edition.json from merged results and copies images.

Usage:
    python assemble.py <working-dir> --date YYYY-MM-DD --dest <output-dir>

Reads <working-dir>/merged_edition.json
Writes <output-dir>/edition.json + <output-dir>/images/
"""

import argparse
import json
import os
import shutil
import sys
from pathlib import Path


def assemble(working_dir: str, date: str, dest: str) -> bool:
    """Assemble final edition.json and copy images.

    Returns True on success, False on error.
    """
    working_path = Path(working_dir)
    dest_path = Path(dest)

    # Read merged edition
    merged_path = working_path / "merged_edition.json"
    if not merged_path.exists():
        print(f"ERROR: merged_edition.json not found at {merged_path}")
        return False

    with open(merged_path, "r", encoding="utf-8") as f:
        merged = json.load(f)

    # Extract components
    articles = merged.get("articles", [])
    ads = merged.get("ads", [])
    enriched_ads = merged.get("enriched_ads", [])
    other_content = merged.get("other_content", [])
    publication_info = merged.get("publication_info", "")

    # Build final JSON
    edition = {
        "edition_date": date,
        "publication_info": publication_info,
        "articles": articles,
        "ads": ads,
        "enriched_ads": enriched_ads,
        "other_content": other_content,
    }

    # Create destination directory
    dest_path.mkdir(parents=True, exist_ok=True)
    images_dest = dest_path / "images"
    images_dest.mkdir(exist_ok=True)

    # Collect all referenced image files
    all_image_refs = set()
    for a in articles:
        for img_path in a.get("image_files", []):
            all_image_refs.add(img_path)
    for ad in ads:
        for img_path in ad.get("image_files", []):
            all_image_refs.add(img_path)
    for ead in enriched_ads:
        for img_path in ead.get("image_files", []):
            all_image_refs.add(img_path)

    # Copy images from working dir to destination
    copied = 0
    missing = 0
    for img_ref in sorted(all_image_refs):
        src = working_path / img_ref
        dst = dest_path / img_ref

        if src.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(src), str(dst))
            copied += 1
        else:
            print(f"  WARNING: Referenced image not found: {src}")
            missing += 1

    # Write edition.json
    edition_json_path = dest_path / "edition.json"
    with open(edition_json_path, "w", encoding="utf-8") as f:
        json.dump(edition, f, indent=2, ensure_ascii=False)

    print(f"\n=== Assembly Complete ===")
    print(f"  Output: {edition_json_path}")
    print(f"  Articles: {len(articles)}")
    print(f"  Ads: {len(ads)}")
    print(f"  Enriched ads: {len(enriched_ads)}")
    print(f"  Other content: {len(other_content)}")
    print(f"  Images copied: {copied}")
    if missing:
        print(f"  Images missing: {missing}")

    return missing == 0


def main():
    parser = argparse.ArgumentParser(description="Assemble final edition.json")
    parser.add_argument("working_dir", help="Working directory with merged_edition.json")
    parser.add_argument("--date", required=True, help="Edition date (YYYY-MM-DD)")
    parser.add_argument("--dest", required=True, help="Destination directory for output")
    args = parser.parse_args()

    success = assemble(args.working_dir, args.date, args.dest)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
