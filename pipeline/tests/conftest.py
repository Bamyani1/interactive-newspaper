"""
Pytest configuration and shared fixtures.

SECURITY: This file sets dummy environment variables BEFORE any module imports
to ensure no real API credentials are loaded during test execution.
"""
import os
import sys
import json
import tempfile
from pathlib import Path

# ═══════════════════════════════════════════════════════════════════════════════
# SECURITY: Set dummy credentials BEFORE any imports that might load config
# ═══════════════════════════════════════════════════════════════════════════════
os.environ["GEMINI_API_KEY"] = "test-dummy-key-not-real"
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "/dev/null"
os.environ["DATABASE_URL"] = "file::memory:"

import pytest

# Add scripts/extraction to path for imports
REPO_ROOT = Path(__file__).parent.parent
EXTRACTION_DIR = REPO_ROOT / "scripts" / "extraction"
sys.path.insert(0, str(EXTRACTION_DIR))


# ═══════════════════════════════════════════════════════════════════════════════
# FIXTURES: Test Data
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.fixture
def fixtures_dir() -> Path:
    """Path to test fixtures directory."""
    return Path(__file__).parent / "fixtures"


@pytest.fixture
def sample_ocr_text() -> str:
    """Sample OCR text with common errors for testing postprocessing."""
    return """OWU beauties to grace calen-
dars

Christmas presents featuring campus faces will make a debut at
the OWU Bookstore in the first week of Decernber. Printed in limited
editions and sold for $10.50, you'll have to get these while they're hot.

A men's and a women's calendars with Ohio Wesleyan students
for all seasons are in the works. Seniors Melissa Batty and Luisa
Cestari said they wanted to do something different and get some
business experience to boot.

By SHAFALIKA SAXENA, Managing Editor

The story is a farniliar one to most Ohio Wesleyan students: You
want to make an important long distance phone call but after you
dial 05, you either get a busy signal, or the phone just rings,
and rings and rings.
"""


@pytest.fixture
def sample_articles_json() -> dict:
    """Sample curated articles JSON structure."""
    return {
        "page": 1,
        "articles": [
            {
                "headline": "OWU beauties to grace calendars",
                "category": "Features",
                "summary": "Seniors Melissa Batty and Luisa Cestari are producing calendars.",
                "fullText": "<p>Christmas presents featuring campus faces...</p>",
                "byline": "By SHAFALIKA SAXENA, Managing Editor",
                "relatedImages": ["p1-i1.jpg"],
                "imageCaption": "ENTREPRENEURS - Seniors creating calendars",
                "continuesOnPage": "5"
            },
            {
                "headline": "Long wait inevitable, says phone operator",
                "category": "News",
                "summary": "Students experience long waits when making calls.",
                "fullText": "<p>The story is a familiar one...</p>",
                "byline": "By BRIAN WALKER, News",
                "relatedImages": [],
                "imageCaption": None,
                "continuesOnPage": None
            }
        ]
    }


@pytest.fixture
def sample_edition_json() -> dict:
    """Sample complete edition JSON."""
    return {
        "edition": "1986-10-17",
        "pageCount": 12,
        "articleCount": 2,
        "articles": [
            {
                "id": "1986-10-17-p1-owu-beauties-to-grace-calendars",
                "date": "1986-10-17",
                "category": "Features",
                "headline": "OWU beauties to grace calendars",
                "summary": "Seniors creating calendars.",
                "fullText": "<p>Content here...</p>",
                "imageUrl": "/editions/1986-10-17/extracted-images/p1-i1.jpg",
                "byline": "By SHAFALIKA SAXENA",
                "page": 1,
                "isHero": True,
                "isFeatured": True,
                "imageCaption": "ENTREPRENEURS"
            }
        ]
    }


@pytest.fixture
def sample_image_metadata() -> dict:
    """Sample YOLO image extraction metadata."""
    return {
        "1": [
            {
                "filename": "p1-i1.jpg",
                "bbox": [100, 200, 400, 500],
                "confidence": 0.92,
                "page": 1,
                "class": "Picture"
            },
            {
                "filename": "p1-i2.jpg",
                "bbox": [500, 100, 800, 400],
                "confidence": 0.87,
                "page": 1,
                "class": "Picture"
            }
        ]
    }


@pytest.fixture
def temp_edition_dir(tmp_path: Path) -> Path:
    """Create a temporary edition directory structure."""
    edition_dir = tmp_path / "1986-10-17"
    pages_dir = edition_dir / "pages"
    images_dir = edition_dir / "extracted-images"
    
    edition_dir.mkdir(parents=True)
    pages_dir.mkdir()
    images_dir.mkdir()
    
    return edition_dir


# ═══════════════════════════════════════════════════════════════════════════════
# FIXTURES: Continuation Test Data
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.fixture
def articles_with_continuations() -> list:
    """Articles with continuation markers for testing merge logic."""
    return [
        {
            "raw": {
                "headline": "OWU shooting for level giving",
                "category": "Features",
                "fullText": "<p>How do you follow an act like that?</p>",
                "continuesOnPage": "8",
                "page": 1
            },
            "page": 1,
            "index": 0
        },
        {
            "raw": {
                "headline": "Faculty may see staff salaries",
                "category": "News",
                "fullText": "<p>The faculty asked...</p>",
                "continuesOnPage": None,
                "page": 4
            },
            "page": 4,
            "index": 0
        },
        {
            "raw": {
                "headline": "Giving",
                "category": "News",
                "fullText": "<p>will meet with other graduates...</p>",
                "continuesOnPage": None,
                "continuesFromPage": "1",
                "page": 8
            },
            "page": 8,
            "index": 0
        }
    ]
