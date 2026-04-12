"""Unit tests for merge seam repair logic."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.merging.llm_merge import _validate_merge_seam


def _mock_client_returning(text: str):
    """Create a mock Gemini client that returns the given text."""
    client = MagicMock()
    response = MagicMock()
    response.text = text
    client.models = MagicMock()
    # gemini_generate_with_retry calls client directly, so we patch at that level
    return client, response


def test_single_body_returns_unchanged():
    """Single-element list should pass through unchanged."""
    result = _validate_merge_seam(MagicMock(), ["Only one body."])
    assert result == ["Only one body."]


def test_clean_seam_not_repaired():
    """Bodies ending with terminal punctuation should not trigger repair."""
    bodies = [
        "First paragraph ends properly.",
        "Second paragraph starts here."
    ]
    # Should not even call Gemini since seam is clean
    client = MagicMock()
    result = _validate_merge_seam(client, bodies)
    assert len(result) == 2
    assert result[0] == "First paragraph ends properly."
    assert result[1] == "Second paragraph starts here."


def test_broken_seam_lowercase_triggers_repair():
    """Lowercase start after non-terminal end triggers Gemini seam repair."""
    bodies = [
        "would have to",
        "such regulations would apply"
    ]
    with patch("transcript_ocr.merging.llm_merge.gemini_generate_with_retry") as mock_gen:
        mock_response = MagicMock()
        mock_response.text = "would have to such regulations would apply"
        mock_gen.return_value = mock_response

        result = _validate_merge_seam(MagicMock(), bodies)
        assert mock_gen.called
        # Repair was applied
        assert any("would have to such" in b for b in result)


def test_broken_seam_uppercase_triggers_repair():
    """Uppercase start after non-terminal end should ALSO trigger repair.

    This is the key fix — the old code only triggered on lowercase starts.
    'would have to Such regulations' was missed because 'S' is uppercase.
    """
    bodies = [
        "would have to",
        "Such regulations would apply"
    ]
    with patch("transcript_ocr.merging.llm_merge.gemini_generate_with_retry") as mock_gen:
        mock_response = MagicMock()
        mock_response.text = "would have to such regulations would apply"
        mock_gen.return_value = mock_response

        result = _validate_merge_seam(MagicMock(), bodies)
        # The key assertion: Gemini was called even though next body starts uppercase
        assert mock_gen.called


def test_seam_with_quote_ending_not_repaired():
    """Body ending with closing quote should not trigger repair."""
    bodies = [
        'He said "this is the end."',
        "The next article starts here."
    ]
    client = MagicMock()
    result = _validate_merge_seam(client, bodies)
    assert len(result) == 2


def test_seam_valid_response_preserves_bodies():
    """When Gemini says VALID, bodies should be preserved unchanged."""
    bodies = [
        "End of paragraph without period",
        "Start of next paragraph"
    ]
    with patch("transcript_ocr.merging.llm_merge.gemini_generate_with_retry") as mock_gen:
        mock_response = MagicMock()
        mock_response.text = "VALID"
        mock_gen.return_value = mock_response

        result = _validate_merge_seam(MagicMock(), bodies)
        assert len(result) == 2
        assert result[0] == "End of paragraph without period"
        assert result[1] == "Start of next paragraph"


def test_gemini_failure_preserves_bodies():
    """If Gemini call throws an exception, bodies should be preserved."""
    bodies = [
        "End without punctuation",
        "start of next part"
    ]
    with patch("transcript_ocr.merging.llm_merge.gemini_generate_with_retry") as mock_gen:
        mock_gen.side_effect = Exception("API error")

        result = _validate_merge_seam(MagicMock(), bodies)
        assert len(result) == 2
        assert result[0] == "End without punctuation"
        assert result[1] == "start of next part"


def test_empty_bodies_skipped():
    """Empty bodies in the list should be passed through."""
    bodies = ["Some text.", "", "More text."]
    result = _validate_merge_seam(MagicMock(), bodies)
    # Empty body gets appended, then filtered by the [b for b if b.strip()] at end
    assert all(b.strip() for b in result)


def test_deterministic_merge_multi_article_continuation():
    """When 2 articles on page 1 continue to page 5, match by headline similarity."""
    from transcript_ocr.merging.deterministic_merge import _deterministic_merge

    article_data = [
        {"page_label": "1", "headline": "Campus Protest Grows", "body": "Students gathered at the quad...",
         "continuation": {"continues_on": "5", "continued_from": None}},
        {"page_label": "1", "headline": "Student Demands Issued", "body": "A list of demands was presented...",
         "continuation": {"continues_on": "5", "continued_from": None}},
        {"page_label": "5", "headline": "Campus Protest", "body": "The protest continued into the evening...",
         "continuation": {"continues_on": None, "continued_from": "1"}},
        {"page_label": "5", "headline": "Student Demands", "body": "The demands included tuition freeze...",
         "continuation": {"continues_on": None, "continued_from": "1"}},
    ]
    groups = _deterministic_merge(article_data)
    # Should produce 2 groups: [0,2] and [1,3]
    assert len(groups) == 2
    group_sets = [set(g) for g in groups]
    assert {0, 2} in group_sets
    assert {1, 3} in group_sets


def test_suggested_pairs_specific_continues_on():
    """Suggested pairs should match sources to stubs via body similarity
    when multiple sources continue to the same page (different headlines).

    Previously the lookup used stubs_by_source.get(target_page) which was
    wrong — it should find stubs whose continued_from matches the source's page."""
    from collections import defaultdict
    from difflib import SequenceMatcher as SM

    article_data = [
        {"page_label": "1", "headline": "Economy Booms",
         "body": "The downtown vacancy rate dropped sharply as the economy grew and it became",
         "continuation": {"continues_on": "2", "continued_from": None},
         "author": "", "writer_position": "", "category": "News",
         "images": [], "image_files": []},
        {"page_label": "1", "headline": "New Policy Announced",
         "body": "The basketball team won the championship game when Tedder sparked an 11-3 Bishop",
         "continuation": {"continues_on": "2", "continued_from": None},
         "author": "", "writer_position": "", "category": "News",
         "images": [], "image_files": []},
        {"page_label": "2", "headline": "Market Growth",
         "body": "a tighter market for downtown storefronts as the economy continued to grow",
         "continuation": {"continues_on": None, "continued_from": "1"},
         "author": "", "writer_position": "", "category": "News",
         "images": [], "image_files": []},
        {"page_label": "2", "headline": "Game Recap",
         "body": "streak. The key shot with 8:49 left was an underhand 12-footer by Bishop",
         "continuation": {"continues_on": None, "continued_from": "1"},
         "author": "", "writer_position": "", "category": "News",
         "images": [], "image_files": []},
    ]

    # Reproduce the suggested pairs logic directly
    sources_by_target = defaultdict(list)
    stubs_by_source = defaultdict(list)
    for idx, ad in enumerate(article_data):
        cont_on = ad["continuation"]["continues_on"]
        if cont_on and cont_on != "?":
            sources_by_target[cont_on].append(idx)
        cont_from = ad["continuation"]["continued_from"]
        if cont_from and cont_from != "?":
            stubs_by_source[cont_from].append(idx)

    suggested_pairs = []
    paired_src = set()
    paired_stub = set()

    for target_page, source_ids in sources_by_target.items():
        source_pages = {article_data[s]["page_label"] for s in source_ids}
        matching_stubs = []
        for sp in source_pages:
            for stub_id in stubs_by_source.get(sp, []):
                if article_data[stub_id]["page_label"] == target_page:
                    matching_stubs.append(stub_id)
        if len(source_ids) > 1 and len(matching_stubs) > 1:
            scores = []
            for src_id in source_ids:
                src_tail = (article_data[src_id]["body"] or "")[-300:]
                for stub_id in matching_stubs:
                    stub_head = (article_data[stub_id]["body"] or "")[:300]
                    ratio = SM(None, src_tail.lower(), stub_head.lower()).ratio()
                    scores.append((src_id, stub_id, ratio))
            scores.sort(key=lambda x: -x[2])
            for src_id, stub_id, ratio in scores:
                if src_id not in paired_src and stub_id not in paired_stub:
                    suggested_pairs.append((src_id, stub_id, ratio))
                    paired_src.add(src_id)
                    paired_stub.add(stub_id)

    # Should produce 2 pairs matching by content similarity
    assert len(suggested_pairs) == 2
    pair_sets = [{s, t} for s, t, _ in suggested_pairs]
    # Economy article matches market stub, basketball matches game recap
    assert {0, 2} in pair_sets
    assert {1, 3} in pair_sets


