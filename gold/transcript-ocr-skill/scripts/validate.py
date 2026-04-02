#!/usr/bin/env python3
"""
Validation script for transcript-ocr skill.

Handles Phase 6: validates edition.json against the schema contract.

Usage:
    python validate.py <path-to-edition.json>

Exit code 0 = all checks pass, 1 = failures found.
"""

import json
import os
import re
import sys
from pathlib import Path

VALID_ARTICLE_CATEGORIES = {
    "Campus News", "News", "Sports", "Arts & Entertainment", "Opinion"
}

VALID_AD_CATEGORIES = {
    "Food & Drink", "Entertainment", "Services", "Retail", "Greek Life",
    "Jobs", "Housing", "Education", "Events", "Other"
}

VALID_AD_TYPES = {"display", "classified"}

# Control characters to reject (keep \n = 0x0A, \t = 0x09)
CONTROL_CHAR_PATTERN = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def validate(edition_path: str) -> list[str]:
    """Validate edition.json and return list of error messages."""
    errors = []

    # Load JSON
    try:
        with open(edition_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, FileNotFoundError) as e:
        return [f"FATAL: Cannot read edition.json: {e}"]

    edition_dir = Path(edition_path).parent

    # Top-level fields
    edition_date = data.get("edition_date", "")
    publication_info = data.get("publication_info", "")
    articles = data.get("articles", [])
    ads = data.get("ads", [])
    enriched_ads = data.get("enriched_ads", [])
    other_content = data.get("other_content", [])

    # 1. edition_date is valid ISO date
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", edition_date):
        errors.append(f"edition_date '{edition_date}' is not valid YYYY-MM-DD format")

    # 2. publication_info is non-empty
    if not publication_info.strip():
        errors.append("publication_info is empty")

    # 3. At least 1 article
    if len(articles) < 1:
        errors.append("No articles found")

    # 4-7. Article validation
    for i, a in enumerate(articles):
        prefix = f"articles[{i}]"

        # Category
        cat = a.get("category", "")
        if cat not in VALID_ARTICLE_CATEGORIES:
            errors.append(f"{prefix}: invalid category '{cat}'")

        # Continuation fields
        for field in ("continues_on", "continued_from"):
            val = a.get(field, "")
            if val and val != "?" and not val.strip().isdigit():
                errors.append(f"{prefix}: {field}='{val}' must be empty, numeric, or '?'")

        # images/image_files alignment
        images = a.get("images", [])
        image_files = a.get("image_files", [])
        if len(images) != len(image_files):
            errors.append(
                f"{prefix}: images ({len(images)}) and image_files ({len(image_files)}) "
                f"length mismatch"
            )

        # Image files exist on disk
        for j, img_path in enumerate(image_files):
            full_path = edition_dir / img_path
            if not full_path.exists():
                errors.append(f"{prefix}: image_files[{j}] '{img_path}' not found on disk")

        # Control characters in text
        for field in ("headline", "body", "author", "writer_position"):
            text = a.get(field, "")
            if CONTROL_CHAR_PATTERN.search(text):
                chars = CONTROL_CHAR_PATTERN.findall(text)
                errors.append(
                    f"{prefix}: control characters in {field}: "
                    f"{[hex(ord(c)) for c in chars]}"
                )

    # 8. ads count == enriched_ads count
    if len(ads) != len(enriched_ads):
        errors.append(
            f"ads count ({len(ads)}) != enriched_ads count ({len(enriched_ads)})"
        )

    # 9. ads[i].business_name == enriched_ads[i].business_name
    for i in range(min(len(ads), len(enriched_ads))):
        ad_name = ads[i].get("business_name", "")
        ead_name = enriched_ads[i].get("business_name", "")
        if ad_name != ead_name:
            errors.append(
                f"ads[{i}].business_name '{ad_name}' != "
                f"enriched_ads[{i}].business_name '{ead_name}'"
            )

    # 10-11. Enriched ad validation
    for i, ead in enumerate(enriched_ads):
        prefix = f"enriched_ads[{i}]"

        cat = ead.get("category", "")
        if cat not in VALID_AD_CATEGORIES:
            errors.append(f"{prefix}: invalid category '{cat}'")

        ad_type = ead.get("ad_type", "")
        if ad_type not in VALID_AD_TYPES:
            errors.append(f"{prefix}: invalid ad_type '{ad_type}'")

        # Required string fields
        for field in ("business_name", "body", "category", "ad_type",
                       "display_text", "phone", "address", "price"):
            if field not in ead:
                errors.append(f"{prefix}: missing required field '{field}'")

        # image_files must be present (can be empty list)
        if "image_files" not in ead:
            errors.append(f"{prefix}: missing required field 'image_files'")

        # Control characters
        for field in ("business_name", "body", "display_text"):
            text = ead.get(field, "")
            if CONTROL_CHAR_PATTERN.search(text):
                chars = CONTROL_CHAR_PATTERN.findall(text)
                errors.append(
                    f"{prefix}: control characters in {field}: "
                    f"{[hex(ord(c)) for c in chars]}"
                )

    # 12. Ad validation (raw ads)
    for i, ad in enumerate(ads):
        prefix = f"ads[{i}]"
        for field in ("business_name", "body"):
            if field not in ad:
                errors.append(f"{prefix}: missing required field '{field}'")
            text = ad.get(field, "")
            if CONTROL_CHAR_PATTERN.search(text):
                chars = CONTROL_CHAR_PATTERN.findall(text)
                errors.append(f"{prefix}: control characters in {field}")

        # Ad image files exist
        for j, img_path in enumerate(ad.get("image_files", [])):
            full_path = edition_dir / img_path
            if not full_path.exists():
                errors.append(f"{prefix}: image_files[{j}] '{img_path}' not found on disk")

    # 13. OtherContent validation
    for i, oc in enumerate(other_content):
        prefix = f"other_content[{i}]"
        body = oc.get("body", "")
        if not body.strip():
            errors.append(f"{prefix}: body is empty")
        if CONTROL_CHAR_PATTERN.search(body):
            errors.append(f"{prefix}: control characters in body")

    return errors


