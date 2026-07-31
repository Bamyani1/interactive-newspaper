"""LLM-assisted, lossless cross-page article grouping and seam review."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections import Counter
from typing import Literal

from google.genai import types
from pydantic import BaseModel, ConfigDict, Field

from ..config.model_calls import build_generation_config, model_name
from ..contracts.content_models import (
    EditionContent,
    MergedArticle,
    PageContent,
)
from ..contracts.diagnostics_models import MergePassDiagnostics, PipelineReport, StageTimer, TokenUsage
from ..postprocessing.deduplication import _deduplicate_ads, _deduplicate_other_content
from ..shared.console import info, substep, warning
from ..shared.retry import gemini_generate_with_retry
from ..shared.text import split_sentences


_LOCKED_MERGE_MODEL = "gemini-3.6-flash"
_ANCHOR_SIMILARITY_MIN = 0.90
_RAW_CONTEXT_CHARS = 600
_SENTENCE_CONTEXT_CHARS = 800

_GROUPING_SYSTEM_PROMPT = """You decide which OCR-extracted newspaper article fragments are continuations of the same article and identify source reprints.

Return a complete partition of every supplied fragment_id. Each fragment_id must occur exactly once. Put fragments that belong to one cross-page article in one group, in exact reading order. Keep unrelated or uncertain fragments as singleton groups.

Every adjacent pair in a multi-fragment group must have a structured continuation signal: the left fragment has continues_on, the right fragment has continued_from, or both. Printed folio references are useful evidence but can be wrong in the source newspaper; do not require their digits to equal the supplied scan/canvas labels. Use the continuation signals, headlines, bylines, and compact boundary context together to decide the actual route. Text similarity alone is never sufficient for a continuation.

Separately, source_duplicate_groups may identify the same substantially complete source article printed more than once, even under a different accidental headline or with an inserted display pull quote. Each duplicate group must contain at least two IDs that remain singleton continuation groups. Do not use this for related coverage, follow-ups, summaries, or articles that merely share a topic. Python will independently require at least 90% ordered word similarity before accepting the decision.

Python has not pre-merged or semantically ranked any pair. Do not return article text, rewritten text, headlines, authors, metadata, confidence scores, or explanations; return immutable fragment IDs only."""

_SEAM_SYSTEM_PROMPT = """Review every supplied boundary between fragments that have already been grouped as one newspaper article. Every boundary must receive exactly one result, even if punctuation makes it look clean.

Actions:
- KEEP: the default exact join (two newlines between the unchanged fragments) is correct. Return no anchors or replacement text.
- REPAIR: only the local cross-page seam needs repair. Copy an unambiguous suffix anchor from the left fragment and an unambiguous prefix anchor from the right fragment, using at least six words when available. replacement_text must replace only those two anchors and must preserve source wording and order except for the smallest necessary seam fix.
- UNRESOLVED: the context is insufficient for a safe local repair. Preserve the default exact join without guessing, and return no anchors or replacement text.

