"""YOLO model provider and region detection stage."""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass

import numpy as np
from PIL import Image

from doclayout_yolo import YOLOv10

from ..config.constants import (
    MAX_ASPECT_RATIO,
    MAX_REGION_AREA_PERCENT,
    MIN_ASPECT_RATIO,
    MIN_REGION_AREA_PIXELS,
    YOLO_CONF_THRESHOLD,
    YOLO_NMS_IOU_THRESHOLD,
    YOLO_TABLE_CLASSES,
)
from ..config.paths import MODELS_DIR
from ..shared.console import status as console_status, info
from .region_filters import dedupe_overlapping_regions
from .models import RegionProposal

_YOLO_MODEL_PATH = str(MODELS_DIR / "doclayout_yolo_docstructbench_imgsz1024.pt")
_yolo_model: YOLOv10 | None = None
_yolo_lock = threading.Lock()


@dataclass
class DocLayoutDetection:
    total_detections: int
    filtered_by_class: int
    filtered_by_area: int
    filtered_by_aspect: int
    regions: list[tuple[int, int, int, int]]
    proposals: list[RegionProposal] | None = None


def _get_yolo_model() -> YOLOv10:
    """Load the DocLayout-YOLO model (cached after first call)."""
    global _yolo_model
    if _yolo_model is None:
        if not os.path.exists(_YOLO_MODEL_PATH):
            from huggingface_hub import hf_hub_download

            console_status("Downloading DocLayout-YOLO model...")
            hf_hub_download(
                repo_id="juliozhao/DocLayout-YOLO-DocStructBench",
                filename="doclayout_yolo_docstructbench_imgsz1024.pt",
                local_dir=os.path.dirname(_YOLO_MODEL_PATH),
            )
        console_status("Loading DocLayout-YOLO model...")
        _yolo_model = YOLOv10(_YOLO_MODEL_PATH)
    return _yolo_model


def get_yolo_model(settings: object | None = None) -> YOLOv10:
    del settings
    return _get_yolo_model()


def detect_doclayout_regions(
    image: Image.Image,
    accepted_classes: set[str],
) -> DocLayoutDetection:
    """Run DocLayout-YOLO and retain only the requested layout classes."""
    model = _get_yolo_model()
    with _yolo_lock:
        results = model.predict(
            image,
            imgsz=1024,
            conf=YOLO_CONF_THRESHOLD,
            iou=YOLO_NMS_IOU_THRESHOLD,
            verbose=False,
        )
    result = results[0]

    total_detections = len(result.boxes)
    candidates = []
    candidate_classes: dict[tuple[int, int, int, int], tuple[str, float]] = {}
    filtered_by_class = 0
    filtered_by_area = 0
    filtered_by_aspect = 0

    if total_detections > 0:
        boxes = result.boxes.xyxy.cpu().numpy()
        confs = result.boxes.conf.cpu().numpy()
        classes = result.boxes.cls.cpu().numpy().astype(int)

        preprocessed_img = np.array(image)
        page_height, page_width = preprocessed_img.shape[:2]
        page_area = page_height * page_width
        max_region_area = page_area * MAX_REGION_AREA_PERCENT

        for box, conf, cls in zip(boxes, confs, classes):
            class_name = result.names[cls]
            if class_name not in accepted_classes:
                filtered_by_class += 1
                continue

            x1, y1, x2, y2 = box
            region_width = int(x2 - x1)
            region_height = int(y2 - y1)
            region_area = region_width * region_height
            pct_of_page = (region_area / page_area) * 100

            info(
                f"DocLayout-YOLO detected {class_name}: {region_width}x{region_height} "
                f"({pct_of_page:.1f}% of page, conf={conf:.2f})"
            )

            if region_area < MIN_REGION_AREA_PIXELS or region_area > max_region_area:
                reason = "too small" if region_area < MIN_REGION_AREA_PIXELS else f"too large (>{MAX_REGION_AREA_PERCENT*100:.0f}%)"
                info(f"  ❌ FILTERED: {reason}")
                filtered_by_area += 1
                continue

            aspect_ratio = region_width / region_height if region_height > 0 else 0
            if aspect_ratio < MIN_ASPECT_RATIO or aspect_ratio > MAX_ASPECT_RATIO:
                info(f"  ❌ FILTERED: aspect ratio {aspect_ratio:.2f} out of range [{MIN_ASPECT_RATIO}-{MAX_ASPECT_RATIO}]")
                filtered_by_aspect += 1
                continue

            info("  ✅ KEPT")
            candidate = (int(y1), int(x1), int(y2), int(x2), float(conf))
            candidates.append(candidate)
            region_key = candidate[:4]
            if float(conf) >= candidate_classes.get(region_key, ("", -1.0))[1]:
                candidate_classes[region_key] = (class_name, float(conf))

    regions = dedupe_overlapping_regions(candidates, iou_threshold=0.5)
    proposals = [
        RegionProposal(
            bounds=region,
            detector="doclayout_yolo",
            class_name=candidate_classes[region][0],
            confidence=candidate_classes[region][1],
        )
        for region in regions
    ]

    return DocLayoutDetection(
        total_detections=total_detections,
        filtered_by_class=filtered_by_class,
        filtered_by_area=filtered_by_area,
        filtered_by_aspect=filtered_by_aspect,
        regions=regions,
        proposals=proposals,
    )


def detect_table_regions(image: Image.Image) -> DocLayoutDetection:
    """Detect table regions for the hybrid detector's conservative fallback."""
    return detect_doclayout_regions(image, YOLO_TABLE_CLASSES)


__all__ = [
    "DocLayoutDetection",
    "_get_yolo_model",
    "detect_doclayout_regions",
    "detect_table_regions",
    "get_yolo_model",
]
