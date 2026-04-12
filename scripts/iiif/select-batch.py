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

QUOTAS = {}

# 1950s: 10 total — ~1 per gap year (1951-1959), skip 1958
for y in [1951, 1952, 1953, 1954, 1955, 1956, 1957, 1958, 1959]:
    QUOTAS[y] = 1
QUOTAS[1955] = 2  # bump one year to reach 10

# 1960s: 8 total — fill the thinnest years
for y in [1961, 1963, 1965, 1967, 1969]:
    QUOTAS[y] = 1  # years with only 1 edition
QUOTAS[1964] = 1
QUOTAS[1966] = 1
QUOTAS[1968] = 1

# 1970s: 7 total — fill single-edition years
for y in [1971, 1974, 1976, 1978, 1979]:
    QUOTAS[y] = 1
QUOTAS[1973] = 1
QUOTAS[1975] = 1

# 1980s: 15 total — 3 per gap year (1981-1985)
for y in range(1981, 1986):
    QUOTAS[y] = 3

# 1990s: 30 total — 4 per gap year (1993-1999) + 2 extra
for y in range(1993, 2000):
    QUOTAS[y] = 4
QUOTAS[1993] = 5  # extra 1 to reach 30
QUOTAS[1999] = 5  # extra 1 to reach 30

# 2000s: 30 total — 5 per gap year (2001-2006)
for y in range(2001, 2007):
    QUOTAS[y] = 5

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
