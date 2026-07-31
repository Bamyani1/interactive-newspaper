"""American Stories newspaper-layout detector (ONNX, evaluation path)."""

from __future__ import annotations

import hashlib
import os
import shutil
import threading
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image

from ..config.constants import (
    AMERICAN_STORIES_CONF_THRESHOLD,
    AMERICAN_STORIES_INPUT_SIZE,
    AMERICAN_STORIES_NMS_IOU_THRESHOLD,
    AMERICAN_STORIES_VISUAL_CLASS_IDS,
    MAX_ASPECT_RATIO,
    MAX_REGION_AREA_PERCENT,
    MIN_ASPECT_RATIO,
    MIN_REGION_AREA_PIXELS,
)
from ..config.paths import MODELS_DIR
from ..shared.console import info, status
from .region_filters import dedupe_overlapping_regions
from .models import RegionProposal

_MODEL_FILENAME = "american_stories_layout_model_new.onnx"
_MODEL_SHA256 = "045b2e5588e53c700490730244bdc3e8ff21e903aff1c2af9b169dcdb1d9155e"
_MODEL_URL = (
    "https://www.dropbox.com/scl/fo/o46asvqtxf9rslyv1oaon/"
    "AOTUgwD-QKa0D62jzpy9gXQ/layout_model_new.onnx?dl=1&rlkey=kkeirmft1rfvm2zvvwgz0091u"
)

_session: Any | None = None
_session_lock = threading.Lock()


@dataclass
class AmericanStoriesDetection:
    total_detections: int
    filtered_by_class: int
    filtered_by_area: int
    filtered_by_aspect: int
    regions: list[tuple[int, int, int, int]]
    proposals: list[RegionProposal] | None = None


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _get_model_path() -> Path:
    configured = os.getenv("AMERICAN_STORIES_MODEL_PATH", "").strip()
    return Path(configured).expanduser() if configured else MODELS_DIR / _MODEL_FILENAME


