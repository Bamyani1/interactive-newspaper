"""Focused tests for locked Gemini OCR call contracts."""

from __future__ import annotations

import sys
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from google.genai import _transformers
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.application.ad_enrichment import (
    _display_text_supported,
    _source_supported,
    enrich_edition,
)
from transcript_ocr.application.content_rescue import (
    _apply_review,
    _build_candidates,
    triage_edition,
)
from transcript_ocr.config.model_calls import build_generation_config, image_part_ultra_high
from transcript_ocr.contracts.content_models import (
    Ad,
    AdEnrichmentDelta,
    AdEnrichmentDeltasResponse,
    Article,
    ArticleImage,
    ContentReviewDecision,
    ContentReviewResponse,
    ImageRegionAssignment,
    ImageRegionAssignments,
    OtherContent,
    PageContent,
)
from transcript_ocr.image_linking.visual_matcher import _build_content_context
from transcript_ocr.image_linking.visual_matcher import match_images_visual
from transcript_ocr.merging.llm_merge import EditionGroupingResponse, EditionSeamResponse
from transcript_ocr.recognition.page_extractor import process_page_with_docai
from transcript_ocr.shared import retry


def test_generation_config_is_deterministic_without_sampling_controls():
    config = build_generation_config(
        "page_structuring",
        response_schema=PageContent,
        response_mime_type="application/json",
        max_output_tokens=1024,
    )

    assert config.candidate_count == 1
    assert config.seed == 0
    assert config.temperature is None
    assert config.top_p is None
    assert config.top_k is None
    assert config.thinking_config.thinking_level.value == "HIGH"
    assert config.thinking_config.include_thoughts is False
    assert all(setting.threshold.value == "OFF" for setting in config.safety_settings)


def test_ultra_high_is_applied_to_each_image_part():
    part = image_part_ultra_high(Image.new("RGB", (8, 8), "white"))
    assert part.media_resolution.level.value == "MEDIA_RESOLUTION_ULTRA_HIGH"


def test_retry_has_one_three_attempt_budget_and_never_changes_model(monkeypatch):
    class TransientError(RuntimeError):
        status_code = 503

    responses = [TransientError("unavailable"), SimpleNamespace(parsed=None), SimpleNamespace(parsed={"ok": True})]
    calls = []

    class Models:
        def generate_content(self, **kwargs):
            calls.append(kwargs)
            value = responses.pop(0)
            if isinstance(value, Exception):
                raise value
            return value

    client = SimpleNamespace(models=Models())
    failures = []
    monkeypatch.setattr(retry, "_CALL_SPACING_S", 0)
    monkeypatch.setattr(retry, "_retry_delay_seconds", lambda *_: 0)

    config = build_generation_config("page_structuring", max_output_tokens=128)
    with retry.observe_gemini_failures(failures.append):
        response = retry.gemini_generate_with_retry(
            client,
            model="locked-model",
            contents=["x"],
            config=config,
            stage="page_structuring",
            response_validator=lambda candidate: candidate.parsed is not None,
            max_schema_retries=1,
        )

    assert response.parsed == {"ok": True}
    assert len(calls) == 3
    assert {call["model"] for call in calls} == {"locked-model"}
    assert all(call["config"].http_options.timeout == 240_000 for call in calls)
    assert [(event["attempt"], event["status"]) for event in failures] == [
        (1, "transport_error"),
        (2, "schema_error"),
    ]
    assert all(event["model"] == "locked-model" for event in failures)
    assert all("contents" not in event for event in failures)


def test_schema_retry_adds_sanitized_contract_correction(monkeypatch):
    responses = [SimpleNamespace(parsed=None), SimpleNamespace(parsed={"ok": True})]
    calls = []

    class Models:
        def generate_content(self, **kwargs):
            calls.append(kwargs)
            return responses.pop(0)

    monkeypatch.setattr(retry, "_CALL_SPACING_S", 0)
    response = retry.gemini_generate_with_retry(
        SimpleNamespace(models=Models()),
        model="locked-model",
        contents=["original"],
        config=build_generation_config("image_matching", max_output_tokens=128),
        stage="image_matching",
        response_validator=lambda candidate: candidate.parsed is not None,
        schema_retry_instruction=lambda _candidate: "region 3 is missing.",
    )

    assert response.parsed == {"ok": True}
    assert calls[0]["contents"] == ["original"]
    assert calls[1]["contents"][0] == "original"
    assert "region 3 is missing" in calls[1]["contents"][-1]
    assert {call["model"] for call in calls} == {"locked-model"}


