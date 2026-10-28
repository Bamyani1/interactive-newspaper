"""Tests for the Claude OCR provider, Claude page reading and the Google guard."""

from __future__ import annotations

import base64
import io
import json
import math
import sys
from pathlib import Path
from types import SimpleNamespace

import anthropic
import httpx2
import pytest
from PIL import Image
from pydantic import BaseModel, ConfigDict

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

import transcript_ocr.recognition.docai_provider as docai_provider  # noqa: E402
from transcript_ocr.config import google_clients  # noqa: E402
from transcript_ocr.config.claude_client import (  # noqa: E402
    ClaudeOCRClient,
    fit_image_size,
    to_claude_content,
)
from transcript_ocr.config.model_calls import (  # noqa: E402
    build_generation_config,
    image_part_ultra_high,
    model_name,
)
from transcript_ocr.application.edition_pipeline import (  # noqa: E402
    _estimate_report_cost,
    _provider_provenance,
)
from transcript_ocr.contracts.diagnostics_models import (  # noqa: E402
    PageDiagnostics,
    PipelineReport,
    TokenUsage,
)
from transcript_ocr.diagnostics.costing import estimate_gemini_cost  # noqa: E402
from transcript_ocr.export.provenance import write_provenance  # noqa: E402
from transcript_ocr.merging import llm_merge  # noqa: E402
from transcript_ocr.recognition.claude_reader import (  # noqa: E402
    _drop_seam_repeats,
    _flush_only_at_column_tops,
    _straight_quotes,
    plan_strips,
    read_page_text,
    render_strip,
)
from transcript_ocr.recognition.page_extractor import _format_docai_text  # noqa: E402
from transcript_ocr.shared import retry  # noqa: E402


class _Answer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    value: str


class _FakeStream:
    def __init__(self, message):
        self._message = message

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def __iter__(self):
        return iter([SimpleNamespace(type="message_start")])

    def get_final_message(self):
        return self._message


class _FakeAnthropic:
    def __init__(self, messages):
        self.requests: list[dict] = []
        self._messages = list(messages)
        self.messages = SimpleNamespace(stream=self._stream)

    def _stream(self, **request):
        self.requests.append(request)
        return _FakeStream(self._messages.pop(0))


def _message(text: str, stop_reason: str = "end_turn"):
    return SimpleNamespace(
        content=[SimpleNamespace(type="thinking"), SimpleNamespace(type="text", text=text)],
        stop_reason=stop_reason,
        model="claude-haiku-5-5",
        usage=SimpleNamespace(
            input_tokens=100,
            output_tokens=40,
            cache_read_input_tokens=None,
            cache_creation_input_tokens=None,
        ),
    )


def _config(stage: str = "page_structuring"):
    return build_generation_config(
        stage,
        system_instruction="sys",
        response_mime_type="application/json",
        response_schema=_Answer,
        max_output_tokens=1000,
    )


def _decoded_size(block: dict) -> tuple[int, int]:
    return Image.open(io.BytesIO(base64.b64decode(block["source"]["data"]))).size


def test_page_images_fit_claude_vision_limits():
    width, height = fit_image_size(3400, 4020, max_long_edge=2576)
    assert max(width, height) <= 2576
    assert math.ceil(width / 28) * math.ceil(height / 28) <= 4784
    assert fit_image_size(800, 600, max_long_edge=2576) == (800, 600)


def test_contents_translate_in_order_and_cap_many_images():
    page = Image.new("L", (3400, 4020), 255)
    blocks = to_claude_content(["Annotated page:", image_part_ultra_high(page), "", "Prompt"])
    assert [block["type"] for block in blocks] == ["text", "image", "text"]
    assert _decoded_size(blocks[1]) == fit_image_size(3400, 4020, max_long_edge=2576)

    crop = image_part_ultra_high(Image.new("L", (2400, 600), 255))
    assert all(max(_decoded_size(block)) <= 2000 for block in to_claude_content([crop] * 21))


