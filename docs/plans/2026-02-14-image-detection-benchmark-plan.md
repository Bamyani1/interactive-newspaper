# Image Detection Model Benchmark — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Clean up all old OCR testing artifacts, install 3 new image detection models (PP-DocLayout-L, Surya, Docling Heron-101), run them on 8 scanned newspaper pages, and present visual comparison results.

**Architecture:** Single self-contained test script with inline detection functions per model. No adapter pattern. Results saved as side-by-side annotated images + JSON metrics.

**Tech Stack:** Python 3.12+, PaddlePaddle/PaddleOCR, Surya, Docling, Pillow, NumPy. Running on M4 Mac (Apple Silicon).

---

### Task 1: Delete old OCR testing artifacts

**Files:**
- Delete: `ocr/model_adapters/` (entire directory — 6 files + __pycache__)
- Delete: `ocr/test_baseline.py`
- Delete: `ocr/test_multi_model.py`
- Delete: `ocr/test_dino_page6.py`
- Delete: `ocr/batch_test_dino_yolo.py`
- Delete: `ocr/MULTI_MODEL_RESULTS.md`
- Delete: `ocr/MULTI_MODEL_TESTING.md`
- Delete: `ocr/yolo26n.pt`
- Delete: `ocr/requirements-testing.txt`
- Delete: `ocr/batch_process.sh`
- Delete: `ocr/monitor_progress.sh`
- Delete: `ocr/validate_batch.py`
- Delete: `ocr/__pycache__/` (entire directory)
- Delete: `public/editions/multi_model_comparison/` (entire directory — 5 files)
- Delete: `public/editions/page6_model_comparison/` (entire directory — 2 files)
- Delete: `public/editions/images/` (entire directory — 1 file)

**Step 1: Delete all listed files and directories**

```bash
cd /Users/bamyani/Desktop/interactive-newspaper-temp-main

# OCR test scripts and docs
rm -f ocr/test_baseline.py ocr/test_multi_model.py ocr/test_dino_page6.py ocr/batch_test_dino_yolo.py
rm -f ocr/MULTI_MODEL_RESULTS.md ocr/MULTI_MODEL_TESTING.md
rm -f ocr/yolo26n.pt ocr/requirements-testing.txt
rm -f ocr/batch_process.sh ocr/monitor_progress.sh ocr/validate_batch.py

# Directories
rm -rf ocr/model_adapters/
rm -rf ocr/__pycache__/
rm -rf public/editions/multi_model_comparison/
rm -rf public/editions/page6_model_comparison/
rm -rf public/editions/images/
```

**Step 2: Verify cleanup**

```bash
# Should show NONE of the deleted files
ls ocr/test_*.py 2>/dev/null && echo "FAIL: test files still exist" || echo "OK: test files removed"
ls ocr/model_adapters/ 2>/dev/null && echo "FAIL: adapters still exist" || echo "OK: adapters removed"
ls public/editions/multi_model_comparison/ 2>/dev/null && echo "FAIL: comparison dir still exists" || echo "OK: comparison dir removed"
```

Expected: All "OK" messages.

**Step 3: Commit cleanup**

```bash
git add -A ocr/test_baseline.py ocr/test_multi_model.py ocr/test_dino_page6.py ocr/batch_test_dino_yolo.py \
  ocr/MULTI_MODEL_RESULTS.md ocr/MULTI_MODEL_TESTING.md ocr/yolo26n.pt ocr/requirements-testing.txt \
  ocr/batch_process.sh ocr/monitor_progress.sh ocr/validate_batch.py \
  ocr/model_adapters/ ocr/__pycache__/ \
  public/editions/multi_model_comparison/ public/editions/page6_model_comparison/ public/editions/images/
git commit -m "chore: remove old OCR test scripts, model adapters, and generated outputs"
```

---

### Task 2: Add test_results to .gitignore and create requirements file

**Files:**
- Modify: `.gitignore` — add `ocr/test_results/` entry
- Create: `ocr/requirements-models.txt` — new model dependencies

**Step 1: Add gitignore entry**

Add this line after the `ocr/models/` section in `.gitignore`:

```
# OCR Test Results (generated, not committed)
ocr/test_results/
```

**Step 2: Create requirements-models.txt**

Create `ocr/requirements-models.txt` with:

