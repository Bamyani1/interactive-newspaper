"""Bounded Gemini request, deadline, rate-limit, and retry helpers."""

from __future__ import annotations

import email.utils
import logging
import os
import random
import threading
import time
from collections.abc import Callable
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Iterator

from google import genai
from google.genai import types

from ..config.model_calls import STAGE_TIMEOUT_SECONDS
from .console import warning as _console_warning

logger = logging.getLogger(__name__)

_RETRYABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}
_RETRYABLE_EXCEPTION_NAMES = {
    "ConnectError",
    "ConnectTimeout",
    "DeadlineExceeded",
    "InternalServerError",
    "PoolTimeout",
    "ReadError",
    "ReadTimeout",
    "RemoteProtocolError",
    "ResourceExhausted",
    "ServiceUnavailable",
    "TooManyRequests",
    "TransportError",
    "WriteTimeout",
}
_MAX_ATTEMPTS = 3
_MAX_SCHEMA_RETRIES = 1
_BASE_DELAY_S = 2.0
_CALL_SPACING_S = float(os.getenv("GEMINI_CALL_SPACING_S", "0.5"))

_rate_lock = threading.Lock()
_last_call_started_at = 0.0
FailureObserver = Callable[[dict[str, Any]], None]
_failure_observer: ContextVar[FailureObserver | None] = ContextVar(
    "gemini_failure_observer",
    default=None,
)


class GeminiResponseError(RuntimeError):
    """Raised when Gemini completes but never returns the required contract."""


@contextmanager
def observe_gemini_failures(observer: FailureObserver) -> Iterator[None]:
    """Attach metadata-only retry diagnostics to the current execution context."""
    token = _failure_observer.set(observer)
    try:
        yield
    finally:
        _failure_observer.reset(token)


def _usage_metadata(response: object) -> dict[str, int]:
    usage = getattr(response, "usage_metadata", None)
    return {
        "prompt_tokens": int(getattr(usage, "prompt_token_count", 0) or 0),
        "candidates_tokens": int(
            getattr(usage, "candidates_token_count", 0) or 0
        ),
        "thoughts_tokens": int(getattr(usage, "thoughts_token_count", 0) or 0),
        "tool_use_prompt_tokens": int(
            getattr(usage, "tool_use_prompt_token_count", 0) or 0
        ),
        "cached_content_tokens": int(
            getattr(usage, "cached_content_token_count", 0) or 0
        ),
        "total_tokens": int(getattr(usage, "total_token_count", 0) or 0),
    }


def _emit_failure(event: dict[str, Any]) -> None:
    observer = _failure_observer.get()
    if observer is None:
        return
    try:
        observer(event)
    except Exception as exc:
        logger.warning("Gemini failure observer failed: %s", exc)


def _wait_for_global_call_slot() -> None:
    """Serialize request starts across workers without serializing responses."""
    global _last_call_started_at
    if _CALL_SPACING_S <= 0:
        return
    with _rate_lock:
        now = time.monotonic()
        remaining = _CALL_SPACING_S - (now - _last_call_started_at)
        if remaining > 0:
            time.sleep(remaining)
        _last_call_started_at = time.monotonic()


def _config_with_deadline(
    config: types.GenerateContentConfig,
    timeout_seconds: int,
) -> types.GenerateContentConfig:
    """Apply an SDK/HTTP deadline; do not use a thread that keeps running."""
    return config.model_copy(
        update={
            "http_options": types.HttpOptions(timeout=timeout_seconds * 1000),
        }
    )


def _generate_content(
    client: genai.Client,
    *,
    model: str,
    contents: list,
    config: types.GenerateContentConfig,
    timeout_seconds: int,
) -> genai.types.GenerateContentResponse:
    _wait_for_global_call_slot()
    return client.models.generate_content(
        model=model,
        contents=contents,
        config=_config_with_deadline(config, timeout_seconds),
    )


