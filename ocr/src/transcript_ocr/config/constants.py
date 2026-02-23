"""Centralized OCR constants."""

import os

GEMINI_PAGE_MODEL = "gemini-3-flash-preview"
GEMINI_MERGE_MODEL = "gemini-3.1-pro-preview"
GEMINI_AD_ENRICHMENT_MODEL = "gemini-3-flash-preview"

# Back-compat alias while modules migrate.
GEMINI_MODEL = GEMINI_PAGE_MODEL

YOLO_CONF_THRESHOLD = 0.3
YOLO_NMS_IOU_THRESHOLD = 0.3
YOLO_FIGURE_CLASSES = {"figure"}

MIN_REGION_AREA_PIXELS = 15000
MAX_REGION_AREA_PERCENT = 0.80
MIN_ASPECT_RATIO = 0.25
MAX_ASPECT_RATIO = 4.0

MIN_AD_IMAGE_AREA_PIXELS = 40000

IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".tif", ".tiff")

DOCAI_CONFIDENCE_THRESHOLD = float(os.getenv("DOCAI_CONFIDENCE_THRESHOLD", "0.8"))
DOCAI_MAX_BYTES = 18 * 1024 * 1024  # 18MB — buffer under Document AI's 20MB hard limit
DOCAI_CLAHE_CLIP_LIMIT = 2.0        # CLAHE clip limit; higher = more contrast, more noise risk
DOCAI_CLAHE_TILE_SIZE = (8, 8)      # CLAHE grid tile size
