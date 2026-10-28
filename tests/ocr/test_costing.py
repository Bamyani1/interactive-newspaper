import pytest

from transcript_ocr.contracts.diagnostics_models import TokenUsage
from transcript_ocr.diagnostics.costing import estimate_cost


def test_haiku_cost_counts_tool_input_and_thought_output():
    estimate = estimate_cost(
        "claude-haiku-5-5",
        TokenUsage(
            prompt_tokens=900_000,
            tool_use_prompt_tokens=100_000,
            candidates_tokens=800_000,
            thoughts_tokens=200_000,
        ),
    )
    assert estimate.input_tokens == 1_000_000
    assert estimate.output_tokens == 1_000_000
    assert estimate.usd == pytest.approx(0.60)


def test_sonnet_cost_uses_its_rate():
    estimate = estimate_cost(
        "claude-sonnet-5-5",
        TokenUsage(prompt_tokens=1_000_000, candidates_tokens=1_000_000),
    )
    assert estimate.usd == pytest.approx(12.00)