```
# Image detection model benchmark dependencies
# Install: pip install -r requirements-models.txt

# Model 1: PP-DocLayout-L (PaddlePaddle)
paddlepaddle
paddleocr>=2.9

# Model 2: Surya layout detection
surya-ocr

# Model 3: Docling Heron-101 (RT-DETR/DFINE)
docling

# Shared
Pillow>=10.0
numpy>=1.24
```

**Step 3: Commit**

```bash
git add .gitignore ocr/requirements-models.txt
git commit -m "chore: add model benchmark requirements and gitignore test results"
```

---

### Task 3: Install model dependencies in virtual environment

**Files:** None (environment setup only)

**Step 1: Activate virtual environment and install**

```bash
cd /Users/bamyani/Desktop/interactive-newspaper-temp-main/ocr
source .venv/bin/activate
pip install -r requirements-models.txt
```

Expected: All packages install successfully. PaddlePaddle will be CPU-only on macOS (this is fine). Surya and Docling will use PyTorch with MPS support.

**Step 2: Verify installations**

```bash
python -c "from paddleocr import PaddleOCR; print('PaddleOCR OK')"
python -c "from surya.detection import DetectionPredictor; print('Surya OK')"
python -c "from docling.document_converter import DocumentConverter; print('Docling OK')"
```

Expected: Three "OK" messages. If any fail, check error messages and install missing system dependencies.

**Note:** First run of each model will download weights automatically:
- PP-DocLayout-L: ~200MB
- Surya layout model: ~300MB
- Docling Heron-101: ~300MB

No commit for this step (venv is gitignored).

---

### Task 4: Write the test script

**Files:**
- Create: `ocr/test_image_detection.py`

**Step 1: Create the complete test script**

Create `ocr/test_image_detection.py` with the following content. This is one self-contained file with all 3 model detection functions, visualization, and reporting:

