#!/usr/bin/env python3
"""Download newspaper edition images from IIIF manifests.

Downloads full-resolution page images from CONTENTdm IIIF image services.
Supports single manifest or batch mode with a manifest list file.

Usage:
    python scripts/iiif/download.py <manifest_url>
    python scripts/iiif/download.py --batch manifests/new_manifests.txt
    python scripts/iiif/download.py --batch manifests/new_manifests.txt --output-root ocr/inbox
"""

import os
import re
import sys
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

import requests

try:
    from tqdm import tqdm
except ImportError:
    tqdm = None

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))

DEFAULT_OUTPUT_ROOT = os.path.join(ROOT_DIR, "ocr", "inbox")

IMAGE_FORMATS = [
    ("full/max/0/default.jpg", ".jpg"),
    ("full/full/0/default.jpg", ".jpg"),
    ("full/max/0/default.png", ".png"),
    ("full/full/0/default.png", ".png"),
]
IMAGE_EXTENSIONS = tuple(sorted({ext for _, ext in IMAGE_FORMATS}))
DATE_PATTERN = re.compile(r"(\d{4}-\d{2}-\d{2})")


def get_manifest_url(input_url):
    """Extract the manifest URL from a manifest URL or viewer URL."""
    parsed = urllib.parse.urlparse(input_url)
    query_params = urllib.parse.parse_qs(parsed.query)

    if "manifest" in query_params:
        return query_params["manifest"][0]

    if input_url.endswith(".json") or "/manifest" in input_url:
        return input_url

    print(f"Warning: Could not detect manifest URL from {input_url}. Using as is.")
    return input_url


def extract_text(value):
    """Flatten common IIIF value shapes into a single string."""
    if isinstance(value, str):
        return value.strip()

    if isinstance(value, list):
        for item in value:
            text = extract_text(item)
            if text:
                return text
        return ""

    if isinstance(value, dict):
        for item in value.values():
            text = extract_text(item)
            if text:
                return text
        return ""

    return ""


def sanitize_name(value, fallback="downloaded_images"):
    cleaned = "".join(
        char for char in value if char.isalnum() or char in (" ", ".", "_", "-")
    ).strip()
    return cleaned or fallback


def fetch_manifest(url):
    manifest_url = get_manifest_url(url)
    response = requests.get(manifest_url, timeout=30)
    response.raise_for_status()
    return manifest_url, response.json()


def extract_manifest_label(manifest):
    return extract_text(manifest.get("label")) or "downloaded_images"


def extract_manifest_date(manifest):
    for item in manifest.get("metadata", []):
        label = extract_text(item.get("label", ""))
        if label.lower() == "date":
            value = extract_text(item.get("value", ""))
            if value:
                return value

    label = extract_manifest_label(manifest)
    match = DATE_PATTERN.search(label)
    if match:
        return match.group(1)

    return ""


def build_output_dir_name(manifest, directory_mode="label", output_dir_name=None):
    if output_dir_name:
        return sanitize_name(output_dir_name)

    label = extract_manifest_label(manifest)
    date_str = extract_manifest_date(manifest)

    if directory_mode == "date-raw" and date_str:
        dir_name = f"{date_str}-raw"
    elif date_str:
        dir_name = f"{date_str} {label}"
    else:
        dir_name = label

    return sanitize_name(dir_name)


def extract_canvases(manifest):
    sequences = manifest.get("sequences", [])
    if sequences:
        canvases = []
        for sequence in sequences:
            canvases.extend(sequence.get("canvases", []))
        return canvases
    return manifest.get("items", [])


def extract_canvas_label(canvas, default_label):
    label = extract_text(canvas.get("label"))
    return label or default_label


def extract_image_service_url(canvas):
    images = canvas.get("images", [])
    if images:
        resource = images[0].get("resource", {})
        service = resource.get("service", {})
        if isinstance(service, list) and service:
            service = service[0]
        return service.get("@id") or service.get("id")

    items = canvas.get("items", [])
    if not items:
        return None

    annotation_page = items[0]
    annotations = annotation_page.get("items", [])
    if not annotations:
        return None

    body = annotations[0].get("body", {})
    service = body.get("service", [])
    if isinstance(service, list) and service:
        service = service[0]
    return service.get("id") or service.get("@id")


def build_filename_base(index, label):
    return sanitize_name(f"{index:04d}_{label}", fallback=f"{index:04d}")


def image_exists(output_dir, filename_base):
    for ext in IMAGE_EXTENSIONS:
        if os.path.exists(os.path.join(output_dir, f"{filename_base}{ext}")):
            return True
    return False


def build_download_tasks(manifest, output_dir):
    tasks = []
    canvases = extract_canvases(manifest)
    for index, canvas in enumerate(canvases, start=1):
        image_service_url = extract_image_service_url(canvas)
        if not image_service_url:
            continue
        canvas_label = extract_canvas_label(canvas, str(index))
        filename_base = build_filename_base(index, canvas_label)
        tasks.append((image_service_url, output_dir, filename_base))
    return tasks


