"""Tests for shared Google Gen AI authentication configuration."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.config import google_clients


def test_vertex_client_uses_adc_project_and_location(monkeypatch):
    monkeypatch.setattr(google_clients, "_load_repo_env", lambda: None)
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "new-cloud-project")
    monkeypatch.setenv("GOOGLE_CLOUD_LOCATION", "us-central1")

    with patch("google.genai.Client") as client:
        google_clients.create_genai_client()

    kwargs = client.call_args.kwargs
    assert kwargs["vertexai"] is True
    assert kwargs["project"] == "new-cloud-project"
    assert kwargs["location"] == "global"
    assert "api_key" not in kwargs
    assert kwargs["http_options"].api_version == "v1"
    assert kwargs["http_options"].retry_options.attempts == 1


def test_vertex_configuration_requires_project(monkeypatch):
    monkeypatch.setattr(google_clients, "_load_repo_env", lambda: None)
    monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)

    assert google_clients.has_google_ai_credentials() is False


def test_api_keys_never_enable_a_non_vertex_fallback(monkeypatch):
    monkeypatch.setattr(google_clients, "_load_repo_env", lambda: None)
    monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)
    monkeypatch.setenv("GOOGLE_API_KEY", "compatibility-test-key")

    with patch("google.genai.Client"):
        import pytest

        with pytest.raises(RuntimeError, match="Application Default Credentials"):
            google_clients.create_genai_client()


def test_vertex_mode_is_locked_even_if_legacy_flag_is_false(monkeypatch):
    monkeypatch.setattr(google_clients, "_load_repo_env", lambda: None)
    monkeypatch.setenv("GOOGLE_GENAI_USE_VERTEXAI", "false")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "adc-project")

    with patch("google.genai.Client") as client:
        google_clients.create_genai_client()

    assert client.call_args.kwargs["vertexai"] is True
    assert "api_key" not in client.call_args.kwargs
