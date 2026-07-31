"""Shared Google Gen AI client configuration for the OCR pipeline.

OCR uses Vertex AI with Application Default Credentials exclusively.  Keeping
the client construction here prevents a command-line entry point from quietly
falling back to a different account, endpoint, API version, or API key.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv


def _load_repo_env() -> None:
    repo_root = Path(__file__).resolve().parents[4]
    dotenv_path = repo_root / ".env.local"
    if dotenv_path.exists():
        load_dotenv(dotenv_path=dotenv_path)


def uses_vertex_ai() -> bool:
    """Return the pipeline's locked authentication mode."""
    return True


def has_google_ai_credentials() -> bool:
    _load_repo_env()
    return bool(os.getenv("GOOGLE_CLOUD_PROJECT"))


def create_genai_client():
    """Create a Google Gen AI client using the configured auth mode."""
    _load_repo_env()

    from google import genai
    from google.genai import types

    project = os.getenv("GOOGLE_CLOUD_PROJECT")
    if not project:
        raise RuntimeError(
            "GOOGLE_CLOUD_PROJECT is required for Vertex AI Application "
            "Default Credentials"
        )
    return genai.Client(
        vertexai=True,
        project=project,
        location="global",
        http_options=types.HttpOptions(
            api_version="v1",
            # The pipeline owns the three-attempt policy in shared.retry.
            retry_options=types.HttpRetryOptions(attempts=1),
        ),
    )


__all__ = [
    "create_genai_client",
    "has_google_ai_credentials",
    "uses_vertex_ai",
]
