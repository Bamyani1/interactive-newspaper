import pytest

from transcript_ocr.contracts.diagnostics_models import TokenUsage
from transcript_ocr.diagnostics.costing import estimate_gemini_cost


def test_flash_lite_cost_counts_tool_input_and_thought_output():
    estimate = estimate_gemini_cost(
        "gemini-3.5-flash-lite",
        TokenUsage(
            prompt_tokens=900_000,
            tool_use_prompt_tokens=100_000,
            candidates_tokens=800_000,
            thoughts_tokens=200_000,
        ),
    )
    assert estimate.input_tokens == 1_000_000
    assert estimate.output_tokens == 1_000_000
    assert estimate.usd == pytest.approx(2.80)


def test_flash_cost_uses_locked_global_rate():
    estimate = estimate_gemini_cost(
        "gemini-3.6-flash",
        TokenUsage(prompt_tokens=1_000_000, candidates_tokens=1_000_000),
    )
    assert estimate.usd == pytest.approx(9.0)
