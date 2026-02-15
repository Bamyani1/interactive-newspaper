"""
Benchmark 3 image-detection models on 8 scanned newspaper TIFF pages.

Models tested:
  1. PP-DocLayout-L  (PaddlePaddle / PaddleOCR)
  2. Surya            (surya.detection)
  3. Docling Heron    (docling DocumentConverter)

Outputs (all written to ocr/test_results/):
  - page_NNNN_comparison.jpg   side-by-side visualisation per page
  - summary.json               machine-readable metrics
  - summary.md                 human-readable table

Usage:
    python ocr/test_image_detection.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone

from PIL import Image, ImageDraw, ImageFont


# ── Configuration ────────────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)

SOURCE_DIR = os.path.join(
    PROJECT_ROOT,
    "public",
    "editions",
    "1988-04-13 The Transcript Delaware OH 1988-04-13",
)

OUTPUT_DIR = os.path.join(SCRIPT_DIR, "test_results")

PAGE_FILES = [f"000{i}_Page {i}.tif" for i in range(1, 9)]

MODEL_COLORS = {
    "PP-DocLayout-L": (220, 40, 40),     # Red
    "Surya":          (40, 180, 40),      # Green
    "Docling":        (40, 80, 220),      # Blue
}

# Label categories that are likely image/figure/chart regions (lowercase).
# Each model uses different label vocabularies; we accept anything that looks
# like a visual element rather than pure text.
_FIGURE_LABELS = {
    "figure", "image", "photo", "picture", "chart", "diagram",
    "illustration", "map", "table", "graphic", "drawing",
    "painting", "cartoon", "caption",
}


# ── Data classes ─────────────────────────────────────────────────────


@dataclass
class BBox:
    """A single detected bounding box."""
    x_min: float
    y_min: float
    x_max: float
    y_max: float
    confidence: float
    label: str


@dataclass
class DetectionResult:
    """Result of running one model on one page."""
    model_name: str
    page_name: str
    boxes: list[BBox] = field(default_factory=list)
    inference_time_s: float = 0.0
    error: str = ""


# ── Font helper ──────────────────────────────────────────────────────


def _load_font(size: int = 18) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Try to load Helvetica on macOS, fall back to default bitmap font."""
    for path in (
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/SFNSMono.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


# ── Model 1: PP-DocLayout-L ─────────────────────────────────────────


def detect_ppdoclayout(image_path: str) -> list[BBox]:
    """Run PP-DocLayout-L layout detection and return BBox list."""
    # Try the newer LayoutDetection API first, fall back to PaddleOCR
    try:
        from paddleocr import LayoutDetection
        model = LayoutDetection(model_name="PP-DocLayout-L")
        output = model.predict(image_path, batch_size=1, layout_nms=True)
    except (ImportError, AttributeError, TypeError):
        from paddleocr import PaddleOCR
        model = PaddleOCR(use_angle_cls=False, lang="en", show_log=False)
        output = model.ocr(image_path, cls=False)

    boxes: list[BBox] = []

    if output is None:
        return boxes

    # The output format varies between PaddleOCR versions.  Walk every
    # plausible structure until we find coordinate data.
    results_list = output if isinstance(output, (list, tuple)) else [output]

    for result in results_list:
        # result might be a dict-like object, a list of dicts, or a custom class
        items = []

        # Case A: result has a .boxes attribute (LayoutDetection result object)
        if hasattr(result, "boxes"):
            items = result.boxes if isinstance(result.boxes, (list, tuple)) else [result.boxes]
        # Case B: result is iterable of box-like objects
        elif isinstance(result, (list, tuple)):
            items = result
        # Case C: single box-like object
        elif hasattr(result, "coordinate") or hasattr(result, "bbox"):
            items = [result]
        else:
            # Try treating the result itself as a dict
            if isinstance(result, dict):
                items = [result]
            else:
                continue

        for item in items:
            if item is None:
                continue

            coord = None
            label = "unknown"
            score = 0.0

            # Extract coordinates ------------------------------------------------
            # Attribute-style access (custom objects from PaddleOCR)
            if hasattr(item, "coordinate"):
                c = item.coordinate
                if isinstance(c, dict):
                    coord = (c.get("x_min", c.get("xmin", 0)),
                             c.get("y_min", c.get("ymin", 0)),
                             c.get("x_max", c.get("xmax", 0)),
                             c.get("y_max", c.get("ymax", 0)))
                elif isinstance(c, (list, tuple)) and len(c) >= 4:
                    coord = (c[0], c[1], c[2], c[3])
            elif hasattr(item, "bbox"):
                b = item.bbox
                if isinstance(b, (list, tuple)) and len(b) >= 4:
                    coord = (b[0], b[1], b[2], b[3])
                elif isinstance(b, dict):
                    coord = (b.get("x_min", b.get("xmin", 0)),
                             b.get("y_min", b.get("ymin", 0)),
                             b.get("x_max", b.get("xmax", 0)),
                             b.get("y_max", b.get("ymax", 0)))
            # Dict-style access
            elif isinstance(item, dict):
                if "coordinate" in item:
                    c = item["coordinate"]
                    if isinstance(c, (list, tuple)) and len(c) >= 4:
                        coord = (c[0], c[1], c[2], c[3])
                    elif isinstance(c, dict):
                        coord = (c.get("x_min", 0), c.get("y_min", 0),
                                 c.get("x_max", 0), c.get("y_max", 0))
                elif "bbox" in item:
                    b = item["bbox"]
                    if isinstance(b, (list, tuple)) and len(b) >= 4:
                        coord = (b[0], b[1], b[2], b[3])
                # Some versions return [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
                elif "points" in item:
                    pts = item["points"]
                    if isinstance(pts, (list, tuple)) and len(pts) >= 4:
                        xs = [p[0] for p in pts]
                        ys = [p[1] for p in pts]
                        coord = (min(xs), min(ys), max(xs), max(ys))

            # Extract label -------------------------------------------------------
            if hasattr(item, "label"):
                label = str(item.label)
            elif hasattr(item, "cls_name"):
                label = str(item.cls_name)
            elif isinstance(item, dict):
                label = str(item.get("label", item.get("cls_name", "unknown")))

            # Extract score -------------------------------------------------------
            if hasattr(item, "score"):
                score = float(item.score)
            elif hasattr(item, "confidence"):
                score = float(item.confidence)
            elif isinstance(item, dict):
                score = float(item.get("score", item.get("confidence", 0)))

            if coord is not None:
                boxes.append(BBox(
                    x_min=float(coord[0]),
                    y_min=float(coord[1]),
                    x_max=float(coord[2]),
                    y_max=float(coord[3]),
                    confidence=score,
                    label=label,
                ))

    return boxes


# ── Model 2: Surya ──────────────────────────────────────────────────


def detect_surya(image_path: str) -> list[BBox]:
    """Run Surya detection predictor and return BBox list."""
    from surya.detection import DetectionPredictor

    predictor = DetectionPredictor()
    image = Image.open(image_path).convert("RGB")
    predictions = predictor([image])

    boxes: list[BBox] = []

    if predictions is None:
        return boxes

    # predictions is typically a list (one entry per input image)
    pred_list = predictions if isinstance(predictions, (list, tuple)) else [predictions]

    for pred in pred_list:
        # pred may have .bboxes, .boxes, or be a dict
        items = []

        if hasattr(pred, "bboxes"):
            items = pred.bboxes if isinstance(pred.bboxes, (list, tuple)) else [pred.bboxes]
        elif hasattr(pred, "boxes"):
            items = pred.boxes if isinstance(pred.boxes, (list, tuple)) else [pred.boxes]
        elif isinstance(pred, dict):
            items = pred.get("bboxes", pred.get("boxes", []))
        elif isinstance(pred, (list, tuple)):
            items = pred
        else:
            continue

        for item in items:
            if item is None:
                continue

            coord = None
            label = "text"
            score = 0.0

            # Attribute-style
            if hasattr(item, "bbox"):
                b = item.bbox
                if isinstance(b, (list, tuple)) and len(b) >= 4:
                    coord = (b[0], b[1], b[2], b[3])
            elif hasattr(item, "polygon"):
                # Some Surya versions return polygon instead of bbox
                pts = item.polygon
                if isinstance(pts, (list, tuple)) and len(pts) >= 4:
                    xs = [p[0] if isinstance(p, (list, tuple)) else p for p in pts[::2]]
                    ys = [p[1] if isinstance(p, (list, tuple)) else p for p in pts[1::2]]
                    if isinstance(pts[0], (list, tuple)):
                        xs = [p[0] for p in pts]
                        ys = [p[1] for p in pts]
                    coord = (min(xs), min(ys), max(xs), max(ys))
            # Dict-style
            elif isinstance(item, dict):
                if "bbox" in item:
                    b = item["bbox"]
                    if isinstance(b, (list, tuple)) and len(b) >= 4:
                        coord = (b[0], b[1], b[2], b[3])
                elif "polygon" in item:
                    pts = item["polygon"]
                    if isinstance(pts, (list, tuple)) and len(pts) >= 3:
                        if isinstance(pts[0], (list, tuple)):
                            xs = [p[0] for p in pts]
                            ys = [p[1] for p in pts]
                        else:
                            xs = pts[::2]
                            ys = pts[1::2]
                        coord = (min(xs), min(ys), max(xs), max(ys))
            # Plain list/tuple of 4 numbers (bare bbox)
            elif isinstance(item, (list, tuple)) and len(item) >= 4:
                try:
                    coord = (float(item[0]), float(item[1]),
                             float(item[2]), float(item[3]))
                except (TypeError, ValueError):
                    pass

            # Extract label
            if hasattr(item, "label"):
                label = str(item.label)
            elif isinstance(item, dict):
                label = str(item.get("label", "text"))

            # Extract confidence
            if hasattr(item, "confidence"):
                score = float(item.confidence)
            elif hasattr(item, "score"):
                score = float(item.score)
            elif isinstance(item, dict):
                score = float(item.get("confidence", item.get("score", 0)))

            if coord is not None:
                boxes.append(BBox(
                    x_min=float(coord[0]),
                    y_min=float(coord[1]),
                    x_max=float(coord[2]),
                    y_max=float(coord[3]),
                    confidence=score,
                    label=label,
                ))

    return boxes


# ── Model 3: Docling (Heron-101) ────────────────────────────────────


def detect_docling(image_path: str) -> list[BBox]:
    """Run Docling DocumentConverter and return BBox list."""
    from docling.document_converter import DocumentConverter

    converter = DocumentConverter()
    result = converter.convert(image_path)

    boxes: list[BBox] = []

    if result is None:
        return boxes

    # Navigate to layout predictions.  The structure is:
    #   result.document.pages[*].predictions["layout"].clusters[*]
    # but we try multiple paths defensively.

    pages = None

    # Try result.document.pages
    if hasattr(result, "document") and hasattr(result.document, "pages"):
        pages_attr = result.document.pages
        if isinstance(pages_attr, dict):
            pages = list(pages_attr.values())
        elif isinstance(pages_attr, (list, tuple)):
            pages = list(pages_attr)

    # Fall back to result.pages
    if pages is None and hasattr(result, "pages"):
        pages_attr = result.pages
        if isinstance(pages_attr, dict):
            pages = list(pages_attr.values())
        elif isinstance(pages_attr, (list, tuple)):
            pages = list(pages_attr)

    if pages is None:
        # Last resort: look for clusters directly on result
        if hasattr(result, "clusters"):
            pages = [result]
        else:
            return boxes

    for page in pages:
        clusters = []

        # Standard path: page.predictions["layout"].clusters
        if hasattr(page, "predictions"):
            preds = page.predictions
            if isinstance(preds, dict) and "layout" in preds:
                layout = preds["layout"]
                if hasattr(layout, "clusters"):
                    clusters = layout.clusters
                elif isinstance(layout, dict):
                    clusters = layout.get("clusters", [])
            elif isinstance(preds, dict):
                # Try each prediction entry
                for key, val in preds.items():
                    if hasattr(val, "clusters"):
                        clusters.extend(val.clusters)
                    elif isinstance(val, dict) and "clusters" in val:
                        clusters.extend(val["clusters"])

        # Alternate: page.clusters
        if not clusters and hasattr(page, "clusters"):
            clusters = page.clusters

        # Alternate: page.layout.clusters
        if not clusters and hasattr(page, "layout"):
            layout = page.layout
            if hasattr(layout, "clusters"):
                clusters = layout.clusters

        for cluster in clusters:
            if cluster is None:
                continue

            coord = None
            label = "unknown"
            score = 0.0

            # Extract bbox -- Docling uses (l, t, r, b) format
            if hasattr(cluster, "bbox"):
                b = cluster.bbox
                if hasattr(b, "l"):
                    coord = (b.l, b.t, b.r, b.b)
                elif isinstance(b, (list, tuple)) and len(b) >= 4:
                    coord = (b[0], b[1], b[2], b[3])
                elif isinstance(b, dict):
                    coord = (b.get("l", b.get("x_min", 0)),
                             b.get("t", b.get("y_min", 0)),
                             b.get("r", b.get("x_max", 0)),
                             b.get("b", b.get("y_max", 0)))
            elif isinstance(cluster, dict) and "bbox" in cluster:
                b = cluster["bbox"]
                if isinstance(b, (list, tuple)) and len(b) >= 4:
                    coord = (b[0], b[1], b[2], b[3])
                elif isinstance(b, dict):
                    coord = (b.get("l", 0), b.get("t", 0),
                             b.get("r", 0), b.get("b", 0))

            # Extract label
            if hasattr(cluster, "label"):
                lbl = cluster.label
                # Docling labels can be enum-like objects
                label = str(lbl.value) if hasattr(lbl, "value") else str(lbl)
            elif isinstance(cluster, dict):
                lbl = cluster.get("label", "unknown")
                label = str(lbl.value) if hasattr(lbl, "value") else str(lbl)

            # Extract confidence
            if hasattr(cluster, "confidence"):
                score = float(cluster.confidence)
            elif hasattr(cluster, "score"):
                score = float(cluster.score)
            elif isinstance(cluster, dict):
                score = float(cluster.get("confidence", cluster.get("score", 0)))

            if coord is not None:
                boxes.append(BBox(
                    x_min=float(coord[0]),
                    y_min=float(coord[1]),
                    x_max=float(coord[2]),
                    y_max=float(coord[3]),
                    confidence=score,
                    label=label,
                ))

    return boxes


# ── Orchestration ────────────────────────────────────────────────────


DETECT_FUNCTIONS = {
    "PP-DocLayout-L": detect_ppdoclayout,
    "Surya":          detect_surya,
    "Docling":        detect_docling,
}


def run_detection(model_name: str, image_path: str, page_name: str) -> DetectionResult:
    """Run a single model on a single page, capturing errors gracefully."""
    detect_fn = DETECT_FUNCTIONS[model_name]
    t0 = time.time()
    try:
        boxes = detect_fn(image_path)
        elapsed = time.time() - t0
        return DetectionResult(
            model_name=model_name,
            page_name=page_name,
            boxes=boxes,
            inference_time_s=elapsed,
        )
    except Exception as exc:
        elapsed = time.time() - t0
        tb = traceback.format_exc()
        print(f"  [ERROR] {model_name} on {page_name}: {exc}")
        return DetectionResult(
            model_name=model_name,
            page_name=page_name,
            inference_time_s=elapsed,
            error=f"{exc}\n{tb}",
        )


# ── Visualisation ────────────────────────────────────────────────────


def draw_boxes_on_image(
    image: Image.Image,
    boxes: list[BBox],
    color: tuple[int, int, int],
    model_label: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
) -> Image.Image:
    """Draw labelled bounding boxes on a copy of *image*."""
    img = image.copy().convert("RGB")
    draw = ImageDraw.Draw(img)

    w, h = img.size
    line_width = max(2, min(w, h) // 400)

    for box in boxes:
        draw.rectangle(
            [(box.x_min, box.y_min), (box.x_max, box.y_max)],
            outline=color,
            width=line_width,
        )
        text = f"{box.label} {box.confidence:.2f}"
        text_bbox = font.getbbox(text)
        text_w = text_bbox[2] - text_bbox[0]
        text_h = text_bbox[3] - text_bbox[1]
        pad = 2
        # Background rectangle for readability
        draw.rectangle(
            [(box.x_min, max(0, box.y_min - text_h - 2 * pad)),
             (box.x_min + text_w + 2 * pad, box.y_min)],
            fill=color,
        )
        draw.text(
            (box.x_min + pad, max(0, box.y_min - text_h - pad)),
            text,
            fill="white",
            font=font,
        )

    # Model label in top-left corner
    title_font = font
    title_bbox = title_font.getbbox(model_label)
    title_w = title_bbox[2] - title_bbox[0]
    title_h = title_bbox[3] - title_bbox[1]
    draw.rectangle([(0, 0), (title_w + 12, title_h + 12)], fill=color)
    draw.text((6, 6), model_label, fill="white", font=title_font)

    return img


def create_comparison_image(
    page_image: Image.Image,
    results: list[DetectionResult],
    output_path: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
) -> None:
    """Create a side-by-side comparison JPEG of all models for one page."""
    panels: list[Image.Image] = []

    # Determine a uniform thumbnail height (max 2000px to keep file size sane)
    target_h = min(page_image.size[1], 2000)

    for result in results:
        color = MODEL_COLORS.get(result.model_name, (200, 200, 200))
        if result.error:
            # Create an error placeholder panel
            panel = Image.new("RGB", (int(target_h * 0.7), target_h), (40, 40, 40))
            draw = ImageDraw.Draw(panel)
            draw.text((20, 20), f"{result.model_name}\nERROR", fill="red", font=font)
        else:
            panel = draw_boxes_on_image(page_image, result.boxes, color, result.model_name, font)
            # Resize to uniform height
            scale = target_h / panel.size[1]
            panel = panel.resize(
                (int(panel.size[0] * scale), target_h),
                Image.LANCZOS,
            )
        panels.append(panel)

    if not panels:
        return

    total_w = sum(p.size[0] for p in panels)
    combined = Image.new("RGB", (total_w, target_h), (30, 30, 30))
    x_offset = 0
    for panel in panels:
        combined.paste(panel, (x_offset, 0))
        x_offset += panel.size[0]

    combined.save(output_path, "JPEG", quality=85)
    print(f"  Saved comparison: {output_path}")


# ── Reporting ────────────────────────────────────────────────────────


def _is_figure_label(label: str) -> bool:
    """Return True if the label looks like an image/figure region."""
    return label.lower().strip() in _FIGURE_LABELS


def build_summary(all_results: list[DetectionResult]) -> dict:
    """Build a summary dict from all detection results."""
    model_names = list(DETECT_FUNCTIONS.keys())

    per_page: dict[str, dict] = {}
    per_model: dict[str, dict] = {m: {
        "total_boxes": 0,
        "figure_boxes": 0,
        "total_time_s": 0.0,
        "pages_succeeded": 0,
        "pages_failed": 0,
        "errors": [],
    } for m in model_names}

    for r in all_results:
        # Per-page grouping
        if r.page_name not in per_page:
            per_page[r.page_name] = {}
        figure_count = sum(1 for b in r.boxes if _is_figure_label(b.label))
        per_page[r.page_name][r.model_name] = {
            "total_boxes": len(r.boxes),
            "figure_boxes": figure_count,
            "inference_time_s": round(r.inference_time_s, 2),
            "error": r.error[:200] if r.error else "",
            "labels": _label_counts(r.boxes),
        }

        # Per-model aggregation
        pm = per_model[r.model_name]
        pm["total_boxes"] += len(r.boxes)
        pm["figure_boxes"] += figure_count
        pm["total_time_s"] += r.inference_time_s
        if r.error:
            pm["pages_failed"] += 1
            pm["errors"].append(f"{r.page_name}: {r.error[:120]}")
        else:
            pm["pages_succeeded"] += 1

    # Round times
    for pm in per_model.values():
        pm["total_time_s"] = round(pm["total_time_s"], 2)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_dir": SOURCE_DIR,
        "pages": len(PAGE_FILES),
        "models": model_names,
        "per_page": per_page,
        "per_model": per_model,
    }


def _label_counts(boxes: list[BBox]) -> dict[str, int]:
    """Count occurrences of each label."""
    counts: dict[str, int] = {}
    for b in boxes:
        counts[b.label] = counts.get(b.label, 0) + 1
    return dict(sorted(counts.items(), key=lambda kv: -kv[1]))


def write_summary_json(summary: dict, path: str) -> None:
    """Write summary.json."""
    with open(path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, default=str)
    print(f"Wrote {path}")


def write_summary_md(summary: dict, path: str) -> None:
    """Write summary.md with human-readable tables."""
    lines: list[str] = []
    lines.append("# Image Detection Benchmark Results")
    lines.append("")
    lines.append(f"Generated: {summary['generated_at']}")
    lines.append(f"Source: `{summary['source_dir']}`")
    lines.append(f"Pages: {summary['pages']}")
    lines.append("")

    # ── Per-model overview table ──
    lines.append("## Model Summary")
    lines.append("")
    lines.append("| Model | Pages OK | Pages Failed | Total Boxes | Figure Boxes | Total Time (s) |")
    lines.append("|-------|----------|--------------|-------------|--------------|----------------|")

    for model_name in summary["models"]:
        pm = summary["per_model"][model_name]
        lines.append(
            f"| {model_name} "
            f"| {pm['pages_succeeded']} "
            f"| {pm['pages_failed']} "
            f"| {pm['total_boxes']} "
            f"| {pm['figure_boxes']} "
            f"| {pm['total_time_s']:.1f} |"
        )

    lines.append("")

    # ── Per-page detail table ──
    lines.append("## Per-Page Detail")
    lines.append("")
    lines.append("| Page | Model | Boxes | Figures | Time (s) | Error |")
    lines.append("|------|-------|-------|---------|----------|-------|")

    for page_name in sorted(summary["per_page"].keys()):
        page_data = summary["per_page"][page_name]
        for model_name in summary["models"]:
            md = page_data.get(model_name, {})
            error_short = md.get("error", "")[:60].replace("|", "/")
            lines.append(
                f"| {page_name} "
                f"| {model_name} "
                f"| {md.get('total_boxes', '-')} "
                f"| {md.get('figure_boxes', '-')} "
                f"| {md.get('inference_time_s', '-')} "
                f"| {error_short or '-'} |"
            )

    lines.append("")

    # ── Label distribution per model ──
    lines.append("## Label Distribution (all pages)")
    lines.append("")

    for model_name in summary["models"]:
        lines.append(f"### {model_name}")
        lines.append("")
        combined_labels: dict[str, int] = {}
        for page_data in summary["per_page"].values():
            md = page_data.get(model_name, {})
            for label, count in md.get("labels", {}).items():
                combined_labels[label] = combined_labels.get(label, 0) + count

        if combined_labels:
            lines.append("| Label | Count |")
            lines.append("|-------|-------|")
            for label, count in sorted(combined_labels.items(), key=lambda kv: -kv[1]):
                is_fig = " *" if _is_figure_label(label) else ""
                lines.append(f"| {label}{is_fig} | {count} |")
        else:
            lines.append("No detections.")

        lines.append("")

    lines.append("---")
    lines.append("*Labels marked with * are counted as figure/image regions.*")
    lines.append("")

    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"Wrote {path}")