def test_request_maps_system_schema_effort_and_usage():
    fake = _FakeAnthropic([_message('{"value": "ok"}')])
    response = ClaudeOCRClient(fake).generate_content(
        model="claude-sonnet-5-5",
        contents=["x"],
        config=_config("merge"),
        stage="merge",
        timeout_seconds=5,
    )
    request = fake.requests[0]
    assert request["system"] == "sys"
    assert request["thinking"] == {"type": "adaptive"}
    assert request["output_config"]["effort"] == "high"
    assert request["output_config"]["format"]["schema"]["additionalProperties"] is False
    assert request["max_tokens"] == 1000
    assert not {"temperature", "top_p", "top_k", "seed"} & request.keys()
    assert response.parsed == _Answer(value="ok")
    assert response.usage_metadata.prompt_token_count == 100
    assert response.usage_metadata.candidates_token_count == 40


def test_truncated_or_invalid_output_is_left_unparsed_for_the_schema_retry():
    fake = _FakeAnthropic(
        [_message('{"value": "o', stop_reason="max_tokens"), _message('{"other": 1}')]
    )
    client = ClaudeOCRClient(fake)
    for _ in range(2):
        response = client.generate_content(
            model="claude-haiku-5-5",
            contents=["x"],
            config=_config(),
            stage="page_structuring",
            timeout_seconds=5,
        )
        assert response.parsed is None


def test_retry_routes_claude_client_with_claude_model_and_timeout(monkeypatch):
    monkeypatch.setenv("OCR_LLM_PROVIDER", "claude")
    monkeypatch.setattr(retry, "_CALL_SPACING_S", 0)
    fake = _FakeAnthropic([_message("not json"), _message('{"value": "ok"}')])

    response = retry.gemini_generate_with_retry(
        ClaudeOCRClient(fake),
        model=model_name("page_structuring"),
        contents=["Structure this."],
        config=_config(),
        stage="page_structuring",
        response_validator=lambda candidate: candidate.parsed is not None,
        schema_retry_instruction=lambda _candidate: "Return JSON.",
    )

    assert response.parsed == _Answer(value="ok")
    assert [request["model"] for request in fake.requests] == ["claude-haiku-5-5"] * 2
    assert fake.requests[0]["output_config"]["effort"] == "xhigh"
    assert fake.requests[0]["timeout"].read == 900
    assert "CORRECTION REQUIRED" in fake.requests[1]["messages"][0]["content"][-1]["text"]


def test_claude_overload_and_connection_errors_are_retried():
    class Overloaded(Exception):
        status_code = 529

    assert retry._is_retryable(Overloaded()) and retry._is_rate_limited(Overloaded())
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    assert retry._is_retryable(anthropic.APIConnectionError(request=request))


def test_claude_provider_routes_models_costs_and_merge_lock(monkeypatch):
    monkeypatch.setenv("OCR_LLM_PROVIDER", "claude")
    monkeypatch.setattr(retry, "_CALL_SPACING_S", 0)
    assert model_name("page_structuring") == "claude-haiku-5-5"
    assert model_name("merge") == model_name("seam_repair") == "claude-sonnet-5-5"
    usage = TokenUsage(prompt_tokens=1_000_000, candidates_tokens=100_000)
    assert estimate_gemini_cost("claude-sonnet-5-5", usage).usd == pytest.approx(3.0)

    fake = _FakeAnthropic([_message("{}")])
    llm_merge._generate_locked_content(
        ClaudeOCRClient(fake),
        contents=["x"],
        response_schema=llm_merge.EditionGroupingResponse,
        response_validator=lambda _candidate: True,
    )
    assert fake.requests[0]["model"] == "claude-sonnet-5-5"

    monkeypatch.delenv("OCR_LLM_PROVIDER")
    assert model_name("merge") == "claude-sonnet-5-5"
    monkeypatch.setenv("OCR_LLM_PROVIDER", "gemini")
    assert model_name("merge") == "gemini-3.8-flash"