def _ensure_model(path: Path) -> None:
    if path.exists():
        actual = _sha256(path)
        if actual != _MODEL_SHA256:
            raise RuntimeError(
                f"American Stories model checksum mismatch at {path}: "
                f"expected {_MODEL_SHA256}, got {actual}"
            )
        return

    if os.getenv("AMERICAN_STORIES_MODEL_PATH", "").strip():
        raise FileNotFoundError(f"American Stories model not found: {path}")

    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(path.suffix + ".download")
    status("Downloading American Stories layout model...")
    request = urllib.request.Request(_MODEL_URL, headers={"User-Agent": "TranscriptOCR/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response, partial.open("wb") as output:
            shutil.copyfileobj(response, output)
        actual = _sha256(partial)
        if actual != _MODEL_SHA256:
            raise RuntimeError(
                f"Downloaded American Stories model checksum mismatch: "
                f"expected {_MODEL_SHA256}, got {actual}"
            )
        os.replace(partial, path)
    finally:
        if partial.exists():
            partial.unlink()


def _get_american_stories_session() -> Any:
    """Load and cache the official American Stories layout checkpoint."""
    global _session
    with _session_lock:
        if _session is None:
            try:
                import onnxruntime as ort
            except ImportError as exc:
                raise RuntimeError(
                    "Hybrid visual detection requires onnxruntime; install ocr/requirements.txt"
                ) from exc
            model_path = _get_model_path()
            _ensure_model(model_path)
            status("Loading American Stories layout model...")
            _session = ort.InferenceSession(
                str(model_path),
                providers=["CPUExecutionProvider"],
            )
    return _session


def _letterbox(image: np.ndarray, size: int) -> tuple[np.ndarray, float, tuple[float, float]]:
    """Resize and symmetrically pad an RGB image to a square model input."""
    height, width = image.shape[:2]
    ratio = min(size / height, size / width)
    resized_width = int(round(width * ratio))
    resized_height = int(round(height * ratio))
    if (resized_width, resized_height) != (width, height):
        image = cv2.resize(image, (resized_width, resized_height), interpolation=cv2.INTER_LINEAR)

    pad_x = (size - resized_width) / 2
    pad_y = (size - resized_height) / 2
    left, right = int(round(pad_x - 0.1)), int(round(pad_x + 0.1))
    top, bottom = int(round(pad_y - 0.1)), int(round(pad_y + 0.1))
    padded = cv2.copyMakeBorder(
        image,
        top,
        bottom,
        left,
        right,
        cv2.BORDER_CONSTANT,
        value=(114, 114, 114),
    )
    return padded, ratio, (pad_x, pad_y)


def _box_iou(box: np.ndarray, boxes: np.ndarray) -> np.ndarray:
    x1 = np.maximum(box[0], boxes[:, 0])
    y1 = np.maximum(box[1], boxes[:, 1])
    x2 = np.minimum(box[2], boxes[:, 2])
    y2 = np.minimum(box[3], boxes[:, 3])
    intersection = np.maximum(0.0, x2 - x1) * np.maximum(0.0, y2 - y1)
    box_area = max(0.0, float(box[2] - box[0])) * max(0.0, float(box[3] - box[1]))
    areas = np.maximum(0.0, boxes[:, 2] - boxes[:, 0]) * np.maximum(0.0, boxes[:, 3] - boxes[:, 1])
    union = box_area + areas - intersection
    return np.divide(intersection, union, out=np.zeros_like(intersection), where=union > 0)


def _nms(boxes: np.ndarray, scores: np.ndarray, threshold: float, max_detections: int) -> list[int]:
    order = scores.argsort()[::-1]
    kept: list[int] = []
    while order.size and len(kept) < max_detections:
        current = int(order[0])
        kept.append(current)
        if order.size == 1:
            break
        remaining = order[1:]
        order = remaining[_box_iou(boxes[current], boxes[remaining]) <= threshold]
    return kept


def _decode_predictions(
    output: np.ndarray,
    confidence_threshold: float,
    iou_threshold: float,
) -> list[tuple[np.ndarray, float, int]]:
    """Decode the checkpoint's YOLOv8 ``[1, 14, N]`` output."""
    prediction = np.asarray(output)
    if prediction.ndim == 3:
        prediction = prediction[0]
    if prediction.ndim != 2:
        raise RuntimeError(f"Unexpected American Stories output shape: {prediction.shape}")
    if prediction.shape[0] == 14:
        prediction = prediction.T
    elif prediction.shape[1] != 14:
        raise RuntimeError(f"Unexpected American Stories output shape: {prediction.shape}")

    class_scores = prediction[:, 4:]
    class_ids = class_scores.argmax(axis=1)
    scores = class_scores[np.arange(class_scores.shape[0]), class_ids]
    valid = (scores >= confidence_threshold) & np.isfinite(prediction).all(axis=1)
    prediction = prediction[valid]
    scores = scores[valid]
    class_ids = class_ids[valid]
    if prediction.shape[0] == 0:
        return []

    xywh = prediction[:, :4]
    boxes = np.empty_like(xywh)
    boxes[:, 0] = xywh[:, 0] - xywh[:, 2] / 2
    boxes[:, 1] = xywh[:, 1] - xywh[:, 3] / 2
    boxes[:, 2] = xywh[:, 0] + xywh[:, 2] / 2
    boxes[:, 3] = xywh[:, 1] + xywh[:, 3] / 2

    kept = _nms(boxes, scores, iou_threshold, max_detections=2000)
    return [(boxes[index], float(scores[index]), int(class_ids[index])) for index in kept]


def detect_american_stories_regions(image: Image.Image) -> AmericanStoriesDetection:
    """Detect newspaper ads, cartoons/illustrations, and photographs."""
    rgb = np.asarray(image.convert("RGB"))
    page_height, page_width = rgb.shape[:2]
    model_image, ratio, (pad_x, pad_y) = _letterbox(rgb, AMERICAN_STORIES_INPUT_SIZE)
    tensor = np.expand_dims(model_image.transpose(2, 0, 1), axis=0).astype(np.float32) / 255.0
    tensor = np.ascontiguousarray(tensor)

    session = _get_american_stories_session()
    input_name = session.get_inputs()[0].name
    with _session_lock:
        output = session.run(None, {input_name: tensor})[0]
    detections = _decode_predictions(
        output,
        AMERICAN_STORIES_CONF_THRESHOLD,
        AMERICAN_STORIES_NMS_IOU_THRESHOLD,
    )

    candidates: list[tuple[int, int, int, int, float]] = []
    candidate_classes: dict[tuple[int, int, int, int], tuple[int, float]] = {}
    filtered_by_class = 0
    filtered_by_area = 0
    filtered_by_aspect = 0
    page_area = page_width * page_height
    for box, confidence, class_id in detections:
        if class_id not in AMERICAN_STORIES_VISUAL_CLASS_IDS:
            filtered_by_class += 1
            continue

        x1 = max(0, min(page_width, int(np.floor((box[0] - pad_x) / ratio))))
        y1 = max(0, min(page_height, int(np.floor((box[1] - pad_y) / ratio))))
        x2 = max(0, min(page_width, int(np.ceil((box[2] - pad_x) / ratio))))
        y2 = max(0, min(page_height, int(np.ceil((box[3] - pad_y) / ratio))))
        width, height = x2 - x1, y2 - y1
        area = width * height
        if area < MIN_REGION_AREA_PIXELS or area > page_area * MAX_REGION_AREA_PERCENT:
            filtered_by_area += 1
            continue
        aspect = width / height if height > 0 else 0.0
        if aspect < MIN_ASPECT_RATIO or aspect > MAX_ASPECT_RATIO:
            filtered_by_aspect += 1
            continue
        candidates.append((y1, x1, y2, x2, confidence))
        region_key = (y1, x1, y2, x2)
        if confidence >= candidate_classes.get(region_key, (-1, -1.0))[1]:
            candidate_classes[region_key] = (class_id, confidence)

    regions = dedupe_overlapping_regions(candidates, iou_threshold=0.5)
    proposals = [
        RegionProposal(
            bounds=region,
            detector="american_stories",
            class_name={2: "cartoon_or_ad", 8: "photograph"}.get(
                candidate_classes[region][0], f"class_{candidate_classes[region][0]}"
            ),
            confidence=candidate_classes[region][1],
        )
        for region in regions
    ]
    info(
        f"American Stories: {len(detections)} layout detections, "
        f"{len(regions)} visual candidate(s) kept"
    )
    return AmericanStoriesDetection(
        total_detections=len(detections),
        filtered_by_class=filtered_by_class,
        filtered_by_area=filtered_by_area,
        filtered_by_aspect=filtered_by_aspect,
        regions=regions,
        proposals=proposals,
    )


__all__ = [
    "AmericanStoriesDetection",
    "_decode_predictions",
    "_get_american_stories_session",
    "_letterbox",
    "detect_american_stories_regions",
]