```python
#!/usr/bin/env python3
"""
Image Detection Model Benchmark
================================
Tests 3 layout detection models on scanned newspaper pages:
  1. PP-DocLayout-L (PaddlePaddle) — 90.4% mAP@0.5
  2. Surya — 88% mean accuracy
  3. Docling Heron-101 — 78% mAP (RT-DETR/DFINE)

Usage:
    python test_image_detection.py

Output: ocr/test_results/
    - page_NN_comparison.jpg (side-by-side per page)
    - summary.json (metrics)
    - summary.md (human-readable report)
"""

import json
import os
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

# ── Config ──────────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
SCAN_DIR = PROJECT_ROOT / "public" / "editions" / "1988-04-13 The Transcript Delaware OH 1988-04-13"
OUTPUT_DIR = SCRIPT_DIR / "test_results"

# Colors for bounding boxes (RGB)
MODEL_COLORS = {
    "PP-DocLayout-L": (255, 50, 50),    # Red
    "Surya": (50, 180, 50),             # Green
    "Docling Heron": (50, 100, 255),    # Blue
}

BOX_WIDTH = 4
LABEL_SIZE = 24


# ── Data Types ──────────────────────────────────────────────────────────────

@dataclass
class BBox:
    """Bounding box in (x_min, y_min, x_max, y_max) pixel coordinates."""
    x_min: int
    y_min: int
    x_max: int
    y_max: int
    confidence: float = 0.0
    label: str = ""


@dataclass
class DetectionResult:
    """Result from one model on one page."""
    model_name: str
    page_name: str
    boxes: list  # list of BBox
    inference_time_s: float
    error: str = ""


# ── Model 1: PP-DocLayout-L ────────────────────────────────────────────────

def detect_ppdoclayout(image_path: str) -> list[BBox]:
    """Run PP-DocLayout-L detection on an image."""
    from paddleocr import LayoutDetection

    model = LayoutDetection(model_name="PP-DocLayout-L")
    output = model.predict(image_path, batch_size=1, layout_nms=True)

    boxes = []
    for result in output:
        if hasattr(result, "boxes") and result.boxes is not None:
            for box_data in result.boxes:
                # PaddleOCR returns boxes as dict with 'coordinate', 'label', 'score'
                coord = box_data.get("coordinate", box_data.get("bbox", []))
                label = box_data.get("label", box_data.get("cls_name", ""))
                score = box_data.get("score", box_data.get("cls_score", 0.0))

                if len(coord) >= 4:
                    boxes.append(BBox(
                        x_min=int(coord[0]),
                        y_min=int(coord[1]),
                        x_max=int(coord[2]),
                        y_max=int(coord[3]),
                        confidence=float(score),
                        label=str(label),
                    ))
        # Also handle dict-based output format
        elif isinstance(result, dict):
            for item in result.get("boxes", result.get("layout_result", [])):
                coord = item.get("coordinate", item.get("bbox", []))
                label = item.get("label", item.get("cls_name", ""))
                score = item.get("score", item.get("cls_score", 0.0))
                if len(coord) >= 4:
                    boxes.append(BBox(
                        x_min=int(coord[0]),
                        y_min=int(coord[1]),
                        x_max=int(coord[2]),
                        y_max=int(coord[3]),
                        confidence=float(score),
                        label=str(label),
                    ))

    return boxes


# ── Model 2: Surya ─────────────────────────────────────────────────────────

def detect_surya(image_path: str) -> list[BBox]:
    """Run Surya layout detection on an image."""
    from surya.detection import DetectionPredictor

    predictor = DetectionPredictor()
    image = Image.open(image_path).convert("RGB")
    predictions = predictor([image])

    boxes = []
    for page_pred in predictions:
        if hasattr(page_pred, "bboxes"):
            items = page_pred.bboxes
        elif isinstance(page_pred, dict):
            items = page_pred.get("bboxes", page_pred.get("boxes", []))
        else:
            items = []

        for item in items:
            if hasattr(item, "bbox"):
                bbox = item.bbox
                label = getattr(item, "label", getattr(item, "class_name", ""))
                confidence = getattr(item, "confidence", getattr(item, "score", 0.0))
            elif isinstance(item, dict):
                bbox = item.get("bbox", item.get("polygon", []))
                label = item.get("label", item.get("class_name", ""))
                confidence = item.get("confidence", item.get("score", 0.0))
            else:
                continue

            if len(bbox) >= 4:
                boxes.append(BBox(
                    x_min=int(bbox[0]),
                    y_min=int(bbox[1]),
                    x_max=int(bbox[2]),
                    y_max=int(bbox[3]),
                    confidence=float(confidence) if confidence else 0.0,
                    label=str(label),
                ))

    return boxes


# ── Model 3: Docling Heron-101 ─────────────────────────────────────────────

def detect_docling(image_path: str) -> list[BBox]:
    """Run Docling Heron-101 layout detection on an image."""
    from docling.document_converter import DocumentConverter

    converter = DocumentConverter()
    result = converter.convert(image_path)

    boxes = []
    # Docling returns structured document with page elements
    if hasattr(result, "document") and hasattr(result.document, "pages"):
        for page in result.document.pages.values():
            if hasattr(page, "predictions") and "layout" in page.predictions:
                clusters = page.predictions["layout"].clusters
                for cluster in clusters:
                    if hasattr(cluster, "bbox"):
                        bbox = cluster.bbox
                        boxes.append(BBox(
                            x_min=int(bbox.l),
                            y_min=int(bbox.t),
                            x_max=int(bbox.r),
                            y_max=int(bbox.b),
                            confidence=getattr(cluster, "confidence", 0.0),
                            label=getattr(cluster, "label", "").name if hasattr(getattr(cluster, "label", ""), "name") else str(getattr(cluster, "label", "")),
                        ))

    return boxes


# ── Visualization ───────────────────────────────────────────────────────────

def draw_boxes(image: Image.Image, boxes: list[BBox], color: tuple, model_name: str) -> Image.Image:
    """Draw bounding boxes on an image copy."""
    img = image.copy()
    draw = ImageDraw.Draw(img)

    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", LABEL_SIZE)
    except (OSError, IOError):
        font = ImageFont.load_default()

    for box in boxes:
        # Draw rectangle
        draw.rectangle(
            [box.x_min, box.y_min, box.x_max, box.y_max],
            outline=color,
            width=BOX_WIDTH,
        )
        # Draw label
        label_text = f"{box.label} ({box.confidence:.2f})"
        draw.text(
            (box.x_min + 5, box.y_min + 5),
            label_text,
            fill=color,
            font=font,
        )

    # Draw model name header
    draw.text((20, 20), model_name, fill=color, font=font)
    draw.text(
        (20, 50),
        f"{len(boxes)} detections",
        fill=color,
        font=font,
    )

    return img


def create_comparison_image(
    original: Image.Image,
    results: list[DetectionResult],
) -> Image.Image:
    """Create side-by-side comparison of all models for one page."""
    panels = []
    for result in results:
        color = MODEL_COLORS.get(result.model_name, (200, 200, 200))
        if result.error:
            # Show error panel
            panel = original.copy()
            draw = ImageDraw.Draw(panel)
            draw.text((20, 20), f"{result.model_name}: ERROR", fill=(255, 0, 0))
            draw.text((20, 50), result.error[:100], fill=(255, 0, 0))
        else:
            panel = draw_boxes(original, result.boxes, color, result.model_name)
        panels.append(panel)

    # Combine side-by-side
    total_width = sum(p.width for p in panels) + (len(panels) - 1) * 10
    max_height = max(p.height for p in panels)
    combined = Image.new("RGB", (total_width, max_height), (30, 30, 30))

    x_offset = 0
    for panel in panels:
        combined.paste(panel, (x_offset, 0))
        x_offset += panel.width + 10

    return combined


# ── Reporting ───────────────────────────────────────────────────────────────

def generate_summary_md(all_results: dict) -> str:
    """Generate human-readable markdown summary."""
    lines = [
        "# Image Detection Model Benchmark Results",
        "",
        f"**Date:** {time.strftime('%Y-%m-%d %H:%M')}",
        f"**Pages tested:** {len(all_results)}",
        "",
        "## Per-Page Results",
        "",
        "| Page | PP-DocLayout-L | Surya | Docling Heron |",
        "|------|----------------|-------|---------------|",
    ]

    model_totals = {}
    model_times = {}

    for page_name, results in sorted(all_results.items()):
        row = f"| {page_name} |"
        for result in results:
            count = len(result.boxes) if not result.error else "ERROR"
            time_s = f"{result.inference_time_s:.1f}s" if not result.error else "-"
            row += f" {count} ({time_s}) |"

            model_totals.setdefault(result.model_name, 0)
            model_times.setdefault(result.model_name, [])
            if not result.error:
                model_totals[result.model_name] += len(result.boxes)
                model_times[result.model_name].append(result.inference_time_s)
        lines.append(row)

    lines.extend([
        "",
        "## Summary",
        "",
        "| Model | Total Detections | Avg Time/Page |",
        "|-------|-----------------|---------------|",
    ])

    for model_name in MODEL_COLORS:
        total = model_totals.get(model_name, 0)
        times = model_times.get(model_name, [])
        avg_time = f"{sum(times)/len(times):.1f}s" if times else "-"
        lines.append(f"| {model_name} | {total} | {avg_time} |")

    lines.extend([
        "",
        "## Label Distribution (all pages combined)",
        "",
    ])

    # Collect label stats per model
    for model_name in MODEL_COLORS:
        label_counts = {}
        for page_results in all_results.values():
            for result in page_results:
                if result.model_name == model_name and not result.error:
                    for box in result.boxes:
                        label_counts[box.label] = label_counts.get(box.label, 0) + 1

        lines.append(f"### {model_name}")
        if label_counts:
            for label, count in sorted(label_counts.items(), key=lambda x: -x[1]):
                lines.append(f"- **{label}**: {count}")
        else:
            lines.append("- No detections or error")
        lines.append("")

    return "\n".join(lines)


# ── Main ────────────────────────────────────────────────────────────────────

MODELS = [
    ("PP-DocLayout-L", detect_ppdoclayout),
    ("Surya", detect_surya),
    ("Docling Heron", detect_docling),
]


def run_benchmark():
    """Run all models on all pages and generate comparison output."""
    # Setup output directory
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Find all TIFF pages
    tiff_files = sorted(SCAN_DIR.glob("*.tif"))
    if not tiff_files:
        print(f"ERROR: No TIFF files found in {SCAN_DIR}")
        sys.exit(1)

    print(f"Found {len(tiff_files)} pages in {SCAN_DIR.name}")
    print(f"Testing models: {', '.join(name for name, _ in MODELS)}")
    print(f"Output: {OUTPUT_DIR}")
    print("=" * 60)

    all_results = {}  # page_name -> list[DetectionResult]

    for tiff_path in tiff_files:
        page_name = tiff_path.stem  # e.g. "0001_Page 1"
        print(f"\n── {page_name} ──")

        # Load image once
        original = Image.open(tiff_path).convert("RGB")
        print(f"   Image size: {original.width}x{original.height}")

        page_results = []

        for model_name, detect_fn in MODELS:
            print(f"   {model_name}...", end=" ", flush=True)

            start = time.time()
            try:
                boxes = detect_fn(str(tiff_path))
                elapsed = time.time() - start
                result = DetectionResult(
                    model_name=model_name,
                    page_name=page_name,
                    boxes=boxes,
                    inference_time_s=elapsed,
                )
                print(f"{len(boxes)} detections in {elapsed:.1f}s")
            except Exception as e:
                elapsed = time.time() - start
                result = DetectionResult(
                    model_name=model_name,
                    page_name=page_name,
                    boxes=[],
                    inference_time_s=elapsed,
                    error=str(e),
                )
                print(f"ERROR: {e}")

            page_results.append(result)

        all_results[page_name] = page_results

        # Generate comparison image for this page
        comparison = create_comparison_image(original, page_results)
        page_num = page_name.split("_")[0]  # "0001"
        output_path = OUTPUT_DIR / f"page_{page_num}_comparison.jpg"
        comparison.save(str(output_path), quality=90)
        print(f"   Saved: {output_path.name}")

    # ── Generate reports ────────────────────────────────────────────────

    print("\n" + "=" * 60)
    print("Generating reports...")

    # JSON summary
    json_data = {}
    for page_name, results in all_results.items():
        json_data[page_name] = [
            {
                "model": r.model_name,
                "detections": len(r.boxes),
                "inference_time_s": round(r.inference_time_s, 2),
                "error": r.error,
                "boxes": [asdict(b) for b in r.boxes],
            }
            for r in results
        ]

    json_path = OUTPUT_DIR / "summary.json"
    with open(json_path, "w") as f:
        json.dump(json_data, f, indent=2)
    print(f"Saved: {json_path.name}")

    # Markdown summary
    md_content = generate_summary_md(all_results)
    md_path = OUTPUT_DIR / "summary.md"
    with open(md_path, "w") as f:
        f.write(md_content)
    print(f"Saved: {md_path.name}")

    # Print summary to console
    print("\n" + md_content)


if __name__ == "__main__":
    run_benchmark()
```

