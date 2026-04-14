"""Application-layer runtime for content triage (rescue misclassified articles)."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
import time

from ..config.paths import PUBLIC_EDITIONS_DIR
from ..config.prompts_loader import MODELS
from ..contracts.content_models import ContentTriageResponse
from ..recognition.rescue_prompts import SAFETY_OFF, TRIAGE_SYSTEM_PROMPT, TRIAGE_USER_TEMPLATE
from ..shared.console import status, substep, success, error, info, file_written
from ..shared.retry import gemini_generate_with_retry


_IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff")


def _is_image_file(body: str) -> bool:
    """Check if an other_content body is an image filename rather than text."""
    return body.startswith("images/") or body.lower().endswith(_IMAGE_EXTENSIONS)


def triage_edition(edition_path: str, client, force: bool = False) -> tuple[bool, int, float]:
    """Triage content for a single edition. Returns (performed, tokens, elapsed_s)."""
    try:
        with open(edition_path, "r", encoding="utf-8") as f:
            edition = json.load(f)
    except json.JSONDecodeError as e:
        error(f"Malformed JSON in {edition_path}: {e}")
        return False, 0, 0.0

    edition_date = edition.get("edition_date", os.path.basename(os.path.dirname(edition_path)))

    if not force and edition.get("content_triaged"):
        info(f"{edition_date}: Already triaged, skipping")
        return False, 0, 0.0

    articles = edition.get("articles", [])
    other_content = edition.get("other_content", [])

    # Build suspect articles list: short/empty body
    suspect_items = []
    suspect_indices = []
    for i, art in enumerate(articles):
        body = (art.get("body") or "").strip()
        if len(body) < 100:
            suspect_items.append({
                "index": len(suspect_items),
                "original_index": i,
                "headline": art.get("headline", "")[:120],
                "body": body[:200],
                "has_image": bool(art.get("image_files")),
                "category": art.get("category", ""),
            })
            suspect_indices.append(i)

    # Build promotable other_content list
    promotable_items = []
    promotable_indices = []
    for i, oc in enumerate(other_content):
        body = oc.get("body", "")
        title = oc.get("title", "")
        if len(body) >= 100 or _is_image_file(body):
            promotable_items.append({
                "index": len(promotable_items),
                "original_index": i,
                "title": title[:120],
                "body": body[:500] if not _is_image_file(body) else f"[IMAGE FILE: {body}]",
                "is_image_file": _is_image_file(body),
            })
            promotable_indices.append(i)

    if not suspect_items and not promotable_items:
        info(f"{edition_date}: Nothing to triage (no suspects, no promotable other_content)")
        return False, 0, 0.0

    status(f"{edition_date}: Triaging {len(suspect_items)} suspect articles + {len(promotable_items)} other_content items...")

    # Build headline context
    headlines = [{"index": i, "headline": art.get("headline", "")[:80]} for i, art in enumerate(articles)]

    user_message = TRIAGE_USER_TEMPLATE.format(
        suspect_json=json.dumps(suspect_items, indent=2) if suspect_items else "[]",
        other_json=json.dumps(promotable_items, indent=2) if promotable_items else "[]",
        headlines_json=json.dumps(headlines, indent=2),
    )

    from google.genai import types

    model_cfg = MODELS["content_triage"]
    thinking = types.ThinkingConfig(thinking_level=model_cfg["thinking"]) if model_cfg.get("thinking") else None
    call_start = time.time()
    response = gemini_generate_with_retry(
        client,
        model=model_cfg["name"],
        contents=[user_message],
        config=types.GenerateContentConfig(
            system_instruction=TRIAGE_SYSTEM_PROMPT,
            response_mime_type="application/json",
            response_schema=ContentTriageResponse,
            safety_settings=SAFETY_OFF,
            max_output_tokens=16384,
            **({"thinking_config": thinking} if thinking else {}),
        ),
    )
    call_elapsed = time.time() - call_start

    usage = response.usage_metadata
    total_tokens = usage.total_token_count if usage else 0
    if usage:
        substep(f"Tokens: {usage.prompt_token_count} in, {usage.candidates_token_count} out | Time: {call_elapsed:.1f}s")

    if not response.parsed:
        error("Triage response was empty or blocked")
        return False, total_tokens, call_elapsed

    result: ContentTriageResponse = response.parsed

    # Apply suspect article decisions
    demote_indices = set()
    for decision in result.suspect_articles:
        if decision.decision == "demote" and 0 <= decision.index < len(suspect_indices):
            demote_indices.add(suspect_indices[decision.index])

    # Apply other_content decisions
    promote_indices = set()
    promoted_articles = []
    for decision in result.other_content:
        if decision.decision == "promote" and 0 <= decision.index < len(promotable_indices):
            oc_idx = promotable_indices[decision.index]
            oc = other_content[oc_idx]
            promote_indices.add(oc_idx)

            body = oc.get("body", "")
            title = oc.get("title", "")
            headline = decision.headline or title

            if _is_image_file(body):
                promoted_articles.append({
                    "headline": headline,
                    "author": "",
                    "writer_position": "",
                    "category": decision.category,
                    "body": title,
                    "images": [{"caption": title, "position": ""}],
                    "image_files": [body],
                    "continues_on": "",
                    "continued_from": "",
                    "source_pages": [],
                    "triage_promoted": True,
                })
            else:
                promoted_articles.append({
                    "headline": headline,
                    "author": "",
                    "writer_position": "",
                    "category": decision.category,
                    "body": body,
                    "images": [],
                    "image_files": [],
                    "continues_on": "",
                    "continued_from": "",
                    "source_pages": [],
                    "triage_promoted": True,
                })

    # Build new articles list (remove demoted, add promoted)
    demoted_to_other = []
    new_articles = []
    for i, art in enumerate(articles):
        if i in demote_indices:
            # Preserve image reference when demoting
            image_files = art.get("image_files", [])
            headline = art.get("headline", "")
            body_text = art.get("body", "").strip()
            demoted_to_other.append({
                "title": headline,
                "body": image_files[0] if image_files else body_text or headline,
            })
        else:
            new_articles.append(art)

    new_articles.extend(promoted_articles)

    # Build new other_content list (remove promoted, add demoted)
    new_other = [oc for i, oc in enumerate(other_content) if i not in promote_indices]
    new_other.extend(demoted_to_other)

    edition["articles"] = new_articles
    edition["other_content"] = new_other
    edition["content_triaged"] = True

    # Atomic write
    tmp_fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(edition_path), suffix=".json")
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
            json.dump(edition, f, indent=2)
        os.replace(tmp_path, edition_path)
    except BaseException:
        os.unlink(tmp_path)
        raise

    substep(f"Demoted {len(demote_indices)} ghost articles, promoted {len(promoted_articles)} from other_content")
    file_written("Edition", edition_path)
    return True, total_tokens, call_elapsed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Triage content in edition.json files")
    parser.add_argument("--date", help="Triage a specific edition by date (e.g. 2000-04-05)")
    parser.add_argument("--force", action="store_true", help="Re-triage already triaged editions")
    args = parser.parse_args(argv)

    from google import genai

    client = genai.Client()
    editions_dir = str(PUBLIC_EDITIONS_DIR)

    total_tokens = 0
    total_time = 0.0

    if args.date:
        edition_path = os.path.join(editions_dir, args.date, "edition.json")
        if not os.path.exists(edition_path):
            error(f"Edition not found: {edition_path}")
            return 1
        _performed, tokens, elapsed = triage_edition(edition_path, client, force=args.force)
        total_tokens += tokens
        total_time += elapsed
    else:
        triaged_count = 0
        for entry in sorted(os.listdir(editions_dir)):
            edition_path = os.path.join(editions_dir, entry, "edition.json")
            if os.path.isfile(edition_path):
                performed, tokens, elapsed = triage_edition(edition_path, client, force=args.force)
                total_tokens += tokens
                total_time += elapsed
                if performed:
                    triaged_count += 1

        success(f"Done: {triaged_count} edition(s) triaged")

    info(f"Total: {total_tokens} tokens, {total_time:.1f}s")
    return 0


__all__ = ["main", "triage_edition"]
