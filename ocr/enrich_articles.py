"""
Enrich articles in edition.json files with LLM-generated categories.
Makes 1 Gemini call per edition.

Usage:
    python enrich_articles.py                    # enrich all editions
    python enrich_articles.py --date 1970-01-07  # enrich one edition
    python enrich_articles.py --force            # re-categorize already enriched editions
"""

import argparse
import json
import os
import sys
import tempfile
import time

from dotenv import load_dotenv
from pydantic import BaseModel
from google import genai
from google.genai import types
from gemini_utils import gemini_generate_with_retry

load_dotenv()

GEMINI_MODEL = "gemini-3-flash-preview"

SAFETY_OFF = [
    types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_CIVIC_INTEGRITY", threshold="OFF"),
]

EDITIONS_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "public", "editions"
)

# ── Pydantic models ──────────────────────────────────────────────────

VALID_CATEGORIES = ["News", "Sports", "Features", "Opinion", "Arts", "Campus Life"]


class CategorizedArticle(BaseModel):
    index: int       # 0-based index matching input order
    category: str    # one of VALID_CATEGORIES


class CategorizedArticlesResponse(BaseModel):
    articles: list[CategorizedArticle]


# ── Prompt ───────────────────────────────────────────────────────────

CATEGORIZATION_PROMPT = """\
You are categorizing articles from a college newspaper (Ohio Wesleyan University).

Assign each article exactly one of these categories:
- News: Hard news — breaking events, policy changes, institutional announcements with broad impact
- Sports: Athletics, game results, player profiles, team news
- Features: Human interest, profiles, in-depth reporting, investigative pieces, travel
- Opinion: Editorials, letters to the editor, columns, commentary, reviews
- Arts: Music, theater, film, visual arts, performances, exhibitions
- Campus Life: Student organizations, Greek life, events, social activities, campus services, daily student experience

For each article, return its 0-based index and assigned category.

Articles:
{articles_json}
"""


def enrich_edition(edition_path: str, client, force: bool = False) -> tuple[bool, int, float]:
    """Categorize articles for a single edition. Returns (performed, tokens, elapsed_s)."""
    with open(edition_path, "r", encoding="utf-8") as f:
        edition = json.load(f)

    edition_date = edition.get("edition_date", os.path.basename(os.path.dirname(edition_path)))

    # Check idempotency
    if not force and "categories" in edition:
        print(f"  {edition_date}: Already categorized ({len(edition['categories'])} articles), skipping")
        return False, 0, 0.0

    articles = edition.get("articles", [])
    if not articles:
        print(f"  {edition_date}: No articles to categorize")
        return False, 0, 0.0

    print(f"  {edition_date}: Categorizing {len(articles)} articles...")

    # Build compact article summaries for the prompt
    summaries = []
    for i, a in enumerate(articles):
        body_preview = (a.get("body", "") or "")[:300]
        summaries.append({
            "index": i,
            "headline": a.get("headline", ""),
            "author": a.get("author", ""),
            "body_preview": body_preview,
        })

    articles_json = json.dumps(summaries, indent=2)
    prompt = CATEGORIZATION_PROMPT.format(articles_json=articles_json)

    call_start = time.time()
    response = gemini_generate_with_retry(
        client,
        model=GEMINI_MODEL,
        contents=[prompt],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=CategorizedArticlesResponse,
            safety_settings=SAFETY_OFF,
            max_output_tokens=4096,
        ),
    )
    call_elapsed = time.time() - call_start

    usage = response.usage_metadata
    total_tokens = usage.total_token_count
    print(f"    Tokens: {usage.prompt_token_count} in, {usage.candidates_token_count} out | Time: {call_elapsed:.1f}s")

    if not response.parsed:
        print(f"    ERROR: Response was empty or blocked")
        return False, total_tokens, call_elapsed

    parsed: CategorizedArticlesResponse = response.parsed

    # Build categories list parallel to articles
    categories = ["News"] * len(articles)  # default fallback
    for item in parsed.articles:
        if 0 <= item.index < len(articles):
            cat = item.category
            if cat not in VALID_CATEGORIES:
                print(f"    WARNING: Invalid category '{cat}' for index {item.index}, defaulting to News")
                cat = "News"
            categories[item.index] = cat

    # Print summary
    from collections import Counter
    dist = Counter(categories)
    print(f"    Categories: {', '.join(f'{k}({v})' for k, v in sorted(dist.items()))}")

    # Write categories alongside original articles (atomic write)
    edition["categories"] = categories
    tmp_fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(edition_path), suffix=".json")
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
            json.dump(edition, f, indent=2)
        os.replace(tmp_path, edition_path)
    except BaseException:
        os.unlink(tmp_path)
        raise

    print(f"    Written to {edition_path}")
    return True, total_tokens, call_elapsed


def main():
    parser = argparse.ArgumentParser(description="Categorize articles in edition.json files")
    parser.add_argument("--date", help="Categorize a specific edition by date (e.g. 1970-01-07)")
    parser.add_argument("--force", action="store_true", help="Re-categorize already enriched editions")
    args = parser.parse_args()

    client = genai.Client()

    total_tokens = 0
    total_time = 0.0

    if args.date:
        edition_path = os.path.join(EDITIONS_DIR, args.date, "edition.json")
        if not os.path.exists(edition_path):
            print(f"Edition not found: {edition_path}")
            sys.exit(1)
        performed, tokens, elapsed = enrich_edition(edition_path, client, force=args.force)
        total_tokens += tokens
        total_time += elapsed
    else:
        # Process all editions
        enriched_count = 0
        for entry in sorted(os.listdir(EDITIONS_DIR)):
            edition_path = os.path.join(EDITIONS_DIR, entry, "edition.json")
            if os.path.isfile(edition_path):
                performed, tokens, elapsed = enrich_edition(edition_path, client, force=args.force)
                total_tokens += tokens
                total_time += elapsed
                if performed:
                    enriched_count += 1

        print(f"\nDone: {enriched_count} edition(s) categorized")

    print(f"Total: {total_tokens} tokens, {total_time:.1f}s")


if __name__ == "__main__":
    main()