# ── Main ─────────────────────────────────────────────────────────────


def main() -> None:
    print("=" * 60)
    print("Image Detection Benchmark")
    print("=" * 60)

    # Validate source directory
    if not os.path.isdir(SOURCE_DIR):
        print(f"ERROR: Source directory not found: {SOURCE_DIR}")
        sys.exit(1)

    # Validate all page files exist
    missing = [f for f in PAGE_FILES if not os.path.isfile(os.path.join(SOURCE_DIR, f))]
    if missing:
        print(f"ERROR: Missing page files: {missing}")
        sys.exit(1)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    font = _load_font(size=16)
    all_results: list[DetectionResult] = []

    total_start = time.time()

    for page_file in PAGE_FILES:
        page_path = os.path.join(SOURCE_DIR, page_file)
        page_name = os.path.splitext(page_file)[0]  # e.g. "0001_Page 1"
        page_key = page_file[:4]                      # e.g. "0001"

        print(f"\n--- {page_name} ---")

        # Load image once for visualisation
        try:
            page_image = Image.open(page_path).convert("RGB")
        except Exception as exc:
            print(f"  [ERROR] Could not open {page_path}: {exc}")
            for model_name in DETECT_FUNCTIONS:
                all_results.append(DetectionResult(
                    model_name=model_name,
                    page_name=page_name,
                    error=f"Could not open image: {exc}",
                ))
            continue

        page_results: list[DetectionResult] = []

        for model_name in DETECT_FUNCTIONS:
            print(f"  Running {model_name}...")
            result = run_detection(model_name, page_path, page_name)
            page_results.append(result)
            all_results.append(result)

            if result.error:
                print(f"    FAILED ({result.inference_time_s:.1f}s)")
            else:
                fig_count = sum(1 for b in result.boxes if _is_figure_label(b.label))
                print(f"    {len(result.boxes)} boxes ({fig_count} figures) in {result.inference_time_s:.1f}s")

        # Create comparison image
        comparison_path = os.path.join(OUTPUT_DIR, f"page_{page_key}_comparison.jpg")
        try:
            create_comparison_image(page_image, page_results, comparison_path, font)
        except Exception as exc:
            print(f"  [ERROR] Could not create comparison image: {exc}")

    total_elapsed = time.time() - total_start

    # Generate reports
    print(f"\n{'=' * 60}")
    print(f"Total time: {total_elapsed:.1f}s")
    print(f"{'=' * 60}")

    summary = build_summary(all_results)
    summary["total_time_s"] = round(total_elapsed, 2)

    write_summary_json(summary, os.path.join(OUTPUT_DIR, "summary.json"))
    write_summary_md(summary, os.path.join(OUTPUT_DIR, "summary.md"))

    # Print quick overview to stdout
    print("\nQuick overview:")
    for model_name in DETECT_FUNCTIONS:
        pm = summary["per_model"][model_name]
        print(f"  {model_name:20s}  OK={pm['pages_succeeded']}  FAIL={pm['pages_failed']}  "
              f"boxes={pm['total_boxes']}  figures={pm['figure_boxes']}  "
              f"time={pm['total_time_s']:.1f}s")

    print("\nDone. Results in:", OUTPUT_DIR)


if __name__ == "__main__":
    main()
