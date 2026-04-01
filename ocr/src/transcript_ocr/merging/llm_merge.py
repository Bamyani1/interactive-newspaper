"""LLM-assisted cross-page article merge orchestration."""

from __future__ import annotations

import os
import re
from collections import defaultdict
from difflib import SequenceMatcher as SM

from google.genai import types

from ..config.constants import GEMINI_MERGE_MODEL, GEMINI_PAGE_MODEL, GEMINI_STRUCTURING_MODEL
from ..contracts.content_models import (
    ArticleImage,
    EditionContent,
    MergeDecisions,
    MergeInstruction,
    MergedArticle,
    OtherContent,
    PageContent,
)
from ..contracts.diagnostics_models import MergePassDiagnostics, PipelineReport, StageTimer, TokenUsage
from ..diagnostics.snapshots import save_snapshot
from ..postprocessing.byline_cleanup import _dedup_byline_from_body, _extract_byline_from_body, _normalize_byline, _split_author_position
from ..postprocessing.deduplication import _deduplicate_ads, _deduplicate_other_content
from ..recognition.prompts import MERGE_PROMPT, SAFETY_OFF
from ..shared.retry import gemini_generate_with_retry
from ..shared.console import substep, warning, error, info
from ..postprocessing.proper_noun_corrections import (
    _apply_edition_proper_noun_corrections,
    _check_edition_proper_nouns,
)
from .boundary_cleanup import clean_merge_boundary
from .continuation import _extract_continuation_info, _strip_continuation_markers
from .deterministic_merge import _deterministic_merge
from .merge_sanitizer import (
    _choose_merged_category,
    _reconcile_image_alignment,
    _sanitize_merged_articles,
    _strip_trailing_captions,
)


def _build_deterministic_decisions(
    article_data: list[dict], pre_merged: list[list[int]]
) -> MergeDecisions:
    """Build MergeDecisions from deterministic pre-merged groups.

    Used as fallback when the LLM merge call fails (safety block, parse error,
    network timeout). Every pre-merged group becomes a MergeInstruction; every
    ungrouped article becomes a singleton.
    """
    grouped: set[int] = set()
    groups: list[MergeInstruction] = []

    for member_ids in pre_merged:
        grouped.update(member_ids)
        # Pick best headline: longest non-stub (>20 chars), falling back to first
        headlines = [article_data[i]["headline"] or "" for i in member_ids]
        best_headline = max(headlines, key=lambda h: len(h) if len(h) > 20 else 0) or headlines[0]
        # First non-empty author / writer_position
        author = next((article_data[i]["author"] for i in member_ids if article_data[i].get("author")), "")
        position = next((article_data[i].get("writer_position") for i in member_ids if article_data[i].get("writer_position")), "")
        groups.append(
            MergeInstruction(
                article_ids=list(member_ids),
                merged_headline=best_headline,
                merged_author=author,
                merged_writer_position=position,
                confidence=1.0,
            )
        )

    # Singletons for ungrouped articles
    for idx in range(len(article_data)):
        if idx not in grouped:
            ad = article_data[idx]
            groups.append(
                MergeInstruction(
                    article_ids=[idx],
                    merged_headline=ad["headline"] or "",
                    merged_author=ad.get("author", ""),
                    merged_writer_position=ad.get("writer_position", ""),
                    confidence=1.0,
                )
            )

    return MergeDecisions(groups=groups)


def _best_body(bodies: list[str]) -> str:
    """De-duplicate near-identical bodies, preserving input order."""
    if len(bodies) <= 1:
        return bodies[0] if bodies else ""

    from difflib import SequenceMatcher

    to_remove: set[int] = set()
    for i in range(len(bodies)):
        if i in to_remove:
            continue
        for j in range(i + 1, len(bodies)):
            if j in to_remove:
                continue
            ratio = SequenceMatcher(None, bodies[i][:500], bodies[j][:500]).ratio()
            if ratio > 0.7:
                if len(bodies[i]) >= len(bodies[j]):
                    to_remove.add(j)
                else:
                    to_remove.add(i)
                    break
    unique = [bodies[i] for i in range(len(bodies)) if i not in to_remove]
    return "\n\n".join(unique)


