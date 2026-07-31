"""Centralized OCR constants."""

import os

YOLO_CONF_THRESHOLD = 0.3
YOLO_NMS_IOU_THRESHOLD = 0.3
YOLO_TABLE_CLASSES = {"table"}

AMERICAN_STORIES_INPUT_SIZE = 1280
# The frozen 1990 gold page 5 Mickey illustration scores 0.022.  At 0.02 the
# complete 12-page edition adds only that region and one reviewable candidate.
AMERICAN_STORIES_CONF_THRESHOLD = 0.02
AMERICAN_STORIES_NMS_IOU_THRESHOLD = 0.1
AMERICAN_STORIES_VISUAL_CLASS_IDS = {2, 8}  # cartoon/ad, photograph
HYBRID_FALLBACK_IOU_THRESHOLD = 0.1

MIN_REGION_AREA_PIXELS = 15000
MAX_REGION_AREA_PERCENT = 0.80
MIN_ASPECT_RATIO = 0.25
MAX_ASPECT_RATIO = 4.0

MIN_AD_IMAGE_AREA_PIXELS = 40000

IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".tif", ".tiff")
TIF_EXTENSIONS = (".tif", ".tiff")

DOCAI_CONFIDENCE_THRESHOLD = float(os.getenv("DOCAI_CONFIDENCE_THRESHOLD", "0.8"))
DOCAI_MAX_BYTES = 18 * 1024 * 1024  # 18MB — buffer under Document AI's 20MB hard limit
