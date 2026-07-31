"""Behavior tests for edition-level article grouping and seam review."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from google.genai import types
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.contracts.content_models import Article, PageContent  # noqa: E402
from transcript_ocr.contracts.diagnostics_models import PipelineReport  # noqa: E402
from transcript_ocr.merging.llm_merge import (  # noqa: E402
    EditionGroupingResponse,
    EditionSeamResponse,
    MergeGroupDecision,
    SeamBoundaryDecision,
    _anchored_span,
    _generate_locked_content,
    _seam_response_validation_reason,
    merge_edition_articles,
    normalized_word_similarity,
)


def _page(page: str, *articles: Article) -> tuple[str, PageContent]:
    return (
        f"Page {page}.jpg",
        PageContent(
            articles=list(articles),
            ads=[],
            other_content=[],
            page_number=page,
            publication_info="",
        ),
    )


def _article(
    headline: str,
    body: str,
    *,
    continues_on: str = "",
    continued_from: str = "",
    author: str = "",
) -> Article:
    return Article(
        headline=headline,
        author=author,
        category="News",
        continues_on=continues_on,
        continued_from=continued_from,
        body=body,
        images=[],
        image_files=[],
    )


def _response(parsed):
    return SimpleNamespace(parsed=parsed, text=parsed.model_dump_json(), usage_metadata=None)


def test_locked_calls_use_36_flash_with_medium_thinking():
    client = MagicMock()
    response = SimpleNamespace(parsed=None, text="", usage_metadata=None)
    with patch(
        "transcript_ocr.merging.llm_merge.gemini_generate_with_retry",
        return_value=response,
    ) as transport:
        _generate_locked_content(
            client,
            contents=["{}"],
            response_schema=EditionGroupingResponse,
        )

    kwargs = transport.call_args.kwargs
    assert kwargs["model"] == "gemini-3.6-flash"
    assert kwargs["config"].thinking_config.thinking_level == types.ThinkingLevel.MEDIUM
    assert kwargs["config"].response_schema is EditionGroupingResponse
    assert kwargs["stage"] == "merge"


def test_seam_semantic_validator_rejects_unsafe_repair_with_sanitized_reason():
    boundary_id = "boundary-1"
    response = _response(
        EditionSeamResponse(
            boundaries=[
                SeamBoundaryDecision(
                    boundary_id=boundary_id,
                    action="REPAIR",
                    left_anchor_text="not an actual suffix anchor",
                    right_anchor_text="not an actual prefix anchor",
                    replacement_text="invented replacement text",
                )
            ]
        )
    )
    reason = _seam_response_validation_reason(
        response,
        {boundary_id: (0, 0, "left", "right")},
        {
            "left": "The authentic left fragment ends with source wording.",
            "right": "The authentic right fragment begins with source wording.",
        },
    )

    assert "90% ordered-word" in reason
    assert "authentic" not in reason


def test_three_fragments_use_one_grouping_call_and_one_batched_seam_call():
    page_results = [
        _page(
            "1",
                _article(
                    "Long Story",
                    (
                        "The opening has enough context and ends with a complete sentence."
                        "\n\n(Continued on page 2)"
                    ),
                continues_on="2",
            ),
            _article("Unrelated", "This unrelated article stays on its own page."),
        ),
        _page(
            "2",
            _article(
                    "Long Story Continued",
                    (
                        "(Continued from page 1)\nThe middle has enough context and also ends "
                        "with terminal punctuation.\n\n(Continued on page 3)"
                    ),
                continued_from="1",
                continues_on="3",
            ),
        ),
        _page(
            "3",
            _article(
                    "Long Story Continued",
                    (
                        "(Continued from page 2)\nThe ending has enough context and closes the "
                        "complete article."
                    ),
                continued_from="2",
            ),
        ),
    ]
    seen_requests = []

    def generate(_client, *, contents, response_schema, **_kwargs):
        payload = json.loads(contents[0])
        seen_requests.append((response_schema, payload))
        if response_schema is EditionGroupingResponse:
            ids = [fragment["fragment_id"] for fragment in payload["fragments"]]
            return _response(
                EditionGroupingResponse(
                    groups=[
                        MergeGroupDecision(fragment_ids=[ids[0], ids[2], ids[3]]),
                        MergeGroupDecision(fragment_ids=[ids[1]]),
                    ]
                )
            )
        return _response(
            EditionSeamResponse(
                boundaries=[
                    SeamBoundaryDecision(
                        boundary_id=boundary["boundary_id"],
                        action="KEEP",
                        reason_code="ALREADY_CLEAN",
                    )
                    for boundary in payload["boundaries"]
                ]
            )
        )

    with patch("transcript_ocr.merging.llm_merge._generate_locked_content", side_effect=generate):
        result = merge_edition_articles(MagicMock(), page_results)

    assert result is not None
    assert [schema for schema, _ in seen_requests] == [EditionGroupingResponse, EditionSeamResponse]
    seam_request = seen_requests[1][1]
    assert len(seam_request["boundaries"]) == 2
    assert [(b["left_page"], b["right_page"]) for b in seam_request["boundaries"]] == [
        ("1", "2"),
        ("2", "3"),
    ]
    assert len(result.articles) == 2
    merged = next(article for article in result.articles if len(article.source_pages) == 3)
    assert merged.source_pages == ["1", "2", "3"]
    assert "complete sentence.\n\n(Continued on page 2)" in merged.body
    assert "(Continued from page 1)\nThe middle" in merged.body
    assert "(Continued from page 2)\nThe ending" in merged.body
    assert merged.continues_on == ""
    assert merged.continued_from == ""


def test_complete_partition_rejects_generated_metadata_and_missing_ids():
    with pytest.raises(ValidationError):
        EditionGroupingResponse.model_validate(
            {
                "groups": [
                    {
                        "fragment_ids": ["fragment-1"],
                        "merged_headline": "Model must not generate this",
                    }
                ]
            }
        )

    pages = [
        _page("1", _article("A", "Original body A.")),
        _page("2", _article("B", "Original body B.")),
    ]
    calls = []

    def incomplete(_client, *, contents, response_schema, **_kwargs):
        calls.append(response_schema)
        ids = [fragment["fragment_id"] for fragment in json.loads(contents[0])["fragments"]]
        return _response(
            EditionGroupingResponse(groups=[MergeGroupDecision(fragment_ids=[ids[0]])])
        )

    with patch("transcript_ocr.merging.llm_merge._generate_locked_content", side_effect=incomplete):
        result = merge_edition_articles(MagicMock(), pages)

    assert result is not None
    assert calls == [EditionGroupingResponse]
    assert [article.body for article in result.articles] == ["Original body A.", "Original body B."]


def test_body_marker_text_does_not_create_structured_merge_evidence():
    left = "Body text ends here.\n\n(Continued on page 2)"
    right = "(Continued from page 1)\nBody text resumes here."
    pages = [
        _page("1", _article("Story", left)),
        _page("2", _article("Story", right)),
    ]
    calls = []

    def propose_unstructured_group(_client, *, contents, response_schema, **_kwargs):
        payload = json.loads(contents[0])
        calls.append((response_schema, payload))
        ids = [fragment["fragment_id"] for fragment in payload["fragments"]]
        return _response(
            EditionGroupingResponse(groups=[MergeGroupDecision(fragment_ids=ids)])
        )

    with patch(
        "transcript_ocr.merging.llm_merge._generate_locked_content",
        side_effect=propose_unstructured_group,
    ):
        result = merge_edition_articles(MagicMock(), pages)

    assert result is not None
    assert len(calls) == 1
    assert all(fragment["continues_on"] == "" for fragment in calls[0][1]["fragments"])
    assert all(fragment["continued_from"] == "" for fragment in calls[0][1]["fragments"])
    assert [article.body for article in result.articles] == [left, right]


def test_model_can_group_fragments_when_source_folio_numbers_are_wrong():
    """The frozen 1990 edition prints 8/7 for the true canvas 5→6 seam."""
    pages = [
        _page(
            "5",
            _article(
                "Wing Nite: A growing tradition",
                'The restaurant said, "It had been the same way for the',
                continues_on="8",
            ),
        ),
        _page(
            "6",
            _article(
                "Wing Nite",
                'past 18 years," Barber said. The story continues.',
                continued_from="7",
            ),
        ),
    ]

    def group_then_keep(_client, *, contents, response_schema, **_kwargs):
        payload = json.loads(contents[0])
        if response_schema is EditionGroupingResponse:
            ids = [fragment["fragment_id"] for fragment in payload["fragments"]]
            return _response(
                EditionGroupingResponse(groups=[MergeGroupDecision(fragment_ids=ids)])
            )
        return _response(
            EditionSeamResponse(
                boundaries=[
                    SeamBoundaryDecision(
                        boundary_id=payload["boundaries"][0]["boundary_id"],
                        action="KEEP",
                    )
                ]
            )
        )

    with patch(
        "transcript_ocr.merging.llm_merge._generate_locked_content",
        side_effect=group_then_keep,
    ):
        result = merge_edition_articles(MagicMock(), pages)

    assert result is not None
    assert len(result.articles) == 1
    assert result.articles[0].source_pages == ["5", "6"]
    assert result.articles[0].continues_on == ""
    assert result.articles[0].continued_from == ""


def test_normalized_word_similarity_honors_exact_ninety_percent_floor():
    source = "one two three four five six seven eight nine ten"
    at_floor = "one two three four five six seven eight nine changed"
    below_floor = "one two three four five six seven eight changed changed"
    assert normalized_word_similarity(source, at_floor) == pytest.approx(0.90)
    assert normalized_word_similarity(source, below_floor) == pytest.approx(0.80)


def test_model_selected_source_reprint_is_collapsed_with_ninety_percent_safeguard():
    original = " ".join(f"word{i}" for i in range(120))
    reprint_words = original.split()
    reprint_words[60] = "pullquote"
    pages = [
        _page("10", _article("Swimming has best year", original)),
        _page("11", _article("Intramurals on the upswing", " ".join(reprint_words))),
    ]

    def identify_reprint(_client, *, contents, response_schema, **_kwargs):
        payload = json.loads(contents[0])
        ids = [fragment["fragment_id"] for fragment in payload["fragments"]]
        return _response(
            EditionGroupingResponse(
                groups=[MergeGroupDecision(fragment_ids=[item]) for item in ids],
                source_duplicate_groups=[ids],
            )
        )

    with patch(
        "transcript_ocr.merging.llm_merge._generate_locked_content",
        side_effect=identify_reprint,
    ):
        result = merge_edition_articles(MagicMock(), pages)

    assert result is not None
    assert len(result.articles) == 1
    assert result.articles[0].headline == "Swimming has best year"
    assert result.articles[0].body == original
    assert result.articles[0].source_pages == ["10", "11"]


def test_source_reprint_decision_below_similarity_floor_preserves_both_articles():
    left = " ".join(f"alpha{i}" for i in range(120))
    right = " ".join(f"beta{i}" for i in range(120))
    pages = [
        _page("1", _article("Related story", left)),
        _page("2", _article("Follow-up", right)),
    ]

    def unsafe_reprint(_client, *, contents, response_schema, **_kwargs):
        payload = json.loads(contents[0])
        ids = [fragment["fragment_id"] for fragment in payload["fragments"]]
        return _response(
            EditionGroupingResponse(
                groups=[MergeGroupDecision(fragment_ids=[item]) for item in ids],
                source_duplicate_groups=[ids],
            )
        )

    with patch(
        "transcript_ocr.merging.llm_merge._generate_locked_content",
        side_effect=unsafe_reprint,
    ):
        result = merge_edition_articles(MagicMock(), pages)

    assert result is not None
    assert [article.body for article in result.articles] == [left, right]


def test_anchor_matching_uses_floor_edge_and_requires_unique_suffix_or_prefix():
    suffix_source = "preface one two three four five six seven eight nine ten"
    at_floor = "one two three four five six seven eight nine changed"
    below_floor = "one two three four five six seven eight changed changed"
    assert _anchored_span(suffix_source, at_floor, side="suffix") is not None
    assert _anchored_span(suffix_source, below_floor, side="suffix") is None

    repeated = (
        "alpha beta gamma delta epsilon zeta filler "
        "alpha beta gamma delta epsilon zeta"
    )
    assert _anchored_span(
        repeated,
        "alpha beta gamma delta epsilon zeta",
        side="suffix",
    ) is None


def test_local_repair_is_accepted_with_unique_suffix_and_prefix_anchors():
    pages = [
        _page(
            "1",
            _article(
                "Story",
                "Earlier context is complete. alpha beta gamma delta epsilon we have",
                continues_on="2",
            ),
        ),
        _page(
            "2",
            _article(
                "Story",
                "something zeta eta theta iota kappa follows in the article.",
                continued_from="1",
            ),
        ),
    ]

    def generate(_client, *, contents, response_schema, **_kwargs):
        payload = json.loads(contents[0])
        if response_schema is EditionGroupingResponse:
            ids = [fragment["fragment_id"] for fragment in payload["fragments"]]
            return _response(
                EditionGroupingResponse(groups=[MergeGroupDecision(fragment_ids=ids)])
            )
        boundary_id = payload["boundaries"][0]["boundary_id"]
        return _response(
            EditionSeamResponse(
                boundaries=[
                    SeamBoundaryDecision(
                        boundary_id=boundary_id,
                        action="REPAIR",
                        left_anchor_text="alpha beta gamma delta epsilon we have",
                        right_anchor_text="something zeta eta theta iota kappa",
                        replacement_text=(
                            "alpha beta gamma delta epsilon we have something zeta eta theta iota kappa"
                        ),
                        reason_code="MISSING_SPACE",
                    )
                ]
            )
        )

    with patch("transcript_ocr.merging.llm_merge._generate_locked_content", side_effect=generate):
        result = merge_edition_articles(MagicMock(), pages)

    assert result is not None
    assert len(result.articles) == 1
    assert "we have something" in result.articles[0].body
    assert result.articles[0].source_pages == ["1", "2"]


@pytest.mark.parametrize(
    "replacement",
    [
        (
            "alpha beta Professor Baker promised exactly $300 today at 555-1212 before "
            "the deadline on March 5 according to the official notice"
        ),
        (
            "alpha beta Professor Adams promised exactly $400 today at 555-1212 before "
            "the deadline on March 5 according to the official notice"
        ),
        (
            "alpha beta Professor Adams promised exactly $300 today at 555-1212 before "
            "the deadline on April 5 according to the official notice"
        ),
        (
            "alpha beta Professor Adams promised exactly $300 today at 555-1313 before "
            "the deadline on March 5 according to the official notice"
        ),
    ],
)
def test_protected_value_change_rejects_edit_and_joins_group_losslessly(replacement):
    left_body = (
        "Background remains here. alpha beta Professor Adams promised exactly $300 today at 555-1212"
    )
    right_body = "before the deadline on March 5 according to the official notice."
    pages = [
        _page("1", _article("Story", left_body, continues_on="2", author="By A. Writer")),
        _page("2", _article("Story", right_body, continued_from="1")),
    ]

    def generate(_client, *, contents, response_schema, **_kwargs):
        payload = json.loads(contents[0])
        if response_schema is EditionGroupingResponse:
            ids = [fragment["fragment_id"] for fragment in payload["fragments"]]
            return _response(
                EditionGroupingResponse(groups=[MergeGroupDecision(fragment_ids=ids)])
            )
        boundary_id = payload["boundaries"][0]["boundary_id"]
        return _response(
            EditionSeamResponse(
                boundaries=[
                    SeamBoundaryDecision(
                        boundary_id=boundary_id,
                        action="REPAIR",
                        left_anchor_text=(
                            "alpha beta Professor Adams promised exactly $300 today at 555-1212"
                        ),
                        right_anchor_text="before the deadline on March 5 according to the official notice",
                        replacement_text=replacement,
                        reason_code="OCR_BOUNDARY",
                    )
                ]
            )
        )

    with patch("transcript_ocr.merging.llm_merge._generate_locked_content", side_effect=generate):
        result = merge_edition_articles(MagicMock(), pages)

    assert result is not None
    assert len(result.articles) == 1
    assert result.articles[0].body == f"{left_body}\n\n{right_body}"
    assert result.articles[0].author == "By A. Writer"
    assert result.articles[0].continues_on == ""
    assert result.articles[0].continued_from == ""


def test_valid_unresolved_boundary_preserves_fragments_in_one_joined_group():
    original_bodies = [
        "First fragment remains exactly as extracted.\n\n(Continued on page 2)",
        (
            "(Continued from page 1)\nSecond fragment remains exactly as extracted."
            "\n\n(Continued on page 3)"
        ),
        "(Continued from page 2)\nThird fragment remains exactly as extracted.",
    ]
    pages = [
        _page("1", _article("Story", original_bodies[0], continues_on="2")),
        _page("2", _article("Story", original_bodies[1], continued_from="1", continues_on="3")),
        _page("3", _article("Story", original_bodies[2], continued_from="2")),
    ]

    def generate(_client, *, contents, response_schema, **_kwargs):
        payload = json.loads(contents[0])
        if response_schema is EditionGroupingResponse:
            ids = [fragment["fragment_id"] for fragment in payload["fragments"]]
            return _response(
                EditionGroupingResponse(groups=[MergeGroupDecision(fragment_ids=ids)])
            )
        boundaries = payload["boundaries"]
        return _response(
            EditionSeamResponse(
                boundaries=[
                    SeamBoundaryDecision(
                        boundary_id=boundaries[0]["boundary_id"],
                        action="KEEP",
                        reason_code="ALREADY_CLEAN",
                    ),
                    SeamBoundaryDecision(
                        boundary_id=boundaries[1]["boundary_id"],
                        action="UNRESOLVED",
                        reason_code="INSUFFICIENT_CONTEXT",
                    ),
                ]
            )
        )

    with patch("transcript_ocr.merging.llm_merge._generate_locked_content", side_effect=generate):
        result = merge_edition_articles(MagicMock(), pages)

    assert result is not None
    assert len(result.articles) == 1
    assert result.articles[0].body == "\n\n".join(original_bodies)
    assert result.articles[0].source_pages == ["1", "2", "3"]


def test_merged_metadata_uses_earliest_nonempty_source_value():
    pages = [
        _page(
            "1",
            _article(
                "",
                "Opening fragment remains intact.",
                continues_on="2",
            ),
        ),
        _page(
            "2",
            Article(
                headline="Recovered Headline",
                author="Jane Reporter",
                writer_position="Staff Writer",
                category="Sports",
                continues_on="",
                continued_from="1",
                body="Closing fragment remains intact.",
                images=[],
                image_files=[],
            ),
        ),
    ]

    def keep_group(_client, *, contents, response_schema, **_kwargs):
        payload = json.loads(contents[0])
        if response_schema is EditionGroupingResponse:
            ids = [fragment["fragment_id"] for fragment in payload["fragments"]]
            return _response(
                EditionGroupingResponse(groups=[MergeGroupDecision(fragment_ids=ids)])
            )
        return _response(
            EditionSeamResponse(
                boundaries=[
                    SeamBoundaryDecision(
                        boundary_id=payload["boundaries"][0]["boundary_id"],
                        action="KEEP",
                    )
                ]
            )
        )

    with patch("transcript_ocr.merging.llm_merge._generate_locked_content", side_effect=keep_group):
        result = merge_edition_articles(MagicMock(), pages)

    assert result is not None
    assert len(result.articles) == 1
    merged = result.articles[0]
    assert merged.headline == "Recovered Headline"
    assert merged.author == "Jane Reporter"
    assert merged.writer_position == "Staff Writer"
    assert merged.category == "News"


def test_grouping_failure_returns_lossless_available_edition_not_none():
    pages = [
        _page("1", _article("A", "Body A remains unchanged.", continues_on="2")),
        _page("3", _article("B", "Body B remains unchanged.")),
    ]
    report = PipelineReport()
    with patch(
        "transcript_ocr.merging.llm_merge._generate_locked_content",
        side_effect=RuntimeError("synthetic API failure"),
    ):
        result = merge_edition_articles(MagicMock(), pages, report=report)

    assert result is not None
    assert [article.body for article in result.articles] == [
        "Body A remains unchanged.",
        "Body B remains unchanged.",
    ]
    assert result.articles[0].continues_on == "2"
    assert report.merge_pass is not None
    assert report.merge_pass.merge_skipped is True
    assert "grouping_unresolved" in report.merge_pass.error


def test_seam_call_failure_joins_confirmed_group_without_editing_source():
    left = "Left source body is immutable.\n\n(Continued on page 2)"
    right = "(Continued from page 1)\nRight source body is immutable."
    pages = [
        _page("1", _article("Story", left, continues_on="2")),
        _page("2", _article("Story", right, continued_from="1")),
    ]
    call_number = 0

    def grouping_then_failure(_client, *, contents, response_schema, **_kwargs):
        nonlocal call_number
        call_number += 1
        if response_schema is EditionGroupingResponse:
            ids = [fragment["fragment_id"] for fragment in json.loads(contents[0])["fragments"]]
            return _response(
                EditionGroupingResponse(groups=[MergeGroupDecision(fragment_ids=ids)])
            )
        raise RuntimeError("synthetic seam failure")

    with patch(
        "transcript_ocr.merging.llm_merge._generate_locked_content",
        side_effect=grouping_then_failure,
    ):
        result = merge_edition_articles(MagicMock(), pages)

    assert result is not None
    assert call_number == 2
    assert [article.body for article in result.articles] == [f"{left}\n\n{right}"]
    assert [article.source_pages for article in result.articles] == [["1", "2"]]


def test_missing_target_page_does_not_block_partition_of_available_fragments():
    pages = [
        _page("1", _article("A", "Body on page one.", continues_on="2")),
        _page("3", _article("B", "Independent body on page three.")),
    ]
    requests = []

    def singleton_partition(_client, *, contents, response_schema, **_kwargs):
        payload = json.loads(contents[0])
        requests.append(payload)
        ids = [fragment["fragment_id"] for fragment in payload["fragments"]]
        return _response(
            EditionGroupingResponse(
                groups=[MergeGroupDecision(fragment_ids=[fragment_id]) for fragment_id in ids]
            )
        )

    with patch(
        "transcript_ocr.merging.llm_merge._generate_locked_content",
        side_effect=singleton_partition,
    ):
        result = merge_edition_articles(MagicMock(), pages)

    assert result is not None
    assert len(requests) == 1
    assert [article.source_pages for article in result.articles] == [["1"], ["3"]]
    assert result.articles[0].continues_on == "2"