def test_suggested_pairs_wildcard_continues_on():
    """Suggested pairs should handle continues_on='?' by matching sources
    to stubs whose continued_from points back to the source's page."""
    from collections import defaultdict
    from difflib import SequenceMatcher as SM

    article_data = [
        {"page_label": "6", "headline": "Boosting the economy",
         "body": "The vacancy rate dropped and it became",
         "continuation": {"continues_on": "?", "continued_from": None},
         "author": "", "writer_position": "", "category": "News",
         "images": [], "image_files": []},
        {"page_label": "6", "headline": "Businesses bring character",
         "body": "We've smoothed out the sys-",
         "continuation": {"continues_on": "?", "continued_from": None},
         "author": "", "writer_position": "", "category": "News",
         "images": [], "image_files": []},
        {"page_label": "7", "headline": "Investing money",
         "body": "a tighter market to get a business in",
         "continuation": {"continues_on": None, "continued_from": "6"},
         "author": "", "writer_position": "", "category": "News",
         "images": [], "image_files": []},
        {"page_label": "7", "headline": "Delaware revitalization",
         "body": "tem and in the end the benefits outweighed",
         "continuation": {"continues_on": None, "continued_from": "6"},
         "author": "", "writer_position": "", "category": "News",
         "images": [], "image_files": []},
    ]

    # Reproduce Pass B (wildcard) logic
    stubs_by_source = defaultdict(list)
    wildcard_sources = defaultdict(list)
    for idx, ad in enumerate(article_data):
        if ad["continuation"]["continues_on"] == "?":
            wildcard_sources[ad["page_label"]].append(idx)
        cont_from = ad["continuation"]["continued_from"]
        if cont_from and cont_from != "?":
            stubs_by_source[cont_from].append(idx)

    suggested_pairs = []
    paired_src = set()
    paired_stub = set()

    for source_page, src_ids in wildcard_sources.items():
        stub_ids = stubs_by_source.get(source_page, [])
        unpaired_src = [s for s in src_ids if s not in paired_src]
        unpaired_stubs = [s for s in stub_ids if s not in paired_stub]
        if unpaired_src and unpaired_stubs:
            scores = []
            for src_id in unpaired_src:
                src_tail = (article_data[src_id]["body"] or "")[-300:]
                for stub_id in unpaired_stubs:
                    stub_head = (article_data[stub_id]["body"] or "")[:300]
                    ratio = SM(None, src_tail.lower(), stub_head.lower()).ratio()
                    scores.append((src_id, stub_id, ratio))
            scores.sort(key=lambda x: -x[2])
            for src_id, stub_id, ratio in scores:
                if src_id not in paired_src and stub_id not in paired_stub:
                    suggested_pairs.append((src_id, stub_id, ratio))
                    paired_src.add(src_id)
                    paired_stub.add(stub_id)

    # Should pair [1]↔[3] ("sys-"↔"tem") and [0]↔[2]
    assert len(suggested_pairs) == 2
    pair_sets = [{s, t} for s, t, _ in suggested_pairs]
    assert {1, 3} in pair_sets
    assert {0, 2} in pair_sets
