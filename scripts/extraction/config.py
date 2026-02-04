"""
Configuration for the newspaper extraction pipeline.

This module provides centralized settings for:
- API credentials (Google Cloud Vision, Gemini)
- Processing parameters (YOLO confidence, image dimensions)
- Rate limiting and retry settings
- Output formats and quality settings

Settings are loaded from the .env file in the project root.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

# Base paths
BASE_DIR = Path(__file__).parent.parent.parent.absolute()

# Load .env file from project root
load_dotenv(BASE_DIR / ".env")
PUBLIC_DIR = BASE_DIR / "public"
EDITIONS_DIR = PUBLIC_DIR / "editions"
DATA_DIR = BASE_DIR / "data"
OCR_OUTPUT_DIR = DATA_DIR / "ocr-output"

# API Configuration
GOOGLE_CLOUD_CREDENTIALS = os.environ.get(
    "GOOGLE_APPLICATION_CREDENTIALS",
    str(BASE_DIR / "credentials" / "google-cloud-vision.json")
)

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

# Processing settings
MAX_IMAGE_DIMENSION = 4096  # Vision API limit
YOLO_CONFIDENCE_THRESHOLD = 0.4
YOLO_MIN_IMAGE_SIZE = 50  # Minimum pixels for extracted images
GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_TEMPERATURE = 0.1  # Low temperature for consistent extraction

# Rate limiting
VISION_API_DELAY_MS = 500
GEMINI_API_DELAY_MS = 1000
GEMINI_RATE_LIMIT_BASE_DELAY = 15  # Base delay (seconds) for rate limit backoff

# Output settings
JPEG_QUALITY = 95

# Article extraction thresholds
MIN_LEAD_STORY_LENGTH = 500  # Minimum chars for lead story consideration
MIN_FEATURED_LENGTH = 300    # Minimum chars for featured article consideration


def get_edition_paths(edition_id: str) -> dict:
    """Get all relevant paths for an edition."""
    edition_dir = EDITIONS_DIR / edition_id
    output_dir = OCR_OUTPUT_DIR / edition_id

    return {
        "edition_dir": edition_dir,
        "output_dir": output_dir,
        "pages_dir": output_dir / "pages",
        "images_dir": edition_dir / "extracted-images",
        "final_json": output_dir / "edition.json",
    }


def ensure_directories(edition_id: str) -> dict:
    """Create all necessary directories for an edition."""
    paths = get_edition_paths(edition_id)

    for key in ["output_dir", "pages_dir", "images_dir"]:
        paths[key].mkdir(parents=True, exist_ok=True)

    return paths