**Step 2: Commit the test script**

```bash
git add ocr/test_image_detection.py
git commit -m "feat: add 3-model image detection benchmark script"
```

---

### Task 5: Run the benchmark

**Files:** None (execution only)

**Step 1: Activate venv and run**

```bash
cd /Users/bamyani/Desktop/interactive-newspaper-temp-main/ocr
source .venv/bin/activate
python test_image_detection.py
```

Expected output: Progress messages for each page x model, then a summary table.

**First run will be slow** — each model downloads weights on first use (~800MB total). Subsequent runs will be faster.

Expected timing per page (rough estimates on M4 Mac):
- PP-DocLayout-L: 1-3s (CPU)
- Surya: 0.5-2s (MPS)
- Docling Heron: 2-5s (MPS)

Total for 8 pages: ~2-5 minutes.

**Step 2: Verify output files exist**

```bash
ls -la ocr/test_results/
```

Expected: 8 comparison JPGs + summary.json + summary.md

**Step 3: If any model fails to install or run**

Common fixes:
- PaddlePaddle on Mac: `pip install paddlepaddle` (CPU version auto-selected)
- Surya import error: `pip install surya-ocr[layout]` or check `surya` package name
- Docling import error: May need `pip install docling[all]`

Adapt the detect function if the API has changed. Check model docs:
- PP-DocLayout: https://paddlepaddle.github.io/PaddleOCR/main/en/version3.x/module_usage/layout_detection.html
- Surya: https://github.com/datalab-to/surya
- Docling: https://pypi.org/project/docling/

---

### Task 6: Review results with user

**Files:** None (review only)

**Step 1: Open comparison images for user review**

```bash
open ocr/test_results/page_0006_comparison.jpg  # Page 6 — the key test page
open ocr/test_results/page_0001_comparison.jpg  # Page 1 — front page
```

**Step 2: Show summary**

```bash
cat ocr/test_results/summary.md
```

**Step 3: Discuss with user**

Present the results and ask:
- Which model detected the most charts/diagrams on page 6?
- Which model had the fewest false positives?
- Any model clearly better than the others?

No commit for this step.

---

### Task 7: Final cleanup commit

**Step 1: Verify no unwanted files are staged**

```bash
git status
```

**Step 2: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: complete image detection model benchmark setup"
```

---

## Execution Notes

- **Critical path:** Task 3 (install) may surface compatibility issues on M4 Mac. Be ready to adapt.
- **Model API changes:** The detect functions in Task 4 are written based on current docs. If APIs have changed, check the model documentation linked in each function and adapt the parsing logic.
- **The test script is designed to be resilient** — if one model fails, it records the error and continues with the others, so you always get partial results.
