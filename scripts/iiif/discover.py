#!/usr/bin/env python3
"""Discover available editions per decade from the CONTENTdm collection.

Scans public/editions/ (processed) and ocr/inbox/ (pending) to find
already-known editions, then queries the ContentDM API
for new ones. Outputs selected manifest URLs to manifests/new_manifests.txt.

Usage:
    python scripts/iiif/discover.py
"""

import os
import re
import requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))

BASE_URL = "https://cdm15963.contentdm.oclc.org"
COLLECTION = "p15963coll9"
DECADES = [1950, 1960, 1970, 1980, 1990, 2000]
TARGET_PER_DECADE = 20

DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")

# ── Collect already-known edition dates ──────────────────────

EXISTING_DATES = set()

# Processed editions in public/editions/
editions_dir = os.path.join(ROOT_DIR, "public", "editions")
if os.path.exists(editions_dir):
    for name in os.listdir(editions_dir):
        if DATE_RE.match(name) and os.path.isdir(os.path.join(editions_dir, name)):
            EXISTING_DATES.add(name[:10])

# Pending editions in ocr/inbox/
inbox_dir = os.path.join(ROOT_DIR, "ocr", "inbox")
if os.path.exists(inbox_dir):
    for name in os.listdir(inbox_dir):
        m = DATE_RE.search(name)
        if m and os.path.isdir(os.path.join(inbox_dir, name)):
            EXISTING_DATES.add(m.group(1))

def fetch_all_items_for_decade(decade_start):
    """Fetch all items from the collection for a specific decade."""
    all_records = []
    start = 1
    while True:
        api_url = (
            f"{BASE_URL}/digital/bl/dmwebservices/index.php?"
            f"q=dmQuery/{COLLECTION}/source^wesleyan^all^and!date^{decade_start}^all^and"
            f"/title!date!dmrecord!source/date/200/{start}/1/0/0/0/json"
        )
        print(f"  Fetching items starting at {start}...")
        try:
            response = requests.get(api_url, timeout=30)
            response.raise_for_status()
            data = response.json()
        except Exception as e:
            print(f"  Error: {e}")
            break

        total = int(data.get("pager", {}).get("total", 0))
        records = data.get("records", [])

        if not records:
            break

        all_records.extend(records)

        if start + len(records) > total:
            break
        start += len(records)

    return all_records


def filter_decade_records(records, decade_start):
    """Filter records to only include those within the decade."""
    decade_end = decade_start + 9
    filtered = []
    for r in records:
        date = r.get("date", "")
        if len(date) >= 4:
            try:
                year = int(date[:4])
                if decade_start <= year <= decade_end:
                    filtered.append(r)
            except ValueError:
                pass
    return filtered


def main():
    print(f"Already known: {len(EXISTING_DATES)} editions")
    print("  (from public/editions/ and ocr/inbox/)")
    print()

    all_new_manifests = []

    for decade in DECADES:
        print(f"\n{'=' * 60}")
        print(f"DECADE: {decade}s")
        print(f"{'=' * 60}")

        decade_str = str(decade)
        decade_end_str = str(decade + 9)
        already_have = sum(1 for d in EXISTING_DATES if decade_str <= d[:4] <= decade_end_str)
        needed = TARGET_PER_DECADE - already_have

        print(f"  Target: {TARGET_PER_DECADE}, Already have: {already_have}, Needed: {needed}")

        if needed <= 0:
            print("  Sufficient editions already exist for this decade. Skipping.")
            continue

        records = fetch_all_items_for_decade(decade)
        records = filter_decade_records(records, decade)

        print(f"  Total catalogue editions in {decade}s: {len(records)}")

        available = []
        for r in records:
            date = r.get("date", "")
            if date not in EXISTING_DATES:
                available.append(r)

        print(f"  Available new editions to download: {len(available)}")

        if len(available) < needed:
            print(f"  WARNING: Only {len(available)} available, but need {needed}. Selecting all.")
            selected = available
        else:
            available.sort(key=lambda r: r.get("date", ""))
            step = len(available) / needed
            selected = []
            for i in range(needed):
                idx = int(i * step)
                selected.append(available[idx])

        print(f"\n  Selected {len(selected)} new editions:")
        for r in selected:
            pointer = r.get("pointer")
            date = r.get("date", "")
            title = r.get("title", "")
            manifest_url = f"{BASE_URL}/iiif/info/{COLLECTION}/{pointer}/manifest.json"
            all_new_manifests.append(manifest_url)
            print(f"    {date} - {title} (ptr: {pointer})")

    output_file = os.path.join(SCRIPT_DIR, "manifests", "new_manifests.txt")
    with open(output_file, "w") as f:
        for url in all_new_manifests:
            f.write(url + "\n")

    print(f"\n{'=' * 60}")
    print(f"TOTAL: {len(all_new_manifests)} new manifest URLs -> {output_file}")
    print(f"{'=' * 60}")
    print("\nTo download, run:")
    print(f"  python scripts/iiif/download.py --batch {output_file}")


if __name__ == "__main__":
    main()