def test_retry_retries_sdk_read_timeout_without_changing_request(monkeypatch):
    class ReadTimeout(RuntimeError):
        pass

    calls = []
    responses = [
        ReadTimeout("The read operation timed out"),
        SimpleNamespace(parsed={"ok": True}),
    ]

    class Models:
        def generate_content(self, **kwargs):
            calls.append(kwargs)
            value = responses.pop(0)
            if isinstance(value, Exception):
                raise value
            return value

    client = SimpleNamespace(models=Models())
    monkeypatch.setattr(retry, "_CALL_SPACING_S", 0)
    monkeypatch.setattr(retry, "_retry_delay_seconds", lambda *_: 0)
    config = build_generation_config("page_structuring", max_output_tokens=128)

    response = retry.gemini_generate_with_retry(
        client,
        model="locked-model",
        contents=["same content"],
        config=config,
        stage="page_structuring",
    )

    assert response.parsed == {"ok": True}
    assert len(calls) == 2
    assert {call["model"] for call in calls} == {"locked-model"}
    assert [call["contents"] for call in calls] == [["same content"]] * 2


@pytest.mark.parametrize("status_code", [408, 429, 500, 502, 503, 504])
def test_retry_retries_every_supported_transient_http_status(monkeypatch, status_code):
    class ApiError(RuntimeError):
        pass

    error = ApiError(f"HTTP {status_code}")
    error.status_code = status_code
    calls = 0

    class Models:
        def generate_content(self, **_kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise error
            return SimpleNamespace(parsed={"ok": True})

    monkeypatch.setattr(retry, "_CALL_SPACING_S", 0)
    monkeypatch.setattr(retry, "_retry_delay_seconds", lambda *_: 0)
    response = retry.gemini_generate_with_retry(
        SimpleNamespace(models=Models()),
        model="locked-model",
        contents=["x"],
        config=build_generation_config("page_structuring", max_output_tokens=128),
    )

    assert response.parsed == {"ok": True}
    assert calls == 2


def test_retry_does_not_retry_vertex_invalid_argument(monkeypatch):
    class InvalidArgument(RuntimeError):
        status_code = 400

    calls = 0

    class Models:
        def generate_content(self, **_kwargs):
            nonlocal calls
            calls += 1
            raise InvalidArgument("400 INVALID_ARGUMENT")

    monkeypatch.setattr(retry, "_CALL_SPACING_S", 0)
    with pytest.raises(InvalidArgument):
        retry.gemini_generate_with_retry(
            SimpleNamespace(models=Models()),
            model="locked-model",
            contents=["x"],
            config=build_generation_config("page_structuring", max_output_tokens=128),
        )

    assert calls == 1


def test_retry_exhausts_after_exactly_three_timeouts(monkeypatch):
    class ReadTimeout(RuntimeError):
        pass

    calls = 0

    class Models:
        def generate_content(self, **_kwargs):
            nonlocal calls
            calls += 1
            raise ReadTimeout("The read operation timed out")

    monkeypatch.setattr(retry, "_CALL_SPACING_S", 0)
    monkeypatch.setattr(retry, "_retry_delay_seconds", lambda *_: 0)
    with pytest.raises(ReadTimeout):
        retry.gemini_generate_with_retry(
            SimpleNamespace(models=Models()),
            model="locked-model",
            contents=["x"],
            config=build_generation_config("page_structuring", max_output_tokens=128),
        )

    assert calls == 3


@pytest.mark.parametrize(
    "response_schema",
    [
        PageContent,
        ImageRegionAssignments,
        EditionGroupingResponse,
        EditionSeamResponse,
        AdEnrichmentDeltasResponse,
        ContentReviewResponse,
    ],
)
def test_sdk_transformed_response_schemas_have_no_empty_enum_value(response_schema):
    transformed = _transformers.t_schema(None, response_schema)
    assert transformed is not None
    schema = transformed.model_dump(mode="json", exclude_none=True)

    def enum_values(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key == "enum":
                    yield from child
                yield from enum_values(child)
        elif isinstance(value, list):
            for child in value:
                yield from enum_values(child)

    assert "" not in set(enum_values(schema))


def test_visual_rejection_reason_uses_null_for_non_rejections():
    assert ImageRegionAssignment(
        region_number=1,
        visual_type="unresolved",
        attachment="standalone",
        content_index=-1,
        caption_slot=-1,
    ).rejection_reason is None


def test_visual_context_uses_first_and_last_two_sentences_and_complete_ads():
    page = PageContent(
        page_number="1",
        publication_info="",
        articles=[
            Article(
                headline="Long Story",
                author="Jane Writer",
                category="News",
                body="One. Two. Three. Four. Five.",
                images=[ArticleImage(caption="Printed caption", position="below")],
            )
        ],
        ads=[Ad(business_name="Shop", body="Every word in this advertisement.")],
        other_content=[OtherContent(title="Schedule", body="First. Second. Third.")],
    )

    context, caption_slots = _build_content_context(page)

    assert "One. Two. Four. Five." in context
    assert "Three." not in context
    assert "complete_text: Every word in this advertisement." in context
    assert "printed_caption_slot [0]: Printed caption" in context
    assert "context: First. Second." in context
    assert caption_slots == 1


def test_visual_assignment_has_independent_type_attachment_and_no_generated_caption():
    assignment = ImageRegionAssignment(
        region_number=1,
        visual_type="typographic_display_ad",
        attachment="ad",
        content_index=0,
        caption_slot=-1,
    )
    assert assignment.content_type == "ad"
    assert assignment.caption == ""
    assert "caption" not in assignment.model_dump()


def test_ad_facts_must_be_supported_by_same_source():
    source = "Call Acme at 555-1234. Meals cost $4.95 at 10 Main St."
    assert _source_supported("(555) 1234", source)
    assert _source_supported("$4.95", source)
    assert not _source_supported("555-9999", source)
    assert _display_text_supported("Acme meals $4.95", source + " Acme meals")
    assert not _display_text_supported("Acme offers free delivery $99", source)


def test_review_candidates_are_exactly_the_locked_deterministic_set():
    edition = {
        "articles": [
            {"headline": "Short wire", "body": "Brief.", "category": "News"},
            {
                "headline": "Fallback",
                "body": "Valid body.",
                "category": "News",
                "category_fallback_used": True,
            },
            {"headline": "", "body": "Body with a missing headline.", "category": "News"},
            {"headline": "Missing body", "body": "", "category": "Opinion"},
            {"headline": "Duplicate", "body": "Exact duplicate text.", "category": "News"},
            {
                "headline": "Visual conflict",
                "body": "Otherwise valid.",
                "category": "Arts & Entertainment",
                "visual_kind_conflict": True,
            },
            {
                "headline": "Unresolved",
                "body": "Otherwise valid.",
                "category": "Sports",
                "review_state": "unresolved",
            },
        ],
        "ads": [
            {"business_name": "", "body": "A valid anonymous classified.", "image_files": []},
            {"business_name": "Visual-only brand", "body": "", "image_files": ["images/ad.png"]},
            {"business_name": "", "body": "", "image_files": []},
            {"business_name": "Duplicate ad", "body": "Exact duplicate text.", "image_files": []},
            {
                "business_name": "Conflict",
                "body": "Offer.",
                "image_files": [],
                "visual_classification_conflict": True,
            },
        ],
        "other_content": [
            {"title": "Long schedule", "body": "Details. " * 40},
            {"title": "Duplicate other", "body": "Exact   duplicate\ntext."},
            {"title": "Unknown", "body": "Unresolved prose is not itself a flag."},
            {"title": "State", "body": "Valid content.", "status": "UNRESOLVED"},
        ],
    }
    candidates, item_map = _build_candidates(edition)
    by_id = {candidate["item_id"]: candidate["reasons"] for candidate in candidates}

    assert by_id == {
        "article-1": ["category_fallback"],
        "article-2": ["blank_article_headline"],
        "article-3": ["blank_article_body"],
        "article-4": ["exact_cross_array_duplicate_text"],
        "article-5": ["visual_kind_conflict"],
        "article-6": ["explicit_unresolved_state"],
        "ad-2": ["blank_ad_business_and_body"],
        "ad-3": ["exact_cross_array_duplicate_text"],
        "ad-4": ["visual_kind_conflict"],
        "other-1": ["exact_cross_array_duplicate_text"],
        "other-3": ["explicit_unresolved_state"],
    }
    assert set(item_map) == set(by_id)
    assert "article-0" not in by_id  # News and short text are not review triggers.
    assert "other-0" not in by_id  # Substantive other content is not a trigger.
    assert "other-2" not in by_id  # The word "unresolved" in prose is not state.


def test_review_changes_require_point_nine_and_reuse_source_text():
    edition = {
        "articles": [
            {
                "headline": "Original headline",
                "body": "Original body, unchanged.",
                "category": "News",
                "category_fallback": True,
                "image_files": ["images/original.png"],
            },
            {
                "headline": "Second headline",
                "body": "Second original body.",
                "category": "News",
                "visual_kind_conflict": True,
                "image_files": [],
            },
        ],
        "ads": [],
        "other_content": [],
    }
    candidates, item_map = _build_candidates(edition)

    result = ContentReviewResponse(
        decisions=[
            ContentReviewDecision(
                item_id="article-0",
                target_type="other",
                confidence=0.89,
            ),
            ContentReviewDecision(
                item_id="article-1",
                target_type="ad",
                confidence=0.90,
            ),
        ]
    )
    changed, category_changes = _apply_review(edition, item_map, result)
    assert changed == 1
    assert category_changes == 0
    assert edition["articles"] == [
        {
            "headline": "Original headline",
            "body": "Original body, unchanged.",
            "category": "News",
            "category_fallback": True,
            "image_files": ["images/original.png"],
        }
    ]
    assert edition["ads"] == [
        {
            "business_name": "Second headline",
            "body": "Second original body.",
            "image_files": [],
        }
    ]
    decision_schema = ContentReviewDecision.model_json_schema()["properties"]
    assert set(decision_schema) == {"item_id", "target_type", "category", "confidence"}


def test_page_structuring_never_substitutes_an_empty_page_on_schema_failure():
    response = SimpleNamespace(
        parsed=None,
        usage_metadata=None,
        prompt_feedback=None,
        candidates=[SimpleNamespace(finish_reason="MALFORMED_FUNCTION_CALL")],
    )
    docai = SimpleNamespace(
        paragraphs=["Source paragraph."],
        raw_text="Source paragraph.",
    )
    with patch(
        "transcript_ocr.recognition.page_extractor.gemini_generate_with_retry",
        return_value=response,
    ):
        with pytest.raises(RuntimeError, match="finish_reason"):
            process_page_with_docai(
                SimpleNamespace(),
                "0001_Page 1.png",
                docai,
                Image.new("L", (20, 20), "white"),
                [],
            )


def test_visual_call_marks_full_page_and_every_evidence_crop_ultra_high():
    parsed = ImageRegionAssignments(
        assignments=[
            ImageRegionAssignment(
                region_number=1,
                visual_type="photograph",
                attachment="standalone",
                content_index=-1,
                caption_slot=-1,
            )
        ]
    )
    captured = {}

    def fake_generate(*_args, **kwargs):
        captured.update(kwargs)
        return SimpleNamespace(parsed=parsed, usage_metadata=None)

    empty_page = PageContent(articles=[], ads=[], other_content=[])
    with patch(
        "transcript_ocr.image_linking.visual_matcher.gemini_generate_with_retry",
        side_effect=fake_generate,
    ):
        result = match_images_visual(
            SimpleNamespace(),
            Image.new("RGB", (20, 20), "white"),
            empty_page,
            1,
            evidence_images=[Image.new("RGB", (10, 10), "black")],
        )

    image_parts = [part for part in captured["contents"] if hasattr(part, "inline_data")]
    assert len(image_parts) == 2
    assert all(
        part.media_resolution.level.value == "MEDIA_RESOLUTION_ULTRA_HIGH"
        for part in image_parts
    )
    assert result == parsed


def test_visual_calls_batch_global_region_ids_at_forty_and_repeat_full_page():
    calls = []

    def fake_generate(*_args, **kwargs):
        calls.append(kwargs)
        call_number = len(calls)
        ids = list(range(1, 41)) if call_number == 1 else list(range(41, 46))
        parsed = ImageRegionAssignments(
            assignments=[
                ImageRegionAssignment(
                    region_number=region_id,
                    visual_type="illustration",
                    attachment="standalone",
                    content_index=-1,
                    caption_slot=-1,
                )
                for region_id in ids
            ]
        )
        return SimpleNamespace(parsed=parsed, usage_metadata=None)

    evidence = [Image.new("RGB", (4, 4), "white") for _ in range(45)]
    with patch(
        "transcript_ocr.image_linking.visual_matcher.gemini_generate_with_retry",
        side_effect=fake_generate,
    ):
        result = match_images_visual(
            SimpleNamespace(),
            Image.new("RGB", (20, 20), "white"),
            PageContent(articles=[], ads=[], other_content=[]),
            45,
            evidence_images=evidence,
        )

    assert len(calls) == 2
    assert [assignment.region_number for assignment in result.assignments] == list(range(1, 46))
    first_images = [part for part in calls[0]["contents"] if hasattr(part, "inline_data")]
    second_images = [part for part in calls[1]["contents"] if hasattr(part, "inline_data")]
    assert len(first_images) == 41  # repeated full page + 40 crops
    assert len(second_images) == 6  # repeated full page + 5 crops
    assert "1, 2, 3" in calls[0]["contents"][-1]
    assert "41, 42, 43, 44, 45" in calls[1]["contents"][-1]


def test_ad_enrichment_returns_deltas_and_preserves_source_fields(tmp_path):
    edition_path = tmp_path / "edition.json"
    edition_path.write_text(
        json.dumps(
            {
                "edition_date": "1990-01-01",
                "ads": [
                    {
                        "business_name": "Acme",
                        "body": "Call 555-1234. Sale price $4.95.",
                        "image_files": ["images/acme.jpg"],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    parsed = AdEnrichmentDeltasResponse(
        ads=[
            AdEnrichmentDelta(
                ad_id="ad-0",
                category="Retail",
                ad_type="display",
                display_text="Acme sale",
                phone="555-9999",
                price="$4.95",
            )
        ]
    )
    response = SimpleNamespace(parsed=parsed, usage_metadata=None)

    with patch(
        "transcript_ocr.application.ad_enrichment.gemini_generate_with_retry",
        return_value=response,
    ):
        performed, _, _ = enrich_edition(str(edition_path), SimpleNamespace())

    result = json.loads(edition_path.read_text(encoding="utf-8"))
    enriched = result["enriched_ads"][0]
    assert performed is True
    assert enriched["business_name"] == "Acme"
    assert enriched["body"] == "Call 555-1234. Sale price $4.95."
    assert enriched["image_files"] == ["images/acme.jpg"]
    assert enriched["phone"] == ""
    assert enriched["price"] == "$4.95"


def test_ad_enrichment_batches_at_fifty(tmp_path):
    edition_path = tmp_path / "edition.json"
    edition_path.write_text(
        json.dumps(
            {
                "edition_date": "1990-01-01",
                "ads": [
                    {"business_name": f"Ad {index}", "body": "Offer", "image_files": []}
                    for index in range(51)
                ],
            }
        ),
        encoding="utf-8",
    )
    call_count = 0
    telemetry = []

    def fake_generate(*_args, **_kwargs):
        nonlocal call_count
        start = 0 if call_count == 0 else 50
        end = 50 if call_count == 0 else 51
        call_count += 1
        return SimpleNamespace(
            parsed=AdEnrichmentDeltasResponse(
                ads=[
                    AdEnrichmentDelta(
                        ad_id=f"ad-{index}",
                        category="Other",
                        ad_type="display",
                        display_text="Offer",
                    )
                    for index in range(start, end)
                ]
            ),
            usage_metadata=SimpleNamespace(
                prompt_token_count=10 + call_count,
                candidates_token_count=20 + call_count,
                thoughts_token_count=30 + call_count,
                tool_use_prompt_token_count=40 + call_count,
                cached_content_token_count=50 + call_count,
                total_token_count=150 + (5 * call_count),
            ),
        )

    with patch(
        "transcript_ocr.application.ad_enrichment.gemini_generate_with_retry",
        side_effect=fake_generate,
    ):
        performed, tokens, _ = enrich_edition(
            str(edition_path), SimpleNamespace(), telemetry_hook=telemetry.append
        )

    assert performed is True
    assert call_count == 2
    assert tokens == 315
    assert len(json.loads(edition_path.read_text())["enriched_ads"]) == 51
    assert [event["call_index"] for event in telemetry] == [1, 2]
    assert [event["call_count"] for event in telemetry] == [2, 2]
    assert [event["item_count"] for event in telemetry] == [50, 1]
    assert {event["status"] for event in telemetry} == {"success"}
    assert telemetry[0]["tokens"] == {
        "prompt_tokens": 11,
        "candidates_tokens": 21,
        "thoughts_tokens": 31,
        "tool_use_prompt_tokens": 41,
        "cached_content_tokens": 51,
        "total_tokens": 155,
    }


def test_final_review_emits_complete_success_and_error_telemetry(tmp_path):
    edition_path = tmp_path / "edition.json"
    source = {
        "edition_date": "1990-01-01",
        "articles": [
            {
                "headline": "Story",
                "body": "Source body.",
                "category": "News",
                "category_fallback": True,
            }
        ],
        "ads": [],
        "other_content": [],
    }
    edition_path.write_text(json.dumps(source), encoding="utf-8")
    response = SimpleNamespace(
        parsed=ContentReviewResponse(
            decisions=[
                ContentReviewDecision(
                    item_id="article-0",
                    target_type="article",
                    category="Campus News",
                    confidence=0.90,
                )
            ]
        ),
        usage_metadata=SimpleNamespace(
            prompt_token_count=12,
            candidates_token_count=3,
            thoughts_token_count=4,
            tool_use_prompt_token_count=5,
            cached_content_token_count=6,
            total_token_count=30,
        ),
    )
    success_events = []
    with patch(
        "transcript_ocr.application.content_rescue.gemini_generate_with_retry",
        return_value=response,
    ):
        performed, tokens, _ = triage_edition(
            str(edition_path), SimpleNamespace(), telemetry_hook=success_events.append
        )

    assert performed is True
    assert tokens == 30
    assert len(success_events) == 1
    assert success_events[0]["stage"] == "content_triage"
    assert success_events[0]["status"] == "success"
    assert success_events[0]["item_count"] == 1
    assert success_events[0]["tokens"]["thoughts_tokens"] == 4
    reviewed = json.loads(edition_path.read_text(encoding="utf-8"))
    assert reviewed["articles"][0]["headline"] == "Story"
    assert reviewed["articles"][0]["body"] == "Source body."
    assert reviewed["articles"][0]["category"] == "Campus News"

    edition_path.write_text(json.dumps(source), encoding="utf-8")
    error_events = []
    with patch(
        "transcript_ocr.application.content_rescue.gemini_generate_with_retry",
        side_effect=RuntimeError("service unavailable"),
    ):
        performed, tokens, _ = triage_edition(
            str(edition_path), SimpleNamespace(), telemetry_hook=error_events.append
        )

    assert performed is False
    assert tokens == 0
    assert len(error_events) == 1
    assert error_events[0]["status"] == "error"
    assert error_events[0]["error"] == "service unavailable"
    assert error_events[0]["tokens"]["total_tokens"] == 0