def test_forbid_google_blocks_both_google_clients(monkeypatch):
    monkeypatch.setenv("OCR_FORBID_GOOGLE", "1")
    with pytest.raises(RuntimeError, match="forbidden"):
        google_clients.create_genai_client()
    monkeypatch.setattr(docai_provider, "_docai_client", None)
    with pytest.raises(RuntimeError, match="forbidden"):
        docai_provider._get_docai_client()


def test_strips_cover_the_page_once_at_the_width_limit():
    strips = plan_strips(3400, 4020)
    assert len(strips) == 3
    assert strips[0].top == 0 and strips[-1].bottom == 4020
    assert all(a.bottom == b.top for a, b in zip(strips, strips[1:]))
    for strip in strips:
        assert fit_image_size(3400, strip.crop_bottom - strip.crop_top)[0] == 2576


def test_strip_tints_context_and_leaves_its_own_area_clear():
    page = Image.new("L", (3400, 4020), 255)
    strip = plan_strips(3400, 4020)[1]
    image, scale = render_strip(page, strip)
    own_top = round((strip.top - strip.crop_top) * scale)
    assert image.getpixel((10, own_top + 5)) == (255, 255, 255)
    assert image.getpixel((10, 5)) != (255, 255, 255)


def test_reading_uses_straight_quotes_like_the_archive():
    text = "‘‘Prohibition,’’ he said. “It’s over.”"
    assert _straight_quotes(text) == '"Prohibition," he said. "It\'s over."'
    assert _straight_quotes("''Prohibition") == '"Prohibition'


def test_seam_line_read_by_both_strips_is_kept_once():
    paragraph = docai_provider.DocAIParagraph
    upper = [paragraph("had to\nreceive compliance from\nthe Delaware city council", (0.09, 0.6, 0.25, 0.668))]
    lower = [
        paragraph(
            "the Delaware city council\nbefore the project got", (0.09, 0.66, 0.25, 0.7), indented=True
        ),
        # Same words in another column are not a repeat.
        paragraph("the Delaware city council", (0.5, 0.66, 0.6, 0.67), indented=True),
    ]

    kept = _drop_seam_repeats(upper, lower, seam=0.667, band=0.03)

    assert [block.text for block in kept] == ["before the project got", "the Delaware city council"]
    assert kept[0].bounds[1] == pytest.approx(0.68)
    # The rest of a paragraph the upper strip began is not a paragraph start.
    assert [block.indented for block in kept] == [False, True]


def test_reading_splits_blocks_at_marked_paragraph_starts(monkeypatch):
    monkeypatch.setenv("OCR_LLM_PROVIDER", "claude")
    monkeypatch.setattr(retry, "_CALL_SPACING_S", 0)
    lines = ["devoted directly", "to her needs.", '¶"The fact that we know', "her helps.", "¶ Senior Melissa"]
    block = {"lines": lines, "left": 0, "top": 0, "right": 100, "bottom": 500}
    fake = _FakeAnthropic([_message(json.dumps({"blocks": [block]})) for _ in range(3)])

    result = read_page_text(ClaudeOCRClient(fake), Image.new("L", (3400, 4020), 255))

    first, second, third = result.paragraph_regions[:3]
    assert [first.text, second.text, third.text] == [
        "devoted directly\nto her needs.",
        '"The fact that we know\nher helps.',
        "Senior Melissa",
    ]
    assert [first.indented, second.indented, third.indented] == [False, True, True]
    assert first.bounds[1] == 0.0
    assert first.bounds[3] == pytest.approx(second.bounds[1])
    assert second.bounds[3] == pytest.approx(third.bounds[1])
    assert third.bounds[1] - second.bounds[1] == pytest.approx(first.bounds[3] - first.bounds[1])


def test_flush_mark_is_kept_only_where_a_column_or_strip_begins():
    paragraph = docai_provider.DocAIParagraph
    blocks = [
        paragraph("fraternities in a letter\nto Warren.", (0.1, 0.40, 0.25, 0.50), indented=True),
        # Directly under a block of its column: the reader's block break wins.
        paragraph("IFC had described\nthe situation", (0.1, 0.505, 0.25, 0.55), indented=False),
        # Under a headline across three columns: a column top, so it may run on.
        paragraph("Keep that in mind\nwhen you", (0.4, 0.42, 0.55, 0.47), indented=False),
        # One line at a column top is more often a salutation or label.
        paragraph("Editor, The Transcript", (0.4, 0.36, 0.85, 0.37), indented=False),
    ]

    kept = _flush_only_at_column_tops(blocks)

    assert [block.indented for block in kept] == [True, None, False, None]