def gemini_generate_with_retry(
    client: genai.Client,
    *,
    model: str,
    contents: list,
    config: types.GenerateContentConfig,
    stage: str = "page_structuring",
    response_validator: Callable[[genai.types.GenerateContentResponse], bool] | None = None,
    schema_retry_instruction: (
        Callable[[genai.types.GenerateContentResponse], str] | None
    ) = None,
    max_schema_retries: int = _MAX_SCHEMA_RETRIES,
) -> genai.types.GenerateContentResponse:
    """Generate with one shared three-attempt budget.

    Transient transport failures and contract-correction retries consume the
    same budget.  At most one completed but invalid response is retried.  The
    requested model and complete generation config are preserved on every
    attempt; there is no fallback model.
    """
    timeout_seconds = STAGE_TIMEOUT_SECONDS.get(stage, 240)
    schema_retries = 0
    last_response: genai.types.GenerateContentResponse | None = None
    attempt_contents = contents

    for attempt in range(1, _MAX_ATTEMPTS + 1):
        attempt_started = time.monotonic()
        try:
            response = _generate_content(
                client,
                model=model,
                contents=attempt_contents,
                config=config,
                timeout_seconds=timeout_seconds,
            )
        except Exception as exc:
            _emit_failure(
                {
                    "stage": stage,
                    "model": model,
                    "attempt": attempt,
                    "status": "transport_error",
                    "status_code": _status_code(exc),
                    "finish_reason": "",
                    "latency_ms": round(
                        (time.monotonic() - attempt_started) * 1000
                    ),
                    "tokens": {},
                    "error": str(exc),
                }
            )
            if not _is_retryable(exc) or attempt >= _MAX_ATTEMPTS:
                raise
            delay = _retry_delay_seconds(exc, attempt)
            _console_warning(
                f"Gemini {stage} transient error ({exc}); retrying the same "
                f"model/config in {delay:.1f}s (attempt {attempt + 1}/{_MAX_ATTEMPTS})"
            )
            time.sleep(delay)
            continue

        last_response = response
        if response_validator is None or response_validator(response):
            return response

        failure_reason = _response_failure_reason(response)
        _emit_failure(
            {
                "stage": stage,
                "model": model,
                "attempt": attempt,
                "status": "schema_error",
                "status_code": None,
                "finish_reason": failure_reason,
                "latency_ms": round((time.monotonic() - attempt_started) * 1000),
                "tokens": _usage_metadata(response),
                "error": "structured response validation failed",
            }
        )

        if schema_retries >= max_schema_retries or attempt >= _MAX_ATTEMPTS:
            return response

        schema_retries += 1
        if schema_retry_instruction is not None:
            instruction = schema_retry_instruction(response).strip()
            if instruction:
                attempt_contents = [
                    *contents,
                    (
                        "CORRECTION REQUIRED: The previous response violated the "
                        f"output contract: {instruction} Return a complete corrected "
                        "response for the original request."
                    ),
                ]
        _console_warning(
            f"Gemini {stage} returned an invalid structured response "
            f"({failure_reason}); retrying the same "
            f"model/config (attempt {attempt + 1}/{_MAX_ATTEMPTS})"
        )

    if last_response is not None:
        return last_response
    raise RuntimeError(f"Gemini {stage} exhausted its request attempts")


def _status_code(exc: Exception) -> int | None:
    code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    if callable(code):
        code = code()
    if hasattr(code, "value"):
        code = code.value
    try:
        return int(code) if code is not None else None
    except (TypeError, ValueError):
        return None


def _is_retryable(exc: Exception) -> bool:
    """Return whether a transport/API failure may be attempted again."""
    if isinstance(exc, (TimeoutError, ConnectionError)):
        return True
    code = _status_code(exc)
    if code is not None:
        return code in _RETRYABLE_STATUS_CODES
    if type(exc).__name__ in _RETRYABLE_EXCEPTION_NAMES:
        return True
    text = str(exc).lower()
    return any(
        term in text
        for term in (
            "429",
            "500",
            "502",
            "503",
            "504",
            "deadline exceeded",
            "timed out",
            "rate limit",
            "resource exhausted",
            "connection reset",
            "server disconnected",
            "temporarily unavailable",
        )
    )


def _retry_after_seconds(exc: Exception) -> float | None:
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None) or getattr(exc, "headers", None)
    if not headers:
        return None
    value = headers.get("retry-after") or headers.get("Retry-After")
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except (TypeError, ValueError):
        try:
            target = email.utils.parsedate_to_datetime(str(value))
            if target.tzinfo is None:
                target = target.replace(tzinfo=timezone.utc)
            return max(0.0, (target - datetime.now(timezone.utc)).total_seconds())
        except (TypeError, ValueError, OverflowError):
            return None


def _retry_delay_seconds(exc: Exception, attempt: int) -> float:
    retry_after = _retry_after_seconds(exc)
    if retry_after is not None:
        return retry_after
    ceiling = _BASE_DELAY_S * (2 ** (attempt - 1))
    return random.uniform(0.0, ceiling)


def _response_failure_reason(response: object) -> str:
    """Return finish/block detail without persisting raw response text."""
    prompt_feedback = getattr(response, "prompt_feedback", None)
    block_reason = getattr(prompt_feedback, "block_reason", None)
    if block_reason:
        return f"block_reason={block_reason}"
    candidates = getattr(response, "candidates", None) or []
    reasons = [getattr(candidate, "finish_reason", None) for candidate in candidates]
    reasons = [str(reason) for reason in reasons if reason]
    return f"finish_reason={','.join(reasons)}" if reasons else "parsed output missing"


def require_parsed(response: genai.types.GenerateContentResponse, *, stage: str):
    """Return parsed content or raise a sanitized stage failure."""
    parsed = getattr(response, "parsed", None)
    if parsed is None:
        raise GeminiResponseError(
            f"Gemini {stage} response invalid after retries: "
            f"{_response_failure_reason(response)}"
        )
    return parsed


__all__ = [
    "GeminiResponseError",
    "gemini_generate_with_retry",
    "observe_gemini_failures",
    "require_parsed",
]