Never rewrite the surrounding article. Never invent, remove, or alter names, numbers, dates, prices, or phone numbers. Return every boundary_id exactly once."""


class MergeGroupDecision(BaseModel):
    """One ordered article group returned by the edition-level grouping call."""

    model_config = ConfigDict(extra="forbid")

    fragment_ids: list[str] = Field(min_length=1)


class EditionGroupingResponse(BaseModel):
    """Complete partition of all immutable edition fragment IDs."""

    model_config = ConfigDict(extra="forbid")

    groups: list[MergeGroupDecision]
    source_duplicate_groups: list[list[str]] = Field(default_factory=list)


class SeamBoundaryDecision(BaseModel):
    """A localized decision for one adjacent boundary."""

    model_config = ConfigDict(extra="forbid")

    boundary_id: str
    action: Literal["KEEP", "REPAIR", "UNRESOLVED"]
    left_anchor_text: str = ""
    right_anchor_text: str = ""
    replacement_text: str = ""
    reason_code: str = ""


class EditionSeamResponse(BaseModel):
    """All boundary decisions returned by the single seam-review call."""

    model_config = ConfigDict(extra="forbid")

    boundaries: list[SeamBoundaryDecision]


def _finalize_merge_diagnostics(
    md: MergePassDiagnostics | None,
    merge_timer: StageTimer,
    report: PipelineReport | None,
) -> None:
    """Attach merge diagnostics to the pipeline report and stop the timer."""
    if md is not None:
        md.time_seconds = merge_timer.stop()
        if report is not None:
            report.merge_pass = md


def _stable_fragment_id(
    edition_index: int,
    source_filename: str,
    page_label: str,
    article_index: int,
    headline: str,
    body: str,
) -> str:
    """Build a compact ID that is stable for an immutable page-stage result."""
    source = "\x1f".join(
        (source_filename, page_label, str(article_index), headline or "", body or "")
    )
    digest = hashlib.sha256(source.encode("utf-8")).hexdigest()[:12]
    return f"fragment-{edition_index:04d}-{digest}"


def _bounded_sentence(text: str, *, from_end: bool) -> str:
    if len(text) <= _SENTENCE_CONTEXT_CHARS:
        return text
    return text[-_SENTENCE_CONTEXT_CHARS:] if from_end else text[:_SENTENCE_CONTEXT_CHARS]


def _compact_context(text: str) -> dict[str, object]:
    """Return first/last two sentence-like units plus raw OCR fallbacks."""
    body = (text or "").strip()
    sentences = split_sentences(body)
    head = [_bounded_sentence(s, from_end=False) for s in sentences[:2]]
    tail = [_bounded_sentence(s, from_end=True) for s in sentences[-2:]]
    return {
        "head_sentences": head,
        "tail_sentences": tail,
        "raw_head": body[:_RAW_CONTEXT_CHARS],
        "raw_tail": body[-_RAW_CONTEXT_CHARS:],
    }


def _response_as(response, model_type):
    """Strictly coerce an SDK parsed response (or its JSON text) to a model."""
    parsed = getattr(response, "parsed", None)
    if isinstance(parsed, model_type):
        return parsed
    if isinstance(parsed, BaseModel):
        return model_type.model_validate(parsed.model_dump())
    if isinstance(parsed, dict):
        return model_type.model_validate(parsed)
    raw = getattr(response, "text", None)
    if isinstance(raw, str) and raw.strip():
        return model_type.model_validate_json(raw)
    raise ValueError("Gemini returned no parseable structured response")


def _generate_locked_content(
    client,
    *,
    contents: list,
    response_schema,
    response_validator=None,
    schema_retry_instruction=None,
):
    """Make one logical request with the locked model and thinking level.

    The shared retry wrapper preserves the requested model and complete config
    on every transport/schema attempt. Those attempts remain one logical stage
    call; exhausted failures are handled losslessly by the caller.
    """
    stage = "merge" if response_schema is EditionGroupingResponse else "seam_repair"
    configured_model = model_name(stage)
    if configured_model != _LOCKED_MERGE_MODEL:
        raise RuntimeError(
            f"Locked {stage} model must be {_LOCKED_MERGE_MODEL}, got {configured_model}"
        )
    config = build_generation_config(
        stage,
        system_instruction=(
            _GROUPING_SYSTEM_PROMPT
            if response_schema is EditionGroupingResponse
            else _SEAM_SYSTEM_PROMPT
        ),
        response_mime_type="application/json",
        response_schema=response_schema,
        max_output_tokens=65536,
    )
    if config.thinking_config is None or config.thinking_config.thinking_level not in (
        types.ThinkingLevel.MEDIUM,
        "medium",
        "MEDIUM",
    ):
        raise RuntimeError(f"Locked {stage} thinking level must be MEDIUM")
    return gemini_generate_with_retry(
        client,
        model=configured_model,
        contents=contents,
        config=config,
        stage=stage,
        response_validator=(
            response_validator
            or (lambda response: getattr(response, "parsed", None) is not None)
        ),
        schema_retry_instruction=schema_retry_instruction,
    )


def _add_usage(md: MergePassDiagnostics | None, response) -> None:
    if md is None:
        return
    usage = getattr(response, "usage_metadata", None)
    if usage is None:
        return
    md.tokens.prompt_tokens += getattr(usage, "prompt_token_count", None) or 0
    md.tokens.candidates_tokens += getattr(usage, "candidates_token_count", None) or 0
    md.tokens.thoughts_tokens += getattr(usage, "thoughts_token_count", None) or 0
    md.tokens.tool_use_prompt_tokens += (
        getattr(usage, "tool_use_prompt_token_count", None) or 0
    )
    md.tokens.cached_content_tokens += (
        getattr(usage, "cached_content_token_count", None) or 0
    )
    md.tokens.total_tokens += getattr(usage, "total_token_count", None) or 0


def _validate_complete_partition(
    response: EditionGroupingResponse,
    fragment_ids: list[str],
    article_by_id: dict[str, dict],
) -> list[list[str]]:
    """Require an exact partition and structured evidence for every merge edge."""
    expected = set(fragment_ids)
    seen: list[str] = []
    groups: list[list[str]] = []
    for group in response.groups:
        ids = list(group.fragment_ids)
        if not ids or len(ids) != len(set(ids)):
            raise ValueError("group contains no IDs or duplicate IDs")
        if any(fragment_id not in expected for fragment_id in ids):
            raise ValueError("group contains an unknown fragment ID")
        seen.extend(ids)
        groups.append(ids)

    if len(seen) != len(set(seen)):
        raise ValueError("fragment ID appears in more than one group")
    if set(seen) != expected or len(seen) != len(fragment_ids):
        missing = sorted(expected - set(seen))
        extra = sorted(set(seen) - expected)
        raise ValueError(f"partition is incomplete (missing={missing}, extra={extra})")
    validated_groups: list[list[str]] = []
    for group in groups:
        if len(group) == 1:
            validated_groups.append(group)
            continue
        invalid_edges = [
            (left_id, right_id)
            for left_id, right_id in zip(group, group[1:])
            if not _has_structured_continuation_edge(
                article_by_id[left_id],
                article_by_id[right_id],
            )
        ]
        if invalid_edges:
            warning(
                "Rejecting multi-fragment group without structured continuation "
                f"evidence at edges {invalid_edges}; preserving its fragments"
            )
            validated_groups.extend([[fragment_id] for fragment_id in group])
            continue
        validated_groups.append(group)
    return validated_groups


def _validated_source_duplicate_groups(
    response: EditionGroupingResponse,
    groups: list[list[str]],
    article_by_id: dict[str, dict],
) -> list[list[str]]:
    """Accept only model-selected reprints with strong independent text evidence."""
    singleton_ids = {group[0] for group in groups if len(group) == 1}
    claimed: set[str] = set()
    accepted: list[list[str]] = []
    for proposed in response.source_duplicate_groups:
        ids = list(proposed)
        if len(ids) < 2 or len(ids) != len(set(ids)):
            continue
        if any(fragment_id not in singleton_ids or fragment_id in claimed for fragment_id in ids):
            continue
        ordered = sorted(ids, key=lambda item: article_by_id[item]["edition_index"])
        reference = article_by_id[ordered[0]]["body"]
        if len(_word_tokens(reference)) < 100:
            continue
        if any(
            len(_word_tokens(article_by_id[item]["body"])) < 100
            or normalized_word_similarity(reference, article_by_id[item]["body"])
            < _ANCHOR_SIMILARITY_MIN
            for item in ordered[1:]
        ):
            continue
        accepted.append(ordered)
        claimed.update(ordered)
    return accepted


def _normalized_page_reference(value: object) -> str:
    text = str(value or "").strip()
    if not text or text == "?":
        return ""
    if text.isdigit():
        return str(int(text))
    match = re.search(r"\d+", text)
    return str(int(match.group(0))) if match else text.casefold()


def _has_structured_continuation_edge(left: dict, right: dict) -> bool:
    """Require continuation roles while leaving route semantics to Gemini.

    Historic newspapers sometimes print the wrong destination/source folio.
    Requiring those digits to equal manifest canvas labels would veto a model's
    otherwise correct, context-supported decision. Python therefore verifies
    only that the proposed edge has an origin/destination continuation signal;
    it never creates an edge from body text or similarity alone.
    """
    left_target = _normalized_page_reference(
        left.get("continuation", {}).get("continues_on")
    )
    right_source = _normalized_page_reference(
        right.get("continuation", {}).get("continued_from")
    )
    return bool(left_target or right_source)


_WORD_RE = re.compile(r"\w+(?:[\u2019'\-]\w+)*", re.UNICODE)
_MONTHS = {
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
    "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept",
    "oct", "nov", "dec",
}


def _normal_word(token: str) -> str:
    return unicodedata.normalize("NFKC", token).casefold().replace("\u2019", "'")


def _word_tokens(text: str) -> list[str]:
    return [_normal_word(match.group(0)) for match in _WORD_RE.finditer(text or "")]


def normalized_word_similarity(left: str, right: str) -> float:
    """Token edit similarity used for the locked 90% fidelity threshold."""
    a = _word_tokens(left)
    b = _word_tokens(right)
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    previous = list(range(len(b) + 1))
    for row_index, left_token in enumerate(a, start=1):
        current = [row_index]
        for column_index, right_token in enumerate(b, start=1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[column_index] + 1,
                    previous[column_index - 1] + (left_token != right_token),
                )
            )
        previous = current
    return 1.0 - (previous[-1] / max(len(a), len(b)))


def _anchored_span(source: str, anchor: str, *, side: Literal["suffix", "prefix"]):
    """Find one unique >=90% word match anchored to the requested edge."""
    source_matches = list(_WORD_RE.finditer(source or ""))
    anchor_words = _word_tokens(anchor)
    word_count = len(anchor_words)
    if not source_matches or not anchor_words or word_count > len(source_matches):
        return None
    minimum_words = min(6, len(source_matches))
    if word_count < minimum_words:
        return None

    source_words = [_normal_word(match.group(0)) for match in source_matches]
    expected_start = len(source_words) - word_count if side == "suffix" else 0
    expected_words = source_words[expected_start : expected_start + word_count]
    score = normalized_word_similarity(" ".join(expected_words), " ".join(anchor_words))
    if score < _ANCHOR_SIMILARITY_MIN:
        return None

    qualifying_starts = []
    for start in range(0, len(source_words) - word_count + 1):
        candidate = " ".join(source_words[start : start + word_count])
        if normalized_word_similarity(candidate, " ".join(anchor_words)) >= _ANCHOR_SIMILARITY_MIN:
            qualifying_starts.append(start)
    if qualifying_starts != [expected_start]:
        return None

    if side == "suffix":
        start_char = source_matches[expected_start].start()
        end_char = len(source)
    else:
        start_char = 0
        next_word_index = expected_start + word_count
        end_char = (
            source_matches[next_word_index].start()
            if next_word_index < len(source_matches)
            else len(source)
        )
    return start_char, end_char


def _protected_tokens(text: str) -> list[str]:
    """Return immutable names and numeric/date/price/phone tokens in order."""
    protected = []
    for match in _WORD_RE.finditer(text or ""):
        token = match.group(0)
        normal = _normal_word(token)
        before = (text or "")[max(0, match.start() - 2) : match.start()]
        if (
            any(character.isdigit() for character in token)
            or any(currency in before for currency in ("$", "\u00a3", "\u20ac"))
            or normal in _MONTHS
            or token[:1].isupper()
            or (len(token) > 1 and token.isupper())
        ):
            protected.append(normal)
    return protected


def _validated_repair(
    left_body: str,
    right_body: str,
    decision: SeamBoundaryDecision,
):
    """Validate a localized repair and return source spans when safe."""
    left_span = _anchored_span(left_body, decision.left_anchor_text, side="suffix")
    right_span = _anchored_span(right_body, decision.right_anchor_text, side="prefix")
    if left_span is None or right_span is None:
        return None

    source_text = (
        left_body[left_span[0] : left_span[1]]
        + " "
        + right_body[right_span[0] : right_span[1]]
    )
    replacement = decision.replacement_text.strip()
    if not replacement:
        return None
    if normalized_word_similarity(source_text, replacement) < _ANCHOR_SIMILARITY_MIN:
        return None
    if _protected_tokens(source_text) != _protected_tokens(replacement):
        return None
    return left_span, right_span, replacement


def _boundary_id(group_index: int, position: int, left_id: str, right_id: str) -> str:
    digest = hashlib.sha256(f"{left_id}\x1f{right_id}".encode("utf-8")).hexdigest()[:12]
    return f"boundary-{group_index:04d}-{position:03d}-{digest}"


def _build_boundary_records(
    groups: list[list[str]],
    article_by_id: dict[str, dict],
) -> tuple[list[dict], dict[str, tuple[int, int, str, str]], dict[str, str]]:
    """Create every adjacent boundary without punctuation or regex gating."""
    records: list[dict] = []
    boundary_index: dict[str, tuple[int, int, str, str]] = {}
    working_bodies: dict[str, str] = {}

    for group_index, group in enumerate(groups):
        for fragment_id in group:
            working_bodies[fragment_id] = article_by_id[fragment_id]["body"]
        if len(group) < 2:
            continue
        for position, (left_id, right_id) in enumerate(zip(group, group[1:])):
            boundary_id = _boundary_id(group_index, position, left_id, right_id)
            left_body = working_bodies[left_id]
            right_body = working_bodies[right_id]
            records.append(
                {
                    "boundary_id": boundary_id,
                    "group_index": group_index,
                    "position": position,
                    "left_fragment_id": left_id,
                    "right_fragment_id": right_id,
                    "left_page": article_by_id[left_id]["page_label"],
                    "right_page": article_by_id[right_id]["page_label"],
                    "left_context": {
                        "sentences": _compact_context(left_body)["tail_sentences"],
                        "raw_fallback": left_body[-_RAW_CONTEXT_CHARS:],
                    },
                    "right_context": {
                        "sentences": _compact_context(right_body)["head_sentences"],
                        "raw_fallback": right_body[:_RAW_CONTEXT_CHARS],
                    },
                    "default_join": "\\n\\n",
                }
            )
            boundary_index[boundary_id] = (group_index, position, left_id, right_id)
    return records, boundary_index, working_bodies


def _seam_response_validation_reason(
    response,
    boundary_index: dict[str, tuple[int, int, str, str]],
    working_bodies: dict[str, str],
) -> str:
    """Return a sanitized semantic-contract failure for one seam response."""
    try:
        parsed = _response_as(response, EditionSeamResponse)
    except Exception:
        return "parsed seam output is missing or has the wrong response type."

    expected = set(boundary_index)
    counts = Counter(decision.boundary_id for decision in parsed.boundaries)
    returned = set(counts)
    if returned != expected:
        return (
            f"boundary IDs must be exactly {sorted(expected)}; received "
            f"{sorted(returned)}."
        )
    duplicates = sorted(boundary_id for boundary_id, count in counts.items() if count != 1)
    if duplicates:
        return f"boundary IDs must occur once; invalid counts for {duplicates}."

    for decision in parsed.boundaries:
        if decision.action in {"KEEP", "UNRESOLVED"}:
            if (
                decision.left_anchor_text
                or decision.right_anchor_text
                or decision.replacement_text
            ):
                return (
                    f"boundary {decision.boundary_id} action {decision.action} "
                    "must return empty anchors and replacement_text."
                )
            continue
        _group, _position, left_id, right_id = boundary_index[decision.boundary_id]
        if _validated_repair(
            working_bodies[left_id],
            working_bodies[right_id],
            decision,
        ) is None:
            return (
                f"boundary {decision.boundary_id} REPAIR failed the unique-edge "
                "anchor, 90% ordered-word, or protected-value safety check. "
                "Return corrected source-faithful anchors/replacement, KEEP, or "
                "UNRESOLVED."
            )
    return ""


def _assemble_reviewed_group(
    group: list[str],
    group_index: int,
    decisions_by_id: dict[str, SeamBoundaryDecision],
    duplicate_decision_ids: set[str],
    working_bodies: dict[str, str],
):
    """Apply a complete seam plan atomically; return None on any unsafe edge."""
    starts = {fragment_id: 0 for fragment_id in group}
    ends = {fragment_id: len(working_bodies[fragment_id]) for fragment_id in group}
    joiners: list[str] = []

    for position, (left_id, right_id) in enumerate(zip(group, group[1:])):
        boundary_id = _boundary_id(group_index, position, left_id, right_id)
        decision = decisions_by_id.get(boundary_id)
        if decision is None or boundary_id in duplicate_decision_ids:
            return None
        if decision.action == "UNRESOLVED":
            if decision.left_anchor_text or decision.right_anchor_text or decision.replacement_text:
                return None
            joiners.append("\n\n")
            continue
        if decision.action == "KEEP":
            if decision.left_anchor_text or decision.right_anchor_text or decision.replacement_text:
                return None
            joiners.append("\n\n")
            continue

        repair = _validated_repair(
            working_bodies[left_id],
            working_bodies[right_id],
            decision,
        )
        if repair is None:
            return None
        left_span, right_span, replacement = repair
        ends[left_id] = left_span[0]
        starts[right_id] = right_span[1]
        joiners.append(replacement)

    for fragment_id in group:
        if starts[fragment_id] > ends[fragment_id]:
            return None

    assembled = working_bodies[group[0]][starts[group[0]] : ends[group[0]]].rstrip()
    for index, fragment_id in enumerate(group[1:]):
        joiner = joiners[index]
        fragment = working_bodies[fragment_id][starts[fragment_id] : ends[fragment_id]]
        if joiner == "\n\n":
            assembled += joiner + fragment.lstrip()
        else:
            if assembled and not assembled.endswith((" ", "\n")):
                assembled += " "
            assembled += joiner.strip()
            if fragment and not fragment.startswith((" ", "\n")):
                assembled += " "
            assembled += fragment.lstrip()
    return assembled.strip()


def _singleton(article: dict) -> MergedArticle:
    """Render an immutable source fragment without stripping or normalization."""
    merged = MergedArticle(
        headline=article["headline"],
        author=article["author"],
        writer_position=article["writer_position"],
        category=article["category"],
        continues_on=article["continuation"].get("continues_on") or "",
        continued_from=article["continuation"].get("continued_from") or "",
        body=article["body"],
        images=list(article["images"]),
        image_files=list(article["image_files"]),
        source_pages=[article["page_label"]],
    )
    merged._category_fallback_used = bool(article.get("category_fallback_used"))
    merged._source_pages_internal = [article["page_label"]]
    return merged


def _merged_record(group: list[str], body: str, article_by_id: dict[str, dict]) -> MergedArticle:
    """Mechanically assemble the earliest nonempty source metadata."""
    source_articles = [article_by_id[fragment_id] for fragment_id in group]

    def earliest_nonempty(field: str, default: str = "") -> str:
        for article in source_articles:
            value = str(article.get(field) or "")
            if value.strip():
                return value
        return default

    source_pages: list[str] = []
    images = []
    image_files: list[str] = []
    for article in source_articles:
        if article["page_label"] not in source_pages:
            source_pages.append(article["page_label"])
        images.extend(list(article["images"]))
        image_files.extend(list(article["image_files"]))

    # Only continuation edges outside this successfully merged group survive.
    group_pages = set(source_pages)
    continued_from = source_articles[0]["continuation"].get("continued_from") or ""
    tail_continues_on = source_articles[-1]["continuation"].get("continues_on") or ""
    if continued_from in group_pages:
        continued_from = ""
    if tail_continues_on in group_pages:
        tail_continues_on = ""

    merged = MergedArticle(
        headline=earliest_nonempty("headline"),
        author=earliest_nonempty("author"),
        writer_position=earliest_nonempty("writer_position"),
        category=earliest_nonempty("category", "News"),
        continues_on=tail_continues_on,
        continued_from=continued_from,
        body=body,
        images=images,
        image_files=image_files,
        source_pages=source_pages,
    )
    merged._category_fallback_used = any(
        bool(article.get("category_fallback_used")) for article in source_articles
    )
    merged._source_pages_internal = list(source_pages)
    return merged


def _source_duplicate_record(group: list[str], article_by_id: dict[str, dict]) -> MergedArticle:
    """Retain the earliest source copy while preserving all page/image evidence."""
    earliest = _singleton(article_by_id[group[0]])
    for fragment_id in group[1:]:
        duplicate = article_by_id[fragment_id]
        page = duplicate["page_label"]
        if page not in earliest.source_pages:
            earliest.source_pages.append(page)
        if page not in earliest._source_pages_internal:
            earliest._source_pages_internal.append(page)
        for image, image_file in zip(duplicate["images"], duplicate["image_files"]):
            if image_file not in earliest.image_files:
                earliest.images.append(image)
                earliest.image_files.append(image_file)
        earliest._category_fallback_used = (
            earliest._category_fallback_used
            or bool(duplicate.get("category_fallback_used"))
        )
    return earliest


def merge_edition_articles(
    client,
    page_results: list[tuple[str, PageContent]],
    report: PipelineReport | None = None,
) -> EditionContent | None:
    """Group all available edition fragments, then review all seams in one batch.

    Missing pages do not globally block this stage: the grouping partition covers
    every available fragment. Any invalid grouping response falls back to all
    singletons; any invalid seam falls back atomically for only its merge group.
    """
    merge_timer = StageTimer().start()
    md = MergePassDiagnostics() if report is not None else None
    if md is not None:
        md.tokens = TokenUsage()

    article_data: list[dict] = []
    all_ads = []
    all_other = []
    edition_index = 0
    for source_filename, page_content in page_results:
        page_label = str(page_content.page_number or source_filename)
        all_ads.extend(page_content.ads)
        all_other.extend(page_content.other_content)
        for article_index, article in enumerate(page_content.articles):
            continuation = {
                "continues_on": article.continues_on or "",
                "continued_from": article.continued_from or "",
            }
            fragment_id = _stable_fragment_id(
                edition_index,
                source_filename,
                page_label,
                article_index,
                article.headline,
                article.body,
            )
            article_data.append(
                {
                    "fragment_id": fragment_id,
                    "edition_index": edition_index,
                    "page_label": page_label,
                    "headline": article.headline,
                    "author": article.author,
                    "writer_position": article.writer_position,
                    "category": article.category,
                    "category_fallback_used": article._category_fallback_used,
                    "body": article.body,
                    "images": list(article.images),
                    "image_files": list(article.image_files),
                    "continuation": continuation,
                }
            )
            edition_index += 1

    if not article_data:
        info("No articles found to merge.")
        _finalize_merge_diagnostics(md, merge_timer, report)
        return None

    if md is not None:
        md.articles_before_merge = len(article_data)

    article_by_id = {article["fragment_id"]: article for article in article_data}
    fragment_ids = [article["fragment_id"] for article in article_data]
    groups: list[list[str]]
    source_duplicate_groups: list[list[str]] = []
    grouping_failed = False
    if len(article_data) == 1:
        groups = [fragment_ids]
    else:
        grouping_request = {
            "schema_version": "edition-grouping-request.v1",
            "fragments": [
                {
                    "fragment_id": article["fragment_id"],
                    "page": article["page_label"],
                    "headline": article["headline"],
                    "author": article["author"],
                    "writer_position": article["writer_position"],
                    "continues_on": article["continuation"]["continues_on"],
                    "continued_from": article["continuation"]["continued_from"],
                    **_compact_context(article["body"]),
                }
                for article in article_data
            ],
        }
        try:
            grouping_response = _generate_locked_content(
                client,
                contents=[json.dumps(grouping_request, ensure_ascii=False)],
                response_schema=EditionGroupingResponse,
            )
            parsed_grouping = _response_as(grouping_response, EditionGroupingResponse)
            _add_usage(md, grouping_response)
            groups = _validate_complete_partition(parsed_grouping, fragment_ids, article_by_id)
            source_duplicate_groups = _validated_source_duplicate_groups(
                parsed_grouping,
                groups,
                article_by_id,
            )
            substep(f"Grouping call partitioned {len(fragment_ids)} fragments into {len(groups)} groups")
            if source_duplicate_groups:
                substep(
                    f"Grouping call identified {len(source_duplicate_groups)} "
                    "validated source reprint group(s)"
                )
        except Exception as exc:
            grouping_failed = True
            groups = [[fragment_id] for fragment_id in fragment_ids]
            warning(f"Edition grouping failed validation; preserving every source fragment: {exc}")
            if md is not None:
                md.error = f"grouping_unresolved — {exc}"
                md.merge_skipped = True

    # Keep edition ordering stable without changing model-selected order inside a group.
    groups.sort(key=lambda group: min(article_by_id[fragment_id]["edition_index"] for fragment_id in group))
    duplicate_by_survivor = {group[0]: group for group in source_duplicate_groups}
    duplicate_dropped = {
        fragment_id for group in source_duplicate_groups for fragment_id in group[1:]
    }
    boundary_records, boundary_index, working_bodies = _build_boundary_records(groups, article_by_id)
    decisions_by_id: dict[str, SeamBoundaryDecision] = {}
    duplicate_decision_ids: set[str] = set()
    seam_call_failed = False

    if boundary_records and not grouping_failed:
        seam_request = {
            "schema_version": "edition-seam-request.v1",
            "boundaries": boundary_records,
        }
        try:
            seam_response = _generate_locked_content(
                client,
                contents=[json.dumps(seam_request, ensure_ascii=False)],
                response_schema=EditionSeamResponse,
                response_validator=lambda candidate: not _seam_response_validation_reason(
                    candidate,
                    boundary_index,
                    working_bodies,
                ),
                schema_retry_instruction=lambda candidate: (
                    _seam_response_validation_reason(
                        candidate,
                        boundary_index,
                        working_bodies,
                    )
                ),
            )
            parsed_seams = _response_as(seam_response, EditionSeamResponse)
            _add_usage(md, seam_response)
            counts = Counter(decision.boundary_id for decision in parsed_seams.boundaries)
            duplicate_decision_ids = {
                boundary_id for boundary_id, count in counts.items() if count > 1
            }
            decisions_by_id = {
                decision.boundary_id: decision
                for decision in parsed_seams.boundaries
                if decision.boundary_id in boundary_index
            }
            unknown = sorted(set(counts) - set(boundary_index))
            if unknown:
                raise ValueError(f"seam response contains unknown boundary IDs: {unknown}")
            substep(f"Seam call reviewed {len(boundary_records)} adjacent boundaries")
        except Exception as exc:
            seam_call_failed = True
            warning(f"Edition seam review failed; preserving all affected groups: {exc}")
            if md is not None:
                md.error = f"seam_review_unresolved — {exc}"

    merged_articles: list[MergedArticle] = []
    accepted_multi_groups = 0
    singleton_count = 0
    unresolved_groups = 0
    for group_index, group in enumerate(groups):
        if len(group) == 1:
            if group[0] in duplicate_dropped:
                continue
            if group[0] in duplicate_by_survivor:
                merged_articles.append(
                    _source_duplicate_record(
                        duplicate_by_survivor[group[0]],
                        article_by_id,
                    )
                )
                singleton_count += 1
                continue
            merged_articles.append(_singleton(article_by_id[group[0]]))
            singleton_count += 1
            continue

        assembled = None
        if not seam_call_failed:
            assembled = _assemble_reviewed_group(
                group,
                group_index,
                decisions_by_id,
                duplicate_decision_ids,
                working_bodies,
            )
        if assembled is None:
            unresolved_groups += 1
            # Grouping has already established that these immutable fragments
            # are one article. A missing/unsafe seam edit must not undo that
            # semantic decision. Discard the proposed edit and use the exact,
            # ordered source bodies with the default paragraph join.
            assembled = "\n\n".join(working_bodies[fragment_id] for fragment_id in group)
            merged_articles.append(_merged_record(group, assembled, article_by_id))
            accepted_multi_groups += 1
            continue

        merged_articles.append(_merged_record(group, assembled, article_by_id))
        accepted_multi_groups += 1

    if unresolved_groups and md is not None:
        md.duplicate_warnings.append(f"lossless_unresolved_merge_groups={unresolved_groups}")
        if not md.error:
            md.error = f"seam_unresolved_groups={unresolved_groups}"

    all_ads = _deduplicate_ads(all_ads)
    all_other = _deduplicate_other_content(all_other)

    if md is not None:
        md.articles_after_merge = len(merged_articles)
        md.singleton_groups = singleton_count
        md.multi_article_groups = accepted_multi_groups
    _finalize_merge_diagnostics(md, merge_timer, report)

    return EditionContent.model_construct(
        articles=merged_articles,
        ads=all_ads,
        other_content=all_other,
    )


__all__ = [
    "EditionGroupingResponse",
    "EditionSeamResponse",
    "MergeGroupDecision",
    "SeamBoundaryDecision",
    "_ANCHOR_SIMILARITY_MIN",
    "merge_edition_articles",
    "normalized_word_similarity",
]
