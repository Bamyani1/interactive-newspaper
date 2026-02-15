# Image Detection Model Benchmark Design

**Date:** 2026-02-14
**Goal:** Replace existing OCR image detection (DocLayout-YOLO) with the most accurate model for extracting figures, charts, and diagrams from scanned 1980s newspaper pages.

## Problem

The current DocLayout-YOLO pipeline fails to detect charts, diagrams, and illustrations on newspaper pages (especially page 6, the arts section). Text extraction via Gemini works well; only the image region detection needs improvement.

## Approach

Test 3 state-of-the-art layout detection models, compare results visually and quantitatively, then select the best performer.

## Models to Test

### 1. PP-DocLayout-L (PaddlePaddle)
- **Reported accuracy:** 90.4% mAP@0.5 (highest of any model found)
- **Categories:** 23 element types (figures, charts, tables, equations, stamps, seals, etc.)
- **Speed:** 13.4ms per page on T4 GPU
- **Install:** `pip install paddlepaddle paddleocr`
- **Sources:** [Paper](https://arxiv.org/html/2503.17213v1), [HuggingFace](https://huggingface.co/PaddlePaddle/PP-DocLayout-L)

### 2. Surya
- **Reported accuracy:** 88% mean accuracy on layout detection
- **Categories:** Picture, Figure, Table, Caption, Formula + more
- **Speed:** 0.4s per image on A10 GPU, MPS-compatible
- **Install:** `pip install surya-ocr`
- **Sources:** [GitHub](https://github.com/datalab-to/surya)

### 3. Docling Heron-101
- **Reported accuracy:** 78% mAP on DocLayNet (23.5% improvement over previous Docling baseline)
- **Architecture:** RT-DETR/DFINE transformer-based
- **Training data:** 150K diverse documents
- **Install:** `pip install docling`
- **Sources:** [HuggingFace](https://huggingface.co/docling-project/docling-layout-heron-101), [Paper](https://arxiv.org/abs/2509.11720)

## Cleanup Scope

### Delete
- `ocr/model_adapters/` (entire directory)
- `ocr/test_baseline.py`, `ocr/test_multi_model.py`, `ocr/test_dino_page6.py`, `ocr/batch_test_dino_yolo.py`
- `ocr/MULTI_MODEL_RESULTS.md`, `ocr/MULTI_MODEL_TESTING.md`
- `ocr/yolo26n.pt`
- `public/editions/multi_model_comparison/`, `public/editions/page6_model_comparison/`
- `public/editions/images/`
- `ocr/requirements-testing.txt`
- `ocr/batch_process.sh`, `ocr/monitor_progress.sh`, `ocr/validate_batch.py`
- `ocr/__pycache__/`

### Keep
- `ocr/convert_scans.py` (main pipeline, update later)
- `ocr/requirements.txt` (base deps, update later)
- `ocr/README.md` (documentation, update later)
- Source TIFFs in `public/editions/1988-04-13 The Transcript Delaware OH 1988-04-13/`
- `public/editions/1988-04-13/edition.json` (text extraction is good)

## Test Infrastructure

### Single script: `ocr/test_image_detection.py`

One self-contained script with inline model functions (no adapter pattern).

**Interface per model:** `detect(image_path) -> list[BoundingBox]`

**Flow:**
1. For each of 8 TIFF pages, for each of 3 models:
   - Load image, run detection, draw bounding boxes (color-coded)
   - Record: region count, box dimensions, confidence, inference time
2. Save combined comparison image (3 panels side-by-side) per page
3. Save JSON metrics and human-readable summary

### Output: `ocr/test_results/` (gitignored)
- `page_01_comparison.jpg` through `page_08_comparison.jpg`
- `summary.json` (counts, timing, per-model per-page stats)
- `summary.md` (human-readable comparison table)

### Dependencies: `ocr/requirements-models.txt`
```
paddlepaddle
paddleocr
surya-ocr
docling
Pillow
numpy
```

## Hardware

- M4 Mac (Apple Silicon)
- PaddlePaddle: CPU-only (no MPS), sufficient for 8 pages
- Surya: PyTorch with MPS acceleration
- Docling: PyTorch with MPS acceleration

## Success Criteria

Focus on page 6 (known problem page with charts/diagrams):

| Metric | Description |
|--------|-------------|
| Total detections | Raw bounding boxes before filtering |
| Figure detections | Boxes classified as figure/picture/chart |
| True positives | Detected regions containing actual visual content |
| False negatives | Visual content the model missed |
| Inference time | Seconds per page |

**Winner:** Model that finds the most true visual elements with fewest false positives.

## Next Steps

After benchmarking:
1. Select winning model
2. Replace DocLayout-YOLO in `convert_scans.py`
3. Re-run pipeline on the 1988-04-13 edition
4. Verify improved image extraction in the web app