def test_structuring_sees_whether_each_block_starts_indented():
    paragraph = docai_provider.DocAIParagraph
    bounds = (0.0, 0.0, 1.0, 1.0)
    result = docai_provider.DocAIResult(
        raw_text="",
        paragraph_regions=[
            paragraph("New", bounds, indented=True),
            paragraph("carried on", bounds, indented=False),
            paragraph("Document AI", bounds),
        ],
    )

    formatted = _format_docai_text(result)

    assert "1.00000] FIRST LINE INDENTED\nNew" in formatted
    assert "1.00000] FIRST LINE FLUSH\ncarried on" in formatted
    assert "1.00000]\nDocument AI" in formatted


def test_reading_maps_blocks_to_page_positions(monkeypatch, tmp_path):
    monkeypatch.setenv("OCR_LLM_PROVIDER", "claude")
    monkeypatch.setattr(retry, "_CALL_SPACING_S", 0)
    block = '{"blocks": [{"lines": ["OWU ON", "ICE"], "left": 0, "top": 0, "right": 1288, "bottom": 50}, '
    block += '{"lines": [" "], "left": 0, "top": 0, "right": 1, "bottom": 1}]}'
    fake = _FakeAnthropic([_message(block) for _ in range(3)])
    page = Image.new("L", (3400, 4020), 255)

    diag = PageDiagnostics()
    result = read_page_text(
        ClaudeOCRClient(fake), page, save_prefix=str(tmp_path / "p"), diag=diag
    )

    assert [request["model"] for request in fake.requests] == ["claude-haiku-5-5"] * 3
    # Every strip's tokens are kept for the edition cost.
    assert diag.reading_tokens.prompt_tokens == 300
    assert diag.reading_tokens.candidates_tokens == 120
    assert fake.requests[0]["output_config"]["effort"] == "xhigh"
    assert result.paragraphs == ["OWU ON\nICE"] * 3
    strip = plan_strips(3400, 4020)[1]
    left, top, right, _bottom = result.paragraph_regions[1].bounds
    assert left == 0.0
    assert right == pytest.approx(0.5, abs=0.001)
    assert top == pytest.approx(strip.crop_top / 4020)
    assert (tmp_path / "p.claude-read.json").is_file()
    assert (tmp_path / "p.strip-3.png").is_file()


def test_edition_cost_counts_page_reading_and_every_structuring_call(monkeypatch):
    monkeypatch.setenv("OCR_LLM_PROVIDER", "claude")
    call = TokenUsage(prompt_tokens=1_000_000, candidates_tokens=100_000)
    page = PageDiagnostics(gemini_tokens=call + call, reading_tokens=call)
    report = PipelineReport(page_diagnostics=[page])
    report.finalize()

    # Haiku reads and structures: $0.15 per call, and this page was structured twice.
    assert _estimate_report_cost(report) == pytest.approx(0.45)
    assert report.total_prompt_tokens == 3_000_000


def test_provenance_names_anthropic_and_no_google_project(monkeypatch, tmp_path):
    monkeypatch.setenv("OCR_LLM_PROVIDER", "claude")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "some-project")
    target = tmp_path / "provenance.json"
    write_provenance(
        target,
        edition_date="1985-10-18",
        edition_dir=tmp_path,
        manifest_path=None,
        outcomes=[],
        provider=_provider_provenance(),
        model_routes={"page_structuring": {"name": "claude-haiku-5-5"}},
    )
    payload = json.loads(target.read_text())
    assert payload["provider"]["name"] == "anthropic"
    assert "google_cloud" not in payload
    assert "some-project" not in target.read_text()
