"""
Shared Gemini API utilities for OCR pipeline scripts.
"""

import time
import logging

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

# Transient HTTP status codes worth retrying
_RETRYABLE_STATUS_CODES = {429, 500, 503}

_MAX_RETRIES = 3
_BASE_DELAY_S = 2  # exponential: 2s, 4s, 8s


def gemini_generate_with_retry(
    client: genai.Client,
    *,
    model: str,
    contents: list,
    config: types.GenerateContentConfig,
) -> genai.types.GenerateContentResponse:
    """Wrapper around client.models.generate_content() with exponential backoff.

    Retries up to 3 times on transient errors (429, 500, 503).
    Re-raises after final failure.
    """
    last_exc: Exception | None = None

    for attempt in range(_MAX_RETRIES + 1):
        try:
            return client.models.generate_content(
                model=model,
                contents=contents,
                config=config,
            )
        except Exception as exc:
            # Check if this is a retryable API error
            if _is_retryable(exc) and attempt < _MAX_RETRIES:
                delay = _BASE_DELAY_S * (2 ** attempt)
                print(f"    [retry] Gemini API error ({exc}), retrying in {delay}s (attempt {attempt + 1}/{_MAX_RETRIES})...")
                time.sleep(delay)
                last_exc = exc
                continue
            raise

    # Should not reach here, but just in case
    raise last_exc  # type: ignore[misc]


def _is_retryable(exc: Exception) -> bool:
    """Check if an exception represents a transient, retryable Gemini API error."""
    # google-genai wraps API errors in google.api_core.exceptions classes
    # that have a `code` or `grpc_status_code` attribute.
    # Also handle raw HTTP errors with a status_code attribute.
    code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    if code is not None:
        try:
            return int(code) in _RETRYABLE_STATUS_CODES
        except (ValueError, TypeError):
            pass

    # google.api_core.exceptions.ServiceUnavailable, TooManyRequests, InternalServerError
    exc_type_name = type(exc).__name__
    retryable_names = {"TooManyRequests", "ResourceExhausted", "ServiceUnavailable", "InternalServerError"}
    if exc_type_name in retryable_names:
        return True

    # Check the string representation as a last resort
    exc_str = str(exc).lower()
    if any(term in exc_str for term in ["429", "500", "503", "rate limit", "resource exhausted"]):
        return True

    return False
