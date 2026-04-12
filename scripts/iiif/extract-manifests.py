#!/usr/bin/env python3
"""Extract IIIF manifest URLs from a CONTENTdm collection browse/search page.

Usage:
    python scripts/iiif/extract-manifests.py [URL] [--all] [--output manifests/manifests.txt]

Examples:
    # Browse page (no filters):
    python scripts/iiif/extract-manifests.py "https://cdm15963.contentdm.oclc.org/digital/collection/OWUnewspapers/search/page/12"

    # Search page WITH filters:
    python scripts/iiif/extract-manifests.py "https://cdm15963.contentdm.oclc.org/digital/collection/p15963coll9/search/searchterm/wesleyan/field/source/mode/all/conn/and/order/date/ad/desc/page/3"

    # Extract ALL matching results (not just one page):
    python scripts/iiif/extract-manifests.py "URL" --all
"""

import os
import sys
import re
import argparse
import requests
import urllib.parse

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUTPUT = os.path.join(SCRIPT_DIR, "manifests", "manifests.txt")


def parse_contentdm_url(url):
    """
    Parse a CONTENTdm browse/search URL to extract:
      - base_url (e.g. https://cdm15963.contentdm.oclc.org)
      - collection alias (e.g. OWUnewspapers)
      - page number (e.g. 12)
      - search_params dict with keys: searchterm, field, mode, conn, order, ad
    """
    parsed = urllib.parse.urlparse(url)
    base_url = f"{parsed.scheme}://{parsed.hostname}"

    match = re.search(r'/digital/collection/([^/]+)', parsed.path)
    if not match:
        print(f"Error: Could not extract collection alias from URL: {url}")
        sys.exit(1)
    collection = match.group(1)

    page_match = re.search(r'/page/(\d+)', parsed.path)
    page = int(page_match.group(1)) if page_match else 1

    search_params = {}
    param_keys = ['searchterm', 'field', 'mode', 'conn', 'order', 'ad']
    for key in param_keys:
        param_match = re.search(rf'/{key}/([^/]+)', parsed.path)
        if param_match:
            search_params[key] = urllib.parse.unquote(param_match.group(1))

    return base_url, collection, page, search_params


def build_search_string(search_params):
    """Build a dmQuery search string from parsed URL parameters."""
    searchterm = search_params.get('searchterm', '')
    field = search_params.get('field', '')
    mode = search_params.get('mode', 'all')
    conn = search_params.get('conn', 'and')

    if not searchterm:
        return "0"

    return f"{field}^{searchterm}^{mode}^{conn}"


def build_sort_field(search_params):
    """Build the sort field and direction from parsed URL parameters."""
    order = search_params.get('order', 'title')
    ad = search_params.get('ad', 'asc').lower()
    is_descending = ad == 'desc'
    return order, is_descending


def fetch_items(base_url, collection, search_string="0", sort_field="title", max_recs=200, start=1):
    """Use the CONTENTdm dmQuery API to fetch item records."""
    api_url = (
        f"{base_url}/digital/bl/dmwebservices/index.php?"
        f"q=dmQuery/{collection}/{search_string}/title!dmrecord/{sort_field}/{max_recs}/{start}/1/0/0/0/json"
    )
    print(f"  Fetching items {start} to {start + max_recs - 1}...")
    response = requests.get(api_url, timeout=30)
    response.raise_for_status()
    data = response.json()

    total = int(data.get("pager", {}).get("total", 0))
    records = data.get("records", [])
    return records, total


def build_manifest_url(base_url, collection, pointer):
    """Construct the IIIF manifest URL for a given item pointer."""
    return f"{base_url}/iiif/info/{collection}/{pointer}/manifest.json"


def main():
    parser = argparse.ArgumentParser(
        description="Extract IIIF manifest URLs from a CONTENTdm collection page."
    )
    parser.add_argument(
        "url",
        nargs="?",
        default="https://cdm15963.contentdm.oclc.org/digital/collection/OWUnewspapers/search/page/12",
        help="CONTENTdm browse/search page URL",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Extract manifests for ALL matching items (not just one page)",
    )
    parser.add_argument(
        "--output", "-o",
        default=DEFAULT_OUTPUT,
        help=f"Output file path (default: {DEFAULT_OUTPUT})",
    )
    args = parser.parse_args()

    base_url, collection, page, search_params = parse_contentdm_url(args.url)
    results_per_page = 200

    search_string = build_search_string(search_params)
    sort_field, is_descending = build_sort_field(search_params)
    sort_dir_label = "descending" if is_descending else "ascending"

    print(f"Base URL:    {base_url}")
    print(f"Collection:  {collection}")
    print(f"Page:        {page}")
    print(f"Per page:    {results_per_page}")
    if search_string != "0":
        print(f"Search:      {search_string}")
    print(f"Sort by:     {sort_field} ({sort_dir_label})")
    print()

    manifest_urls = []

    if args.all:
        print("Mode: Fetching ALL matching items...\n")
        start = 1
        total = None
        while True:
            records, total_count = fetch_items(
                base_url, collection, search_string, sort_field, max_recs=1024, start=start
            )
            if total is None:
                total = total_count
                print(f"  Total matching items: {total}\n")
            for rec in records:
                pointer = rec.get("pointer")
                if pointer is not None:
                    url = build_manifest_url(base_url, collection, pointer)
                    manifest_urls.append(url)
            if start + len(records) > total or len(records) == 0:
                break
            start += len(records)

        if is_descending:
            manifest_urls.reverse()
    else:
        _, total = fetch_items(
            base_url, collection, search_string, sort_field, max_recs=1, start=1
        )
        print(f"  Total matching items: {total}")

        if is_descending:
            desc_start = (page - 1) * results_per_page + 1
            desc_end = min(page * results_per_page, total)
            asc_start = max(1, total - desc_end + 1)
            asc_count = desc_end - desc_start + 1
            print(f"  Page {page} descending -> ascending items {asc_start} to {asc_start + asc_count - 1}\n")
            start = asc_start
        else:
            start = (page - 1) * results_per_page + 1
            asc_count = results_per_page
            print(f"  Fetching items {start} to {start + asc_count - 1}\n")

        records, _ = fetch_items(
            base_url, collection, search_string, sort_field, max_recs=asc_count, start=start
        )
        print(f"  Items on this page: {len(records)}\n")

        for rec in records:
            pointer = rec.get("pointer")
            if pointer is not None:
                url = build_manifest_url(base_url, collection, pointer)
                manifest_urls.append(url)

        if is_descending:
            manifest_urls.reverse()

    with open(args.output, "w") as f:
        for url in manifest_urls:
            f.write(url + "\n")

    print(f"Extracted {len(manifest_urls)} manifest URLs -> {args.output}")


if __name__ == "__main__":
    main()
