"""Claude client for OCR stages (``OCR_LLM_PROVIDER=claude``).

Each stage still builds its Gemini-shaped request (contents, config, Pydantic
response schema).  This module turns that request into one streamed Messages
API call and returns a response with the attributes the stages and
``shared.retry`` read: ``parsed``, ``text``, ``usage_metadata``, ``candidates``.
"""

from __future__ import annotations

import base64
import contextlib
import io
import math
import os
import threading
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

import anthropic
from google.genai import types
from PIL import Image
from pydantic import BaseModel, ValidationError

from .google_clients import _load_repo_env
from .model_calls import CLAUDE_MODELS

# High-resolution vision limits (Claude 4.7 and later): larger images are
# downscaled by the API anyway, so resize here and keep requests small.
_MAX_LONG_EDGE = 2576
_MAX_VISUAL_TOKENS = 4784
_PATCH_PX = 28
# A request with more than 20 images caps every image at 2000 px.
_MANY_IMAGES = 20
_MANY_IMAGES_LONG_EDGE = 2000
# The API allows 10 MB of base64 per image, about 7.5 MB raw.
_MAX_IMAGE_BYTES = 7_000_000


@dataclass
class ClaudeResponse:
    parsed: BaseModel | None
    text: str
    usage_metadata: SimpleNamespace
    candidates: list[SimpleNamespace]
    model_version: str
    prompt_feedback: None = None


def fit_image_size(
    width: int, height: int, *, max_long_edge: int = _MAX_LONG_EDGE
) -> tuple[int, int]:
    """Largest size within the long-edge and visual-token limits."""
    scale = min(1.0, max_long_edge / max(width, height))
    while True:
        fitted = (max(1, int(width * scale)), max(1, int(height * scale)))
        tokens = math.ceil(fitted[0] / _PATCH_PX) * math.ceil(fitted[1] / _PATCH_PX)
        if tokens <= _MAX_VISUAL_TOKENS:
            return fitted
        scale *= 0.99


def _image_block(data: bytes, *, max_long_edge: int) -> dict[str, Any]:
    with Image.open(io.BytesIO(data)) as opened:
        image = opened.copy()
    size = fit_image_size(*image.size, max_long_edge=max_long_edge)
    if size != image.size:
        image = image.resize(size, Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    media_type = "image/png"
    if buffer.tell() > _MAX_IMAGE_BYTES:
        buffer = io.BytesIO()
        image.convert("RGB").save(buffer, format="JPEG", quality=92)
        media_type = "image/jpeg"
    return {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": media_type,
            "data": base64.b64encode(buffer.getvalue()).decode("ascii"),
        },
    }


def _inline_image(item: object) -> bytes | None:
    if isinstance(item, types.Part) and item.inline_data and item.inline_data.data:
        return item.inline_data.data
    return None


def to_claude_content(contents: list) -> list[dict[str, Any]]:
    """Translate Gemini contents (strings and Parts) to Claude content blocks."""
    image_count = sum(1 for item in contents if _inline_image(item) is not None)
    max_long_edge = _MANY_IMAGES_LONG_EDGE if image_count > _MANY_IMAGES else _MAX_LONG_EDGE
    blocks: list[dict[str, Any]] = []
    for item in contents:
        data = _inline_image(item)
        if data is not None:
            blocks.append(_image_block(data, max_long_edge=max_long_edge))
            continue
        text = item if isinstance(item, str) else getattr(item, "text", None)
        if not isinstance(text, str):
            raise TypeError(f"unsupported OCR content part: {type(item).__name__}")
        if text.strip():
            blocks.append({"type": "text", "text": text})
    return blocks


def _to_response(message: Any, schema: type[BaseModel]) -> ClaudeResponse:
    text = "".join(block.text for block in message.content if block.type == "text")
    parsed = None
    if message.stop_reason == "end_turn" and text.strip():
        try:
            parsed = schema.model_validate_json(text)
        except ValidationError:
            parsed = None
    usage = message.usage
    cache_read = usage.cache_read_input_tokens or 0
    prompt_tokens = (usage.input_tokens or 0) + cache_read + (
        usage.cache_creation_input_tokens or 0
    )
    # Claude reports thinking inside output_tokens; both are billed as output.
    output_tokens = usage.output_tokens or 0
    return ClaudeResponse(
        parsed=parsed,
        text=text,
        usage_metadata=SimpleNamespace(
            prompt_token_count=prompt_tokens,
            candidates_token_count=output_tokens,
            thoughts_token_count=0,
            tool_use_prompt_token_count=0,
            cached_content_token_count=cache_read,
            total_token_count=prompt_tokens + output_tokens,
        ),
        candidates=[SimpleNamespace(finish_reason=message.stop_reason)],
        model_version=message.model,
    )


class ClaudeOCRClient:
    def __init__(self, client: anthropic.Anthropic) -> None:
        self._client = client

    def generate_content(
        self,
        *,
        model: str,
        contents: list,
        config: types.GenerateContentConfig,
        stage: str,
        timeout_seconds: int,
    ) -> ClaudeResponse:
        schema = config.response_schema
        if not (isinstance(schema, type) and issubclass(schema, BaseModel)):
            raise TypeError(f"Claude {stage} needs a Pydantic response_schema")
        request: dict[str, Any] = {
            "model": model,
            "max_tokens": config.max_output_tokens or 32000,
            "messages": [{"role": "user", "content": to_claude_content(contents)}],
            "thinking": {"type": "adaptive"},
            "output_config": {
                "effort": CLAUDE_MODELS[stage]["effort"],
                "format": {
                    "type": "json_schema",
                    "schema": anthropic.transform_schema(schema.model_json_schema()),
                },
            },
            "timeout": anthropic.Timeout(timeout_seconds, connect=15.0),
        }
        if config.system_instruction:
            if not isinstance(config.system_instruction, str):
                raise TypeError(f"Claude {stage} needs a string system_instruction")
            request["system"] = config.system_instruction

        # The read timeout only bounds gaps between bytes, and the SDK drops the
        # ping events that keep a stalled stream alive, so read it on a worker
        # thread and give up at the deadline.
        outcome: dict[str, Any] = {}
        done = threading.Event()

        def read_stream() -> None:
            try:
                with self._client.messages.stream(**request) as stream:
                    outcome["stream"] = stream
                    outcome["message"] = stream.get_final_message()
            except Exception as error:  # re-raised on the caller's thread
                outcome["error"] = error
            finally:
                done.set()

        threading.Thread(target=read_stream, name=f"claude-{stage}", daemon=True).start()
        if not done.wait(timeout_seconds):
            stream = outcome.get("stream")
            if stream is not None:
                with contextlib.suppress(Exception):
                    stream.close()
            raise TimeoutError(f"Claude {stage} exceeded {timeout_seconds}s")
        if "error" in outcome:
            raise outcome["error"]
        return _to_response(outcome["message"], schema)


def create_claude_client() -> ClaudeOCRClient:
    _load_repo_env()
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise RuntimeError("ANTHROPIC_API_KEY is required for OCR_LLM_PROVIDER=claude")
    # shared.retry owns the retry policy, as with the Gemini client.
    return ClaudeOCRClient(anthropic.Anthropic(max_retries=0))


__all__ = [
    "ClaudeOCRClient",
    "ClaudeResponse",
    "create_claude_client",
    "fit_image_size",
    "to_claude_content",
]
