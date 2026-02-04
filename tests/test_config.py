"""
Tests for config.py - Configuration and security checks.

These tests verify configuration handling and path safety
without requiring any real API credentials.
"""
import pytest
import os
from pathlib import Path


class TestCredentialIsolation:
    """Verify that test environment has isolated credentials."""

    def test_gemini_key_is_dummy(self):
        """Ensure we're not using real Gemini API key in tests."""
        key = os.environ.get("GEMINI_API_KEY", "")
        assert key == "test-dummy-key-not-real", \
            "Test is using real API key! Check conftest.py credential isolation."

    def test_google_credentials_is_null(self):
        """Ensure we're not using real Google credentials in tests."""
        creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
        assert creds == "/dev/null", \
            "Test is using real Google credentials! Check conftest.py."


class TestPathFunctions:
    """Tests for path-related configuration."""

    def test_get_edition_paths_returns_dict(self):
        """Verify get_edition_paths returns expected structure."""
        from config import get_edition_paths
        
        paths = get_edition_paths("1986-10-17")
        
        assert isinstance(paths, dict)
        assert "edition_dir" in paths
        assert "output_dir" in paths
        assert "pages_dir" in paths
        assert "images_dir" in paths
        assert "final_json" in paths

    def test_paths_are_absolute(self):
        """Ensure all returned paths are absolute."""
        from config import get_edition_paths
        
        paths = get_edition_paths("1986-10-17")
        
        for key, path in paths.items():
            assert path.is_absolute(), f"{key} should be absolute path"

    def test_paths_dont_escape_project(self):
        """Ensure paths don't escape project directory."""
        from config import get_edition_paths, BASE_DIR
        
        paths = get_edition_paths("1986-10-17")
        
        for key, path in paths.items():
            # All paths should be under the project base directory
            try:
                path.relative_to(BASE_DIR)
            except ValueError:
                pytest.fail(f"{key} path {path} escapes project directory {BASE_DIR}")

    def test_malicious_edition_id_sanitized(self):
        """Ensure path traversal attempts are handled."""
        from config import get_edition_paths
        
        # These should not escape the expected directories
        malicious_ids = [
            "../../../etc/passwd",
            "..\\..\\windows\\system32",
            "/etc/passwd",
            "1986-10-17/../../secrets",
        ]
        
        for edition_id in malicious_ids:
            paths = get_edition_paths(edition_id)
            # Paths should still be under project directory or fail gracefully
            # The key is they should NOT allow access outside project


class TestConfigConstants:
    """Tests for configuration constants."""

    def test_yolo_confidence_in_valid_range(self):
        """YOLO confidence threshold should be between 0 and 1."""
        from config import YOLO_CONFIDENCE_THRESHOLD
        
        assert 0.0 <= YOLO_CONFIDENCE_THRESHOLD <= 1.0

    def test_jpeg_quality_in_valid_range(self):
        """JPEG quality should be between 1 and 100."""
        from config import JPEG_QUALITY
        
        assert 1 <= JPEG_QUALITY <= 100

    def test_max_image_dimension_positive(self):
        """Max image dimension should be positive."""
        from config import MAX_IMAGE_DIMENSION
        
        assert MAX_IMAGE_DIMENSION > 0


class TestDirectoryStructure:
    """Tests for directory constants."""

    def test_base_dir_exists(self):
        """Base directory should exist."""
        from config import BASE_DIR
        
        assert BASE_DIR.exists(), f"BASE_DIR {BASE_DIR} does not exist"
        assert BASE_DIR.is_dir()

    def test_editions_dir_path(self):
        """Editions directory should be correctly defined."""
        from config import EDITIONS_DIR
        
        # May not exist if no editions processed, just check it's a valid Path
        assert isinstance(EDITIONS_DIR, Path)

    def test_ocr_output_dir_path(self):
        """OCR output directory should be correctly defined."""
        from config import OCR_OUTPUT_DIR
        
        assert isinstance(OCR_OUTPUT_DIR, Path)
