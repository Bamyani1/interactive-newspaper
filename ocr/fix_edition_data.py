"""
Post-processing script to fix known issues in existing edition.json files.

Fixes applied:
1. Page number corrections (misdetected by Gemini OCR)
2. Article body de-duplication (same-page merge produced duplicates)
3. Continuation marker remnant cleanup
4. Literal \\n escape sequence normalization
5. Category misclassification corrections
6. Ad de-duplication across pages

Usage:
    python fix_edition_data.py --date 1960-02-24
"""

import argparse
import json
import os
import re
import sys
import tempfile
from difflib import SequenceMatcher


EDITIONS_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "public", "editions"
)


def fix_page_numbers(edition: dict, date: str, edition_dir: str) -> int:
    """Fix page numbers by matching article headlines to per-page markdown files."""
    fixes = 0
    articles = edition["articles"]

    # Build headline → correct page mapping from markdown files
    headline_to_page: dict[str, str] = {}
    for entry in sorted(os.listdir(edition_dir)):
        if not entry.endswith(".md"):
            continue
        match = re.match(r'\d+_Page\s+(\d+)\.md', entry)
        if not match:
            continue
        page_num = match.group(1)
        md_path = os.path.join(edition_dir, entry)
        with open(md_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("## ") and not line.startswith("## Advertisements"):
                    headline = line[3:].strip()
                    headline_to_page[headline] = page_num

    # Fix each article's source_pages
    for i, article in enumerate(articles):
        headline = article["headline"]
        source_pages = article.get("source_pages", [])

        # Fix known misdetections
        new_pages = []
        for page in source_pages:
            if page in ("null", ""):
                # Look up correct page from markdown
                if headline in headline_to_page:
                    correct = headline_to_page[headline]
                    if correct not in new_pages:
                        new_pages.append(correct)
                        fixes += 1
                else:
                    new_pages.append(page)  # keep as-is if no match
            else:
                # Check if this page attribution is correct
                correct_page = headline_to_page.get(headline)
                if correct_page and correct_page != page and len(source_pages) == 1:
                    # Single-page article on wrong page
                    new_pages.append(correct_page)
                    fixes += 1
                else:
                    new_pages.append(page)

        # For multi-page articles, fix "null" references
        if len(new_pages) > 1:
            new_pages = [p for p in new_pages if p not in ("null", "")]
            if not new_pages:
                new_pages = source_pages  # fallback

        article["source_pages"] = new_pages

    return fixes


def deduplicate_bodies(edition: dict) -> int:
    """Remove duplicated text within article bodies."""
    fixes = 0
    for article in edition["articles"]:
        body = article["body"]
        if len(body) < 100:
            continue

        # Check if body is roughly duplicated (same text appears twice)
        half = len(body) // 2
        first_half = body[:half]
        second_half = body[half:]

        ratio = SequenceMatcher(None, first_half[:500], second_half[:500]).ratio()
        if ratio > 0.7:
            # Body is duplicated — try to find the split point
            # Look for a paragraph break near the middle
            mid = len(body) // 2
            search_range = min(200, mid // 2)
            best_split = mid

            for offset in range(search_range):
                for pos in [mid + offset, mid - offset]:
                    if 0 < pos < len(body) and body[pos:pos+2] == '\n\n':
                        best_split = pos
                        break
                else:
                    continue
                break

            # Take the longer half (more likely complete)
            part1 = body[:best_split].strip()
            part2 = body[best_split:].strip()
            article["body"] = part1 if len(part1) >= len(part2) else part2
            fixes += 1
            print(f"  De-duplicated: \"{article['headline'][:50]}\" ({len(body)} → {len(article['body'])})")

    return fixes


def clean_continuation_remnants(edition: dict) -> int:
    """Remove orphaned parentheticals from continuation marker stripping."""
    fixes = 0
    pattern = re.compile(r'\(\s*(?:Page)?\s*\)', re.IGNORECASE)
    for article in edition["articles"]:
        body = article["body"]
        new_body = pattern.sub('', body)
        new_body = re.sub(r' +', ' ', new_body).strip()
        if new_body != body:
            article["body"] = new_body
            fixes += 1
    return fixes


def fix_literal_newlines(edition: dict) -> int:
    """Replace literal \\n escape sequences with actual newlines."""
    fixes = 0
    for article in edition["articles"]:
        body = article["body"]
        if '\\n' in body:
            article["body"] = body.replace('\\n', '\n')
            fixes += 1
    return fixes


def fix_categories(edition: dict) -> int:
    """Fix known category misclassifications."""
    categories = edition.get("categories", [])
    if not categories:
        return 0

    # Map of article index → correct category
    corrections = {
        21: "Features",   # "THREE WHO PASSED IN THE NIGHT" — syndicated humor, not Opinion
        26: "Arts",       # "Stendhal's Novel..." — film review, not Opinion
        44: "News",       # "'Brown Jug' Founder Dies" — obituary, not Features
    }

    fixes = 0
    for idx, correct_cat in corrections.items():
        if idx < len(categories) and categories[idx] != correct_cat:
            old = categories[idx]
            categories[idx] = correct_cat
            headline = edition["articles"][idx]["headline"][:50]
            print(f"  Category fix [{idx}]: \"{headline}\" {old} → {correct_cat}")
            fixes += 1

    return fixes


def deduplicate_ads(edition: dict) -> int:
    """Remove duplicate ads by text similarity."""
    ads = edition.get("ads", [])
    if not ads:
        return 0

    to_remove = set()
    for i in range(len(ads)):
        if i in to_remove:
            continue
        name_i = ads[i].get("business_name", "").lower()
        for j in range(i + 1, len(ads)):
            if j in to_remove:
                continue
            name_j = ads[j].get("business_name", "").lower()
            name_ratio = SequenceMatcher(None, name_i, name_j).ratio()
            if name_ratio < 0.8:
                continue
            body_i = ads[i].get("body", "")[:300]
            body_j = ads[j].get("body", "")[:300]
            body_ratio = SequenceMatcher(None, body_i, body_j).ratio()
            if body_ratio > 0.6:
                # Keep longer, remove shorter
                if len(ads[j].get("body", "")) > len(ads[i].get("body", "")):
                    to_remove.add(i)
                else:
                    to_remove.add(j)

    if to_remove:
        edition["ads"] = [ad for idx, ad in enumerate(ads) if idx not in to_remove]
        # Also fix enriched_ads if present
        enriched = edition.get("enriched_ads", [])
        if enriched:
            if len(enriched) == len(ads):
                edition["enriched_ads"] = [ea for idx, ea in enumerate(enriched) if idx not in to_remove]
            else:
                print(f"  Warning: enriched_ads ({len(enriched)}) misaligned with ads ({len(ads)}), removing to force re-enrichment")
                del edition["enriched_ads"]

    return len(to_remove)


def fix_edition(date: str) -> None:
    """Apply all fixes to a single edition."""
    edition_dir = os.path.join(EDITIONS_DIR, date)
    edition_path = os.path.join(edition_dir, "edition.json")

    if not os.path.exists(edition_path):
        print(f"Edition not found: {edition_path}")
        sys.exit(1)

    try:
        with open(edition_path, "r", encoding="utf-8") as f:
            edition = json.load(f)
    except json.JSONDecodeError as e:
        print(f"ERROR: Malformed JSON in {edition_path}: {e}")
        sys.exit(1)

    print(f"Fixing edition {date}...")
    print(f"  Before: {len(edition['articles'])} articles, {len(edition.get('ads', []))} ads")

    # Apply fixes in order
    n = fix_literal_newlines(edition)
    print(f"  Fixed literal newlines: {n}")

    n = clean_continuation_remnants(edition)
    print(f"  Fixed continuation remnants: {n}")

    n = deduplicate_bodies(edition)
    print(f"  De-duplicated bodies: {n}")

    n = fix_page_numbers(edition, date, edition_dir)
    print(f"  Fixed page numbers: {n}")

    n = fix_categories(edition)
    print(f"  Fixed categories: {n}")

    n = deduplicate_ads(edition)
    print(f"  De-duplicated ads: {n}")

    print(f"  After: {len(edition['articles'])} articles, {len(edition.get('ads', []))} ads")

    # Atomic write
    tmp_fd, tmp_path = tempfile.mkstemp(dir=edition_dir, suffix=".json")
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
            json.dump(edition, f, indent=2)
        os.replace(tmp_path, edition_path)
    except BaseException:
        os.unlink(tmp_path)
        raise

    print(f"  Written to {edition_path}")


def main():
    parser = argparse.ArgumentParser(description="Fix known issues in edition.json files")
    parser.add_argument("--date", required=True, help="Edition date (e.g. 1960-02-24)")
    args = parser.parse_args()
    fix_edition(args.date)


if __name__ == "__main__":
    main()
