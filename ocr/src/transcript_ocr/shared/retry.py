"""Retry helpers for Gemini API calls."""

from __future__ import annotations

import os
import time
import logging
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError

from google import genai
from google.genai import types

from .console import warning as _console_warning

logger = logging.getLogger(__name__)

# Transient HTTP status codes worth retrying
_RETRYABLE_STATUS_CODES = {429, 500, 503}

_MAX_RETRIES = 3
_BASE_DELAY_S = 2  # exponential: 2s, 4s, 8s
_REQUEST_TIMEOUT_S = int(os.getenv("GEMINI_REQUEST_TIMEOUT_S", "240"))


def _generate_content_with_timeout(
    client: genai.Client,
    *,
    model: str,
    contents: list,
    config: types.GenerateContentConfig,
) -> genai.types.GenerateContentResponse:
    """Call Gemini with an optional timeout guard.

    Set GEMINI_REQUEST_TIMEOUT_S=0 to disable timeout enforcement.
    """
    if _REQUEST_TIMEOUT_S <= 0:
        return client.models.generate_content(
            model=model,
            contents=contents,
            config=config,
        )

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(
            client.models.generate_content,
            model=model,
            contents=contents,
            config=config,
        )
        try:
            return future.result(timeout=_REQUEST_TIMEOUT_S)
        except FuturesTimeoutError as exc:
            raise TimeoutError(
                f"Gemini call timed out after {_REQUEST_TIMEOUT_S}s"
            ) from exc


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
            return _generate_content_with_timeout(
                client,
                model=model,
                contents=contents,
                config=config,
            )
        except Exception as exc:
            # Check if this is a retryable API error
            if _is_retryable(exc) and attempt < _MAX_RETRIES:
                delay = _BASE_DELAY_S * (2 ** attempt)
                _console_warning(f"Gemini API error ({exc}), retrying in {delay}s (attempt {attempt + 1}/{_MAX_RETRIES})")
                time.sleep(delay)
                last_exc = exc
                continue
            raise

    # Should not reach here, but just in case
    raise last_exc  # type: ignore[misc]


def _is_retryable(exc: Exception) -> bool:
    """Check if an exception represents a transient, retryable Gemini API error."""
    if isinstance(exc, TimeoutError):
        return True
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


__all__ = ["gemini_generate_with_retry"]