def main():
    if len(sys.argv) != 2:
        print("Usage: python validate.py <path-to-edition.json>")
        sys.exit(1)

    edition_path = sys.argv[1]
    if not os.path.exists(edition_path):
        print(f"ERROR: File not found: {edition_path}")
        sys.exit(1)

    print(f"Validating: {edition_path}\n")

    errors = validate(edition_path)

    if not errors:
        # Load for summary stats
        with open(edition_path) as f:
            data = json.load(f)
        articles = data.get("articles", [])
        ads = data.get("ads", [])
        enriched_ads = data.get("enriched_ads", [])
        other_content = data.get("other_content", [])

        print("ALL CHECKS PASSED\n")
        print(f"  Articles: {len(articles)}")
        print(f"  Ads: {len(ads)}")
        print(f"  Enriched ads: {len(enriched_ads)}")
        print(f"  Other content: {len(other_content)}")

        # Category breakdown
        cats = {}
        for a in articles:
            c = a.get("category", "Unknown")
            cats[c] = cats.get(c, 0) + 1
        print(f"\n  Article categories:")
        for c, n in sorted(cats.items()):
            print(f"    {c}: {n}")

        # Image stats
        total_images = sum(len(a.get("image_files", [])) for a in articles)
        total_ad_images = sum(len(a.get("image_files", [])) for a in ads)
        print(f"\n  Article images: {total_images}")
        print(f"  Ad images: {total_ad_images}")

        sys.exit(0)
    else:
        print(f"VALIDATION FAILED: {len(errors)} error(s)\n")
        for err in errors:
            print(f"  ERROR: {err}")
        sys.exit(1)


if __name__ == "__main__":
    main()