def _validate_merge_seam(client, bodies: list[str]) -> list[str]:
    """Validate and repair sentence boundaries at merge join points."""
    if len(bodies) <= 1:
        return bodies

    repaired = [bodies[0]]
    for i in range(1, len(bodies)):
        prev_body = repaired[-1].rstrip()
        next_body = bodies[i].lstrip()

        if not prev_body or not next_body:
            repaired.append(bodies[i])
            continue

        last_char = prev_body[-1]
        # A merge seam is suspicious if previous body doesn't end with
        # sentence-ending punctuation — regardless of what case the next
        # fragment starts with (proper nouns, new paragraphs defeat the
        # old lowercase-only check)
        ends_with_terminal = last_char in '.!?"\')\u201d\u2019'
        looks_broken = not ends_with_terminal

        if looks_broken:
            tail = prev_body[-400:]
            head = next_body[:400]
            try:
                repair_response = gemini_generate_with_retry(
                    client,
                    model=GEMINI_STRUCTURING_MODEL,
                    contents=[
                        "These two text fragments were extracted from consecutive newspaper columns. "
                        "They may connect mid-sentence at the boundary. "
                        "If they connect mid-sentence, return ONLY the corrected joined text "
                        "(the last paragraph of Fragment A merged with the first paragraph of Fragment B). "
                        "Do not include ellipsis markers or any formatting — return only the clean merged paragraph text. "
                        "If they do NOT connect (they are separate paragraphs), return exactly: VALID\n\n"
                        f"Fragment A (end):\n{tail}\n\n"
                        f"Fragment B (start):\n{head}"
                    ],
                    config=types.GenerateContentConfig(
                        safety_settings=SAFETY_OFF,
                        max_output_tokens=1024,
                    ),
                )
                result = (repair_response.text or "").strip()
                # Defensive: strip any echoed ellipsis markers
                if result.startswith("..."):
                    result = result[3:].lstrip()
                if result.endswith("..."):
                    result = result[:-3].rstrip()
                if result and result != "VALID":
                    prev_prefix = prev_body[:-len(tail)].rstrip() if len(prev_body) > len(tail) else ""
                    next_suffix = next_body[len(head) :].lstrip() if len(next_body) > len(head) else ""
                    repaired[-1] = (prev_prefix + "\n\n" + result).strip() if prev_prefix else result
                    repaired.append(next_suffix if next_suffix else "")
                    substep(f"Seam repair applied at merge join {i}")
                    continue
            except Exception as e:
                warning(f"Seam validation failed (non-fatal): {e}")

        repaired.append(bodies[i])

    return [b for b in repaired if b.strip()]


