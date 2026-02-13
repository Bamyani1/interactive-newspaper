#!/usr/bin/env python3
"""
Phase 1: Extraction
Extract raw OCR text using Google Vision API and images using YOLO11 DocLayNet model.

Usage:
    python extract.py --edition 1986-10-17
    python extract.py --edition 1986-10-17 --skip-ocr  # Only run YOLO
    python extract.py --edition 1986-10-17 --skip-yolo # Only run OCR
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

import cv2
from google.cloud import vision
from huggingface_hub import hf_hub_download
from PIL import Image
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn
from ultralytics import YOLO

from config import (
    GOOGLE_CLOUD_CREDENTIALS,
    MAX_IMAGE_DIMENSION,
    VISION_API_DELAY_MS,
    YOLO_CONFIDENCE_THRESHOLD,
    YOLO_MIN_IMAGE_SIZE,
    JPEG_QUALITY,
    ensure_directories,
)
from postprocess import clean_ocr_text

console = Console()


def load_yolo_model() -> YOLO:
    """Download YOLO11 DocLayNet model from HuggingFace Hub and load it."""
    console.print("[cyan]Downloading YOLO11 DocLayNet model...[/cyan]")
    model_path = hf_hub_download(
        repo_id="Armaggheddon/yolo11-document-layout",
        filename="yolo11m_doc_layout.pt"
    )
    console.print(f"[green]Model loaded from {model_path}[/green]")
    return YOLO(model_path)


def preprocess_image_for_vision(image_path: Path) -> bytes:
    """
    Preprocess image for Google Vision API.
    Resize if needed, convert to JPEG bytes.
    """
    with Image.open(image_path) as img:
        # Convert to RGB if necessary (handles CMYK, RGBA, etc.)
        if img.mode != "RGB":
            img = img.convert("RGB")

        # Resize if larger than API limit
        width, height = img.size
        if max(width, height) > MAX_IMAGE_DIMENSION:
            scale = MAX_IMAGE_DIMENSION / max(width, height)
            new_size = (int(width * scale), int(height * scale))
            img = img.resize(new_size, Image.Resampling.LANCZOS)

        # Convert to JPEG bytes
        from io import BytesIO
        buffer = BytesIO()
        img.save(buffer, format="JPEG", quality=JPEG_QUALITY)
        return buffer.getvalue()


def extract_text_with_vision(image_path: Path, client: vision.ImageAnnotatorClient) -> str:
    """Extract text from an image using Google Vision API."""
    image_content = preprocess_image_for_vision(image_path)
    image = vision.Image(content=image_content)

    response = client.document_text_detection(image=image)

    if response.error.message:
        raise Exception(f"Vision API error: {response.error.message}")

    # Get full text from the response
    if response.full_text_annotation:
        return response.full_text_annotation.text
    return ""


def extract_images_with_yolo(
    model: YOLO,
    image_path: Path,
    output_dir: Path,
    page_num: int
) -> list[dict]:
    """Extract images from a page using YOLO11 DocLayNet model."""
    # Load image with OpenCV
    img = cv2.imread(str(image_path))
    if img is None:
        console.print(f"[red]Error: Could not load {image_path}[/red]")
        return []

    # Handle RGBA images (convert to RGB)
    if img.shape[2] == 4:
        img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)

    # Run YOLO11 inference with confidence threshold
    results = model(img, conf=YOLO_CONFIDENCE_THRESHOLD, verbose=False)
    result = results[0]

    # YOLO11 DocLayNet model uses 'Picture' class for images
    target_classes = ["Picture", "picture"]
    target_class_ids = [cls_id for cls_id, name in result.names.items() if name in target_classes]

    if not target_class_ids:
        return []

    extracted = []
    image_count = 0

    for box in result.boxes:
        cls_id = int(box.cls[0])
        conf = float(box.conf[0])

        if cls_id in target_class_ids:
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            
            # Ensure coordinates are within bounds
            h, w = img.shape[:2]
            x1, y1 = max(0, x1), max(0, y1)
            x2, y2 = min(w, x2), min(h, y2)
            
            # Skip invalid boxes
            if x2 <= x1 or y2 <= y1:
                continue
            
            # Skip very small boxes (likely noise)
            if (x2 - x1) < YOLO_MIN_IMAGE_SIZE or (y2 - y1) < YOLO_MIN_IMAGE_SIZE:
                continue

            crop = img[y1:y2, x1:x2]

            image_count += 1
            filename = f"p{page_num}-i{image_count}.jpg"
            output_path = output_dir / filename

            cv2.imwrite(str(output_path), crop, [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY])

            extracted.append({
                "filename": filename,
                "bbox": [x1, y1, x2, y2],
                "confidence": round(conf, 3),
                "page": page_num,
                "class": result.names[cls_id]
            })

    return extracted


def find_tiff_files(edition_dir: Path) -> list[Path]:
    """Find all TIFF files in the edition directory and subdirectories, sorted by name."""
    extensions = ["*.tif", "*.tiff", "*.TIF", "*.TIFF"]
    files = []
    
    # Check root and scanned-newspaper subdirectory
    search_dirs = [edition_dir, edition_dir / "scanned-newspaper"]
    
    for directory in search_dirs:
        if directory.exists():
            for ext in extensions:
                files.extend(directory.glob(ext))
    
    # Remove duplicates if any (though shouldn't be with this logic)
    files = list(set(files))
    return sorted(files, key=lambda p: p.name)


def extract_edition(edition_id: str, skip_ocr: bool = False, skip_yolo: bool = False):
    """
    Extract OCR text and images from an edition.

    Output:
      - pages/page_XX.txt (raw OCR text per page)
      - extracted-images/pX-iY.jpg (cropped images)
      - extracted-images/images-metadata.json (image bounding boxes)
    """
    paths = ensure_directories(edition_id)
    edition_dir = paths["edition_dir"]
    pages_dir = paths["pages_dir"]
    images_dir = paths["images_dir"]

    if not edition_dir.exists():
        console.print(f"[red]Error: Edition directory not found: {edition_dir}[/red]")
        sys.exit(1)

    # Find TIFF files
    tiff_files = find_tiff_files(edition_dir)
    if not tiff_files:
        console.print(f"[red]Error: No TIFF files found in {edition_dir}[/red]")
        sys.exit(1)

    console.print(f"\n[bold]Processing edition: {edition_id}[/bold]")
    console.print(f"Found {len(tiff_files)} pages")
    console.print(f"Output: {paths['output_dir']}\n")

    # Initialize clients/models
    vision_client = None
    yolo_model = None

    if not skip_ocr:
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = GOOGLE_CLOUD_CREDENTIALS
        vision_client = vision.ImageAnnotatorClient()
        console.print("[green]✓ Vision API client initialized[/green]")

    if not skip_yolo:
        yolo_model = load_yolo_model()

    # Process each page
    all_images_metadata = {}

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        console=console,
    ) as progress:
        task = progress.add_task("Processing pages...", total=len(tiff_files))

        for i, tiff_path in enumerate(tiff_files):
            page_num = i + 1
            progress.update(task, description=f"Page {page_num}/{len(tiff_files)}: {tiff_path.name}")

            # OCR extraction
            if not skip_ocr and vision_client:
                text_file = pages_dir / f"page_{page_num:02d}.txt"
                
                # Cache check: skip API call if text already exists
                if text_file.exists():
                    console.print(f"  [dim]Page {page_num}: Using cached OCR[/dim]")
                else:
                    try:
                        text = extract_text_with_vision(tiff_path, vision_client)
                        # Apply post-processing to fix common OCR errors
                        text = clean_ocr_text(text)
                        text_file.write_text(text, encoding="utf-8")

                        # Rate limiting
                        time.sleep(VISION_API_DELAY_MS / 1000)
                    except Exception as e:
                        console.print(f"[red]OCR error on page {page_num}: {e}[/red]")

            # YOLO image extraction
            if not skip_yolo and yolo_model:
                try:
                    page_images = extract_images_with_yolo(
                        yolo_model, tiff_path, images_dir, page_num
                    )
                    if page_images:
                        all_images_metadata[page_num] = page_images
                except Exception as e:
                    console.print(f"[red]YOLO error on page {page_num}: {e}[/red]")

            progress.advance(task)

    # Save images metadata
    if all_images_metadata:
        metadata_path = images_dir / "images-metadata.json"
        with open(metadata_path, "w") as f:
            json.dump(all_images_metadata, f, indent=2)
        console.print(f"\n[green]✓ Image metadata saved to {metadata_path}[/green]")

    # Summary
    text_files = list(pages_dir.glob("page_*.txt"))
    image_files = list(images_dir.glob("p*-i*.jpg"))

    console.print(f"\n[bold green]Extraction complete![/bold green]")
    console.print(f"  • OCR text files: {len(text_files)}")
    console.print(f"  • Extracted images: {len(image_files)}")


def main():
    parser = argparse.ArgumentParser(description="Extract OCR text and images from newspaper scans")
    parser.add_argument("--edition", required=True, help="Edition ID (e.g., 1986-10-17)")
    parser.add_argument("--skip-ocr", action="store_true", help="Skip OCR extraction")
    parser.add_argument("--skip-yolo", action="store_true", help="Skip YOLO image extraction")

    args = parser.parse_args()
    extract_edition(args.edition, skip_ocr=args.skip_ocr, skip_yolo=args.skip_yolo)


if __name__ == "__main__":
    main()
