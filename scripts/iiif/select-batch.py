#!/usr/bin/env python3
"""Select 100 editions from ContentDM to fill year-level coverage gaps.

Queries the ContentDM API, filters out already-processed editions, and
selects evenly-spaced editions per year based on decade quotas.

Usage:
    python3 scripts/iiif/select-batch.py
"""

import math
import os
import requests
from collections import defaultdict

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))

BASE_URL = "https://cdm15963.contentdm.oclc.org"
COLLECTION = "p15963coll9"

# ── Year-level quotas ──────────────────────────────────────
# Format: {year: count_to_select}
# 1980s gap fill — 100 editions, targeting thin years.
# 1986-1988 skipped (already ~25 editions each in DB).

QUOTAS = {
    1980: 10,   # have 11
    1981: 20,   # have 3
    1982: 20,   # have 3
    1983: 15,   # have 3
    1984: 10,   # have 3
    1985: 10,   # have 3
    1989: 15,   # have 4
}

TOTAL_TARGET = sum(QUOTAS.values())


def get_processed_dates():
    """Get all dates already processed in public/editions/."""
    editions_dir = os.path.join(ROOT_DIR, "public", "editions")
    dates = set()
    if os.path.exists(editions_dir):
        for name in os.listdir(editions_dir):
            if len(name) >= 10 and name[4] == "-" and name[7] == "-":
                dates.add(name[:10])
    return dates


def fetch_year_editions(year):
    """Fetch all Wesleyan editions for a given year from ContentDM."""
    search_string = f"source^wesleyan^all^and!date^{year}^all^and"
    all_records = []
    start = 1
    while True:
        api_url = (
            f"{BASE_URL}/digital/bl/dmwebservices/index.php?"
            f"q=dmQuery/{COLLECTION}/{search_string}"
            f"/title!date!dmrecord!source/date/400/{start}/1/0/0/0/json"
        )
        response = requests.get(api_url, timeout=30)
        response.raise_for_status()
        data = response.json()
        records = data.get("records", [])
        total = int(data.get("pager", {}).get("total", 0))
        if not records:
            break
        all_records.extend(records)
        if start + len(records) > total:
            break
        start += len(records)
    return all_records


def evenly_spaced(items, count):
    """Select count items evenly spaced from a sorted list."""
    if count >= len(items):
        return list(items)
    selected = []
    for i in range(count):
        idx = math.floor(i * len(items) / count)
        selected.append(items[idx])
    return selected


def main():
    print(f"Target: {TOTAL_TARGET} editions\n")

    processed = get_processed_dates()
    print(f"Already processed: {len(processed)} editions\n")

    selected = []  # (date, pointer, title, manifest_url)
    decade_counts = defaultdict(int)

    years = sorted(QUOTAS.keys())
    for year in years:
        quota = QUOTAS[year]
        records = fetch_year_editions(year)

        # Filter: correct year, not already processed, has pointer
        available = []
        for r in records:
            date = r.get("date", "")
            pointer = r.get("pointer")
            if not date or not pointer:
                continue
            if not date.startswith(str(year)):
                continue
            if date in processed:
                continue
            available.append(r)

        available.sort(key=lambda r: r.get("date", ""))
        chosen = evenly_spaced(available, quota)

        decade = (year // 10) * 10
        for r in chosen:
            date = r.get("date", "")
            pointer = r.get("pointer")
            title = r.get("title", "")
            manifest_url = f"{BASE_URL}/iiif/info/{COLLECTION}/{pointer}/manifest.json"
            selected.append((date, pointer, title, manifest_url))
            decade_counts[decade] += 1

        status = f"{len(chosen)}/{quota}"
        if len(chosen) < quota:
            status += f" (only {len(available)} available)"
        print(f"  {year}: {status} selected from {len(available)} available")

    # Write manifest URLs
    output_path = os.path.join(SCRIPT_DIR, "manifests", "batch-100.txt")
    selected.sort(key=lambda x: x[0])
    with open(output_path, "w") as f:
        for _, _, _, url in selected:
            f.write(url + "\n")

    # Summary
    print(f"\n{'=' * 60}")
    print(f"SELECTION COMPLETE: {len(selected)} editions")
    print(f"{'=' * 60}")
    print(f"\nPer decade:")
    for decade in sorted(decade_counts):
        print(f"  {decade}s: {decade_counts[decade]}")
    print(f"\nDate range: {selected[0][0]} to {selected[-1][0]}")
    print(f"Manifest file: {output_path}")
    print(f"\nTo download:")
    print(f"  python3 scripts/iiif/download.py --batch {output_path}")


if __name__ == "__main__":
    main()