def merge_edition_articles(
    client,
    page_results: list[tuple[str, PageContent]],
    report: PipelineReport | None = None,
    snapshots_dir: str | None = None,
) -> EditionContent | None:
    """Merge articles across pages for a single edition (decision-only merge)."""
    merge_timer = StageTimer().start()
    md = MergePassDiagnostics() if report is not None else None

    article_data = []
    all_ads = []
    all_other = []

    for source_filename, page_content in page_results:
        page_label = page_content.page_number or source_filename
        all_ads.extend(page_content.ads)
        all_other.extend(page_content.other_content)

        for article in page_content.articles:
            fallback_cont = _extract_continuation_info(article.body)
            cont_info = {
                "continues_on": article.continues_on or fallback_cont["continues_on"],
                "continued_from": article.continued_from or fallback_cont["continued_from"],
            }

            article_data.append(
                {
                    "page_label": page_label,
                    "headline": article.headline,
                    "author": article.author,
                    "writer_position": article.writer_position,
                    "category": article.category,
                    "body": article.body,
                    "images": list(article.images),
                    "image_files": list(article.image_files),
                    "continuation": cont_info,
                }
            )

    if not article_data:
        info("No articles found to merge.")
        return None

    if md is not None:
        md.articles_before_merge = len(article_data)

    save_snapshot(snapshots_dir, "pre_merge_articles.json", article_data)

    pre_merged = _deterministic_merge(article_data)

    target_pages = set()
    has_continuations = False
    ambiguous_pointers = set()
    for idx, ad in enumerate(article_data):
        cont_on = ad["continuation"]["continues_on"]
        if cont_on and cont_on != "?":
            target_pages.add(cont_on)
            has_continuations = True
        elif cont_on == "?":
            ambiguous_pointers.add(idx)
            has_continuations = True
        if ad["continuation"]["continued_from"]:
            target_pages.add(ad["continuation"]["continued_from"])
            has_continuations = True

    dangling_tails = set()
    dangling_heads = set()
    for idx, ad in enumerate(article_data):
        body = (ad["body"] or "").strip()
        if not body or len(body) < 50:
            continue
        last_char = body.rstrip()[-1] if body.rstrip() else ""
        if last_char not in ".!?\"'\u201d\u2019":
            dangling_tails.add(idx)
        first_word = body.split()[0] if body.split() else ""
        if first_word and (
            first_word[0].islower()
            or first_word.lower()
            in (
                "and",
                "but",
                "or",
                "he",
                "she",
                "they",
                "the",
                "it",
                "his",
                "her",
                "its",
                "that",
                "this",
                "those",
                "these",
            )
        ):
            dangling_heads.add(idx)

    for idx in dangling_tails | dangling_heads:
        ad = article_data[idx]
        if not ad["continuation"]["continues_on"] and not ad["continuation"]["continued_from"]:
            if ad["page_label"] not in target_pages:
                has_continuations = True

    prompt_parts = [MERGE_PROMPT]
    for idx, ad in enumerate(article_data):
        is_pointer = bool(ad["continuation"]["continues_on"] or ad["continuation"]["continued_from"])
        is_target = ad["page_label"] in target_pages
        is_dangling = idx in dangling_tails or idx in dangling_heads

        if is_pointer or is_target or is_dangling:
            preview = ad["body"][:1200].replace("\n", " ")
            prompt_parts.append(f"[{idx}] Page {ad['page_label']} | Headline: {ad['headline']}")
            if ad["author"]:
                prompt_parts.append(f"     Author: {ad['author']}")
            if ad["writer_position"]:
                prompt_parts.append(f"     Position: {ad['writer_position']}")
            if ad["continuation"]["continues_on"]:
                prompt_parts.append(f"     Continues on: page {ad['continuation']['continues_on']}")
            if ad["continuation"]["continued_from"]:
                prompt_parts.append(f"     Continued from: page {ad['continuation']['continued_from']}")
            if idx in dangling_tails:
                prompt_parts.append("     ⚠ Body ends mid-sentence (possible unmarked continuation)")
            if idx in dangling_heads:
                prompt_parts.append("     ⚠ Body starts mid-sentence (possible continuation stub)")
            prompt_parts.append(f"     Preview: {preview}...")
            prompt_parts.append("")

    if pre_merged:
        prompt_parts.append("\nPRE-MERGED GROUPS (do not split these):")
        for group in pre_merged:
            ids_str = ", ".join(str(i) for i in group)
            prompt_parts.append(f"  Articles [{ids_str}] — matched by continuation markers")
        prompt_parts.append("")

    sources_by_target: dict[str, list[int]] = defaultdict(list)
    stubs_by_source: dict[str, list[int]] = defaultdict(list)
    for idx, ad in enumerate(article_data):
        cont_on = ad["continuation"]["continues_on"]
        if cont_on and cont_on != "?":
            sources_by_target[cont_on].append(idx)
        cont_from = ad["continuation"]["continued_from"]
        if cont_from:
            stubs_by_source[cont_from].append(idx)

    suggested_pairs = []
    for target_page, source_ids in sources_by_target.items():
        stub_ids = stubs_by_source.get(target_page, [])
        if len(source_ids) > 1 and len(stub_ids) > 1:
            scores = []
            for src_id in source_ids:
                src_tail = (article_data[src_id]["body"] or "")[-300:]
                for stub_id in stub_ids:
                    stub_head = (article_data[stub_id]["body"] or "")[:300]
                    ratio = SM(None, src_tail.lower(), stub_head.lower()).ratio()
                    scores.append((src_id, stub_id, ratio))
            scores.sort(key=lambda x: -x[2])
            used_src = set()
            used_stub = set()
            for src_id, stub_id, ratio in scores:
                if src_id not in used_src and stub_id not in used_stub:
                    suggested_pairs.append((src_id, stub_id, ratio))
                    used_src.add(src_id)
                    used_stub.add(stub_id)

    if suggested_pairs:
        prompt_parts.append("\nSUGGESTED PAIRS (based on content similarity — verify before applying):")
        for src_id, stub_id, ratio in suggested_pairs:
            src_h = article_data[src_id]["headline"][:60]
            stub_h = article_data[stub_id]["headline"][:60]
            prompt_parts.append(f"  [{src_id}] \"{src_h}\" ↔ [{stub_id}] \"{stub_h}\" (similarity: {ratio:.2f})")
        prompt_parts.append("")

    merge_text = "\n".join(prompt_parts)

    if has_continuations:
        try:
            response = gemini_generate_with_retry(
                client,
                model=GEMINI_MERGE_MODEL,
                contents=[merge_text],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=MergeDecisions,
                    safety_settings=SAFETY_OFF,
                    max_output_tokens=8192,
                ),
            )

            usage = response.usage_metadata
            if usage:
                substep(f"Merge tokens: {usage.prompt_token_count} in, {usage.candidates_token_count} out")
            else:
                substep("Merge tokens: unavailable")

            if md is not None and usage:
                md.tokens = TokenUsage(
                    prompt_tokens=usage.prompt_token_count,
                    candidates_tokens=usage.candidates_token_count,
                    total_tokens=usage.total_token_count,
                )

            if not response.parsed:
                raw = (response.text or "")[:500]
                warning(f"Pro merge unparseable (raw: {raw!r}), retrying with Flash...")
                if md is not None:
                    md.error = f"Pro merge failed (raw: {raw!r})"

                # Retry with Flash — less likely to trigger safety filters
                try:
                    response = gemini_generate_with_retry(
                        client,
                        model=GEMINI_PAGE_MODEL,
                        contents=[merge_text],
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json",
                            response_schema=MergeDecisions,
                            safety_settings=SAFETY_OFF,
                            max_output_tokens=8192,
                        ),
                    )
                    flash_usage = response.usage_metadata
                    if flash_usage:
                        substep(f"Flash retry tokens: {flash_usage.prompt_token_count} in, {flash_usage.candidates_token_count} out")
                        if md is not None:
                            md.tokens = TokenUsage(
                                prompt_tokens=(md.tokens.prompt_tokens if md.tokens else 0) + flash_usage.prompt_token_count,
                                candidates_tokens=(md.tokens.candidates_tokens if md.tokens else 0) + flash_usage.candidates_token_count,
                                total_tokens=(md.tokens.total_tokens if md.tokens else 0) + flash_usage.total_token_count,
                            )
                except Exception as flash_err:
                    warning(f"Flash retry also failed: {flash_err}")

                if response.parsed:
                    substep("Flash retry succeeded.")
                    if md is not None:
                        md.error = "flash_retry"
                    decisions = response.parsed
                else:
                    warning("Flash retry also unparseable — falling back to deterministic merge.")
                    if md is not None:
                        md.error = "deterministic_fallback"
                    decisions = _build_deterministic_decisions(article_data, pre_merged)
            else:
                decisions = response.parsed

            decisions: MergeDecisions
            save_snapshot(snapshots_dir, "merge_decisions.json", decisions)
        except Exception as e:
            error(f"Merge failed: {e} — falling back to deterministic merge.")
            if md is not None:
                md.error = f"deterministic_fallback — {e}"
            decisions = _build_deterministic_decisions(article_data, pre_merged)
    else:
        info("No explicit continuations found. Bypassing LLM merge pass.")
        decisions = MergeDecisions(groups=[])
        if md is not None:
            md.tokens = TokenUsage(prompt_tokens=0, candidates_tokens=0, total_tokens=0)

    referenced = set()
    for group in decisions.groups:
        deduped_ids = []
        for aid in group.article_ids:
            if not (0 <= aid < len(article_data)):
                warning(f"Article {aid} out of range (0..{len(article_data)-1}), skipping")
                if md is not None:
                    md.duplicate_warnings.append(f"Article {aid} out of range")
                continue
            if aid in referenced:
                warning(f"Article {aid} appears in multiple merge groups, skipping duplicate")
                if md is not None:
                    md.duplicate_warnings.append(f"Article {aid} in multiple groups")
            else:
                referenced.add(aid)
                deduped_ids.append(aid)
        group.article_ids = deduped_ids

    all_ids = set(range(len(article_data)))
    missing = all_ids - referenced
    if md is not None:
        md.unreferenced_articles = len(missing)
    for aid in sorted(missing):
        decisions.groups.append(
            MergeInstruction(
                article_ids=[aid],
                merged_headline=article_data[aid]["headline"],
                merged_author=article_data[aid]["author"],
                merged_writer_position=article_data[aid].get("writer_position", ""),
            )
        )

    def _safe_page_int(label: str) -> int:
        match = re.search(r'\d+', label or "")
        return int(match.group()) if match else 0

    merge_min_confidence = float(os.environ.get("MERGE_MIN_CONFIDENCE", "0.5"))
    merged_articles = []
    for group in decisions.groups:
        valid_ids = [aid for aid in group.article_ids if 0 <= aid < len(article_data)]
        if not valid_ids:
            continue

        valid_ids = sorted(valid_ids, key=lambda aid: _safe_page_int(article_data[aid]["page_label"]))

        bodies = []
        all_images = []
        all_image_files = []
        source_pages = []
        source_categories = []
        continues_on_values = []
        continued_from_values = []
        for aid in valid_ids:
            ad = article_data[aid]
            cleaned_body = _strip_continuation_markers(ad["body"])
            bodies.append(cleaned_body)
            aligned_images, aligned_files, orphan_captions = _reconcile_image_alignment(
                list(ad["images"]),
                list(ad["image_files"]),
            )
            all_images.extend(aligned_images)
            all_image_files.extend(aligned_files)
            if orphan_captions:
                if md is not None:
                    md.image_orphans_dropped += len(orphan_captions)
                for cap in orphan_captions:
                    all_other.append(
                        OtherContent(
                            title=(ad["headline"] or "Unassociated image caption").strip(),
                            body=cap,
                        )
                    )
            if ad["page_label"] not in source_pages:
                source_pages.append(ad["page_label"])
            source_categories.append(ad.get("category") or "Campus News")
            cont = ad.get("continuation", {})
            if (cont.get("continues_on") or "").strip():
                continues_on_values.append(cont["continues_on"].strip())
            if (cont.get("continued_from") or "").strip():
                continued_from_values.append(cont["continued_from"].strip())

        # Confidence filtering: reject low-confidence merges
        if len(valid_ids) > 1 and group.confidence < merge_min_confidence:
            warning(f"Rejecting low-confidence merge ({group.confidence:.2f} < {merge_min_confidence}): {group.merged_headline}")
            if md is not None:
                md.low_confidence_rejections += 1
            # Split back into individual articles
            for aid in valid_ids:
                ad = article_data[aid]
                merged_articles.append(
                    MergedArticle(
                        headline=ad["headline"],
                        author=_normalize_byline(ad.get("author", "")),
                        writer_position=ad.get("writer_position", ""),
                        category=ad.get("category", "Campus News"),
                        continues_on=ad["continuation"].get("continues_on", ""),
                        continued_from=ad["continuation"].get("continued_from", ""),
                        body=_strip_continuation_markers(ad["body"]),
                        images=list(ad.get("images", [])),
                        image_files=list(ad.get("image_files", [])),
                        source_pages=[ad["page_label"]],
                    )
                )
            continue

        if len(bodies) > 1:
            bodies = _validate_merge_seam(client, bodies)

        merged_body = _best_body(bodies)

        # Clean up OCR artifacts at merge boundaries (after seam repair joined the text)
        paragraphs = merged_body.split("\n\n")
        if len(paragraphs) > 1:
            cleaned = paragraphs[0]
            for i in range(1, len(paragraphs)):
                cleaned = clean_merge_boundary(cleaned, paragraphs[i])
            merged_body = cleaned

        merged_body, stripped_captions = _strip_trailing_captions(merged_body)
        for cap in stripped_captions:
            all_images.append(ArticleImage(caption=cap, position=""))

        merged_author = _normalize_byline(group.merged_author)
        merged_author, merged_body = _extract_byline_from_body(group.merged_headline, merged_author, merged_body)
        merged_body = _dedup_byline_from_body(merged_author, merged_body)
        merged_position = group.merged_writer_position
        if not merged_position:
            merged_author, merged_position = _split_author_position(merged_author)
        if not merged_position:
            for aid in valid_ids:
                wp = article_data[aid].get("writer_position", "")
                if wp:
                    merged_position = wp
                    break

        merged_category = _choose_merged_category(source_categories)
        if md is not None and len(set(c for c in source_categories if c)) > 1:
            md.category_conflicts += 1
        merged_continues_on = sorted(set(continues_on_values))[0] if continues_on_values else ""
        merged_continued_from = sorted(set(continued_from_values))[0] if continued_from_values else ""

        body_stripped = merged_body.strip()
        is_photo_only = ((len(body_stripped) < 100 and re.match(r"^[A-Z]{3,}", body_stripped)) or (not body_stripped and all_images))
        if is_photo_only and all_image_files:
            merged_articles.append(
                MergedArticle(
                    headline=group.merged_headline or "",
                    author="",
                    category=merged_category,
                    continues_on=merged_continues_on,
                    continued_from=merged_continued_from,
                    body="",
                    images=all_images,
                    image_files=all_image_files,
                    source_pages=source_pages,
                )
            )
            continue
        if is_photo_only and not all_image_files:
            caption_text = "\n\n".join(img.caption.strip() for img in all_images if (img.caption or "").strip())
            all_other.append(
                OtherContent(
                    title=group.merged_headline or "Photo",
                    body=body_stripped or caption_text,
                )
            )
            if md is not None and not (body_stripped or caption_text):
                md.empty_articles_removed += 1
            continue

        merged_articles.append(
            MergedArticle(
                headline=group.merged_headline,
                author=merged_author,
                writer_position=merged_position,
                category=merged_category,
                continues_on=merged_continues_on,
                continued_from=merged_continued_from,
                body=merged_body,
                images=all_images,
                image_files=all_image_files,
                source_pages=source_pages,
            )
        )

    merged_articles = _sanitize_merged_articles(merged_articles, all_other, md=md)

    # Edition-level proper noun consistency — catches cross-page OCR errors
    # like "Mohahan" (page 7) vs "Monahan" (page 1)
    edition_corrections = _check_edition_proper_nouns(merged_articles)
    if edition_corrections:
        merged_articles = _apply_edition_proper_noun_corrections(merged_articles, edition_corrections)

    all_ads = _deduplicate_ads(all_ads)
    all_other = _deduplicate_other_content(all_other)

    if md is not None:
        md.articles_after_merge = len(merged_articles)
        md.singleton_groups = sum(1 for g in decisions.groups if len(g.article_ids) == 1)
        md.multi_article_groups = sum(1 for g in decisions.groups if len(g.article_ids) > 1)
        md.time_seconds = merge_timer.stop()
        report.merge_pass = md

    return EditionContent(
        articles=merged_articles,
        ads=all_ads,
        other_content=all_other,
    )


__all__ = ["_best_body", "_build_deterministic_decisions", "_validate_merge_seam", "merge_edition_articles"]
