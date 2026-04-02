#!/usr/bin/env python3
"""
Preprocessing + YOLO detection script for transcript-ocr skill.

Handles Phases 1 & 2:
- Discovers scan files in a folder
- Checks page quality (skips blanks)
- Preprocesses images (deskew, contrast, sharpen)
- Converts TIF to JPG for Claude viewing
- Runs YOLO detection on each page
- Crops detected image regions
- Writes a detection manifest

Usage:
    python preprocess.py <scan-folder> --output <working-dir>

Requires: ocr/.venv/ activated with doclayout-yolo, Pillow, scipy installed.
"""

import argparse
import json
import os
import sys
from pathlib import Path

# Add the project's OCR package to the path
PROJECT_ROOT = Path(__file__).resolve().parents[3]  # skill is in .claude/skills/transcript-ocr/scripts/
# Fallback: try to find project root by looking for ocr/ directory
if not (PROJECT_ROOT / "ocr").exists():
    # Try alternative paths — skill might be in a different location
    for candidate in [
        Path.cwd(),
        Path(__file__).resolve().parents[2],
        Path(__file__).resolve().parents[4],
    ]:
        if (candidate / "ocr").exists():
            PROJECT_ROOT = candidate
            break

OCR_SRC = PROJECT_ROOT / "ocr" / "src"
sys.path.insert(0, str(OCR_SRC))

IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".tif", ".tiff")


def discover_pages(scan_folder: Path) -> list[Path]:
    """Find and sort all image files in the scan folder."""
    pages = []
    for ext in IMAGE_EXTENSIONS:
        pages.extend(scan_folder.glob(f"*{ext}"))
        pages.extend(scan_folder.glob(f"*{ext.upper()}"))
    # Deduplicate and sort by filename
    pages = sorted(set(pages), key=lambda p: p.name)
    return pages


def preprocess_and_convert(page_path: Path, output_dir: Path, page_index: int) -> dict | None:
    """Preprocess a page image and convert to JPG.

    Returns page info dict or None if page should be skipped.
    """
    from PIL import Image

    try:
        from transcript_ocr.preprocessing.image_preprocessor import (
            check_page_quality,
            preprocess_image,
        )
        has_preprocessor = True
    except ImportError:
        has_preprocessor = False

    img = Image.open(page_path)

    # Quality check
    if has_preprocessor:
        quality = check_page_quality(img)
        if quality.should_skip:
            print(f"  SKIP {page_path.name}: {quality.message}")
            return None
        if quality.message:
            print(f"  WARN {page_path.name}: {quality.message}")

    # Preprocess (deskew, contrast, sharpen)
    if has_preprocessor:
        img = preprocess_image(img, diag=None)

    # Derive page stem from filename
    stem = page_path.stem  # e.g., "0001_Page 1"
    if not stem[0].isdigit():
        # If filename doesn't start with digits, create a padded name
        stem = f"{page_index + 1:04d}_Page {page_index + 1}"

    # Save as JPG
    pages_dir = output_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    jpg_path = pages_dir / f"{stem}.jpg"

    # Convert to RGB if grayscale (JPEG requires RGB or L mode)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")

    img.save(str(jpg_path), "JPEG", quality=95)
    print(f"  OK {page_path.name} → {jpg_path.name}")

    # Extract page number from stem
    page_num = str(page_index + 1)
    # Try to parse from filename pattern "0001_Page 1"
    if "_Page " in stem:
        try:
            page_num = stem.split("_Page ")[1].split("_")[0].strip()
        except (IndexError, ValueError):
            pass

    return {
        "page_number": page_num,
        "page_file": f"pages/{jpg_path.name}",
        "page_stem": stem,
        "original_path": str(page_path),
        "preprocessed_path": str(jpg_path),
        "pil_image_for_yolo": img,  # Keep for YOLO (not serialized)
    }


def run_yolo_detection(page_info: dict, output_dir: Path) -> list[dict]:
    """Run YOLO detection on a page and crop image regions.

    Returns list of region dicts.
    """
    try:
        from transcript_ocr.detection.yolo_provider import detect_image_regions
        from transcript_ocr.image_linking.cropper import crop_and_save_images
    except ImportError:
        print("  WARN: YOLO detection not available (missing doclayout-yolo). Skipping detection.")
        return []

    img = page_info.get("pil_image_for_yolo")
    if img is None:
        return []

    page_stem = page_info["page_stem"]

    # Detect regions
    regions = detect_image_regions(img, diag=None)
    if not regions:
        return []

    # Crop and save
    saved = crop_and_save_images(
        image=img,
        regions=regions,
        output_dir=str(output_dir),
        page_stem=page_stem,
        padding_frac=0.02,
        quality=95,
    )

    # Build region list
    result = []
    for idx, (y1, x1, y2, x2) in enumerate(regions):
        cropped_file = saved.get(idx, "")
        result.append({
            "index": idx,
            "bbox": [int(y1), int(x1), int(y2), int(x2)],
            "cropped_file": cropped_file,
        })

    return result


def main():
    parser = argparse.ArgumentParser(description="Preprocess scans and run YOLO detection")
    parser.add_argument("scan_folder", help="Path to folder containing scan images")
    parser.add_argument("--output", required=True, help="Working directory for intermediate files")
    args = parser.parse_args()

    scan_folder = Path(args.scan_folder).resolve()
    output_dir = Path(args.output).resolve()

    if not scan_folder.exists():
        print(f"ERROR: Scan folder not found: {scan_folder}")
        sys.exit(1)

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "pages").mkdir(exist_ok=True)
    (output_dir / "images").mkdir(exist_ok=True)
    (output_dir / "page_results").mkdir(exist_ok=True)

    # Phase 1: Discover and preprocess
    print(f"\n=== Phase 1: Discover & Preprocess ===")
    print(f"Scan folder: {scan_folder}")

    pages = discover_pages(scan_folder)
    if not pages:
        print(f"ERROR: No image files found in {scan_folder}")
        sys.exit(1)

    print(f"Found {len(pages)} page files")

    page_infos = []
    skipped = []
    for i, page_path in enumerate(pages):
        info = preprocess_and_convert(page_path, output_dir, i)
        if info is None:
            skipped.append(page_path.name)
        else:
            page_infos.append(info)

    print(f"\nPreprocessed: {len(page_infos)} pages, skipped: {len(skipped)}")

    # Phase 2: YOLO detection
    print(f"\n=== Phase 2: YOLO Detection & Cropping ===")

    manifest_pages = []
    total_regions = 0

    for info in page_infos:
        print(f"  Detecting: {info['page_stem']}...")
        regions = run_yolo_detection(info, output_dir)
        total_regions += len(regions)

        if regions:
            print(f"    Found {len(regions)} image region(s)")
        else:
            print(f"    No image regions found")

        manifest_pages.append({
            "page_number": info["page_number"],
            "page_file": info["page_file"],
            "regions": regions,
        })

    # Write detection manifest
    manifest = {
        "pages": manifest_pages,
        "total_pages": len(page_infos),
        "total_regions": total_regions,
        "skipped_pages": skipped,
    }

    manifest_path = output_dir / "detection_manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\n=== Summary ===")
    print(f"Pages processed: {len(page_infos)}")
    print(f"Pages skipped: {len(skipped)}")
    print(f"Image regions detected: {total_regions}")
    print(f"Detection manifest: {manifest_path}")
    print(f"Working directory: {output_dir}")


if __name__ == "__main__":
    main()