def download_image(task):
    image_base_url, output_dir, filename_base = task

    if image_exists(output_dir, filename_base):
        return True

    for suffix, ext in IMAGE_FORMATS:
        url = f"{image_base_url}/{suffix}"
        try:
            response = requests.get(url, stream=True, timeout=30)
            if response.status_code != 200:
                continue

            content_type = response.headers.get("content-type", "").lower()
            if "image" not in content_type and "application/octet-stream" not in content_type:
                continue

            output_path = os.path.join(output_dir, f"{filename_base}{ext}")
            with open(output_path, "wb") as handle:
                for chunk in response.iter_content(chunk_size=8192):
                    handle.write(chunk)
            return True
        except Exception:
            continue

    return False


def download_manifest(
    url,
    output_root=None,
    directory_mode="label",
    output_dir_name=None,
    max_workers=2,
    show_progress=None,
):
    """Download all canvases from a IIIF manifest."""
    if output_root is None:
        output_root = DEFAULT_OUTPUT_ROOT

    manifest_url = get_manifest_url(url)
    print(f"Fetching manifest: {manifest_url}")

    try:
        manifest_url, manifest = fetch_manifest(manifest_url)
    except Exception as exc:
        print(f"Error fetching manifest: {exc}")
        return {
            "manifest_url": manifest_url,
            "manifest": None,
            "successful": 0,
            "failed": 0,
            "output_dir": None,
            "skipped_complete": False,
            "total_images": 0,
            "error": str(exc),
        }

    output_dir = os.path.join(
        output_root,
        build_output_dir_name(
            manifest,
            directory_mode=directory_mode,
            output_dir_name=output_dir_name,
        ),
    )
    os.makedirs(output_dir, exist_ok=True)
    print(f"Downloading to: {output_dir}")

    tasks = build_download_tasks(manifest, output_dir)
    total_images = len(tasks)
    print(f"Found {total_images} pages/images.")

    if total_images and all(image_exists(output_dir, filename_base) for _, _, filename_base in tasks):
        print("All images already present. Skipping download.")
        return {
            "manifest_url": manifest_url,
            "manifest": manifest,
            "successful": total_images,
            "failed": 0,
            "output_dir": output_dir,
            "skipped_complete": True,
            "total_images": total_images,
            "error": None,
        }

    if show_progress is None:
        show_progress = tqdm is not None

    successful = 0
    failed = 0

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        results = executor.map(download_image, tasks)
        if show_progress and tqdm:
            results = tqdm(results, total=total_images, unit="img")

        for result in results:
            if result:
                successful += 1
            else:
                failed += 1

    return {
        "manifest_url": manifest_url,
        "manifest": manifest,
        "successful": successful,
        "failed": failed,
        "output_dir": output_dir,
        "skipped_complete": False,
        "total_images": total_images,
        "error": None,
    }


def main():
    if "--batch" in sys.argv:
        batch_idx = sys.argv.index("--batch")
        if batch_idx + 1 < len(sys.argv):
            batch_file = sys.argv[batch_idx + 1]
        else:
            batch_file = os.path.join(SCRIPT_DIR, "manifests", "manifests.txt")

        if not os.path.exists(batch_file):
            print(f"Error: Batch file '{batch_file}' not found.")
            return

        # Parse optional --output-root
        output_root = DEFAULT_OUTPUT_ROOT
        if "--output-root" in sys.argv:
            idx = sys.argv.index("--output-root")
            if idx + 1 < len(sys.argv):
                output_root = os.path.join(ROOT_DIR, sys.argv[idx + 1])

        with open(batch_file, "r") as handle:
            urls = [
                line.strip()
                for line in handle
                if line.strip() and not line.startswith("#")
            ]

        total_manifests = len(urls)
        print("=" * 60)
        print(f"BATCH DOWNLOAD: {total_manifests} manifests from {batch_file}")
        print(f"Output root: {output_root}")
        print("=" * 60)

        total_successful = 0
        total_failed = 0
        total_skipped = 0

        for idx, url in enumerate(urls, start=1):
            print(f"\n{'-' * 60}")
            print(f"[{idx}/{total_manifests}] Processing manifest...")
            print(f"{'-' * 60}")

            result = download_manifest(url, output_root=output_root)
            output_dir = result["output_dir"]

            if output_dir is None:
                total_skipped += 1
                print("  Skipped (could not fetch manifest)")
                continue

            total_successful += result["successful"]
            total_failed += result["failed"]
            if result["skipped_complete"]:
                print(f"  Already complete -> {output_dir}")
            else:
                print(
                    f"  Done: {result['successful']} downloaded, "
                    f"{result['failed']} failed -> {output_dir}"
                )

        print(f"\n{'=' * 60}")
        print("BATCH COMPLETE")
        print(f"{'=' * 60}")
        print(f"  Manifests processed: {total_manifests}")
        print(f"  Manifests skipped:   {total_skipped}")
        print(f"  Images downloaded:   {total_successful}")
        print(f"  Images failed:       {total_failed}")
        if total_failed > 0:
            print("  Check if some manifests restrict high-resolution downloads or have broken links.")
        return

    if len(sys.argv) > 1 and not sys.argv[1].startswith("--"):
        url = sys.argv[1]
    else:
        url = input("Enter the IIIF URL: ").strip()

    result = download_manifest(url)

    print("\nDownload complete.")
    print(f"Successful: {result['successful']}")
    print(f"Failed: {result['failed']}")
    if result["failed"] > 0:
        print("Check if the manifest restricts high-resolution downloads or has broken links.")


if __name__ == "__main__":
    main()
