"""Locked global-standard Gemini OCR cost accounting."""

from __future__ import annotations

from dataclasses import dataclass

from ..contracts.diagnostics_models import TokenUsage

MODEL_RATES_PER_MILLION = {
    "gemini-3.5-flash-lite": {"input": 0.30, "output": 2.50},
    "gemini-3.6-flash": {"input": 1.50, "output": 7.50},
}


@dataclass(frozen=True)
class CostEstimate:
    input_tokens: int
    output_tokens: int
    usd: float


def estimate_gemini_cost(model: str, usage: TokenUsage) -> CostEstimate:
    try:
        rates = MODEL_RATES_PER_MILLION[model]
    except KeyError as exc:
        raise ValueError(f"unsupported OCR pricing model: {model}") from exc
    input_tokens = (usage.prompt_tokens or 0) + (usage.tool_use_prompt_tokens or 0)
    output_tokens = (usage.candidates_tokens or 0) + (usage.thoughts_tokens or 0)
    usd = (
        input_tokens * rates["input"] / 1_000_000
        + output_tokens * rates["output"] / 1_000_000
    )
    return CostEstimate(input_tokens=input_tokens, output_tokens=output_tokens, usd=usd)


__all__ = ["CostEstimate", "MODEL_RATES_PER_MILLION", "estimate_gemini_cost"]
