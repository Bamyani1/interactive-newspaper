#!/usr/bin/env python3
"""
Phase 2: Curation
Use Gemini 2.5 Flash to extract structured articles from raw OCR text.

Usage:
    python curate.py --edition 1986-10-17
    python curate.py --edition 1986-10-17 --page 1  # Process single page
    python curate.py --edition 1986-10-17 --dry-run  # Preview API calls without executing
    python curate.py --edition 1986-10-17 --no-confirm  # Skip confirmation prompt
"""
import argparse
import json
import re
import sys
import time
from pathlib import Path

from google import genai
from google.genai import types
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn

from config import (
    GEMINI_API_KEY,
    GEMINI_MODEL,
    GEMINI_API_DELAY_MS,
    GEMINI_TEMPERATURE,
    GEMINI_RATE_LIMIT_BASE_DELAY,
    get_edition_paths,
)
from api_tracker import (
    get_tracker,
    get_pages_needing_processing,
    APITracker,
    EST_INPUT_TOKENS_PER_PAGE,
    EST_OUTPUT_TOKENS_PER_PAGE,
)

console = Console()

# Load prompt template
PROMPT_TEMPLATE_PATH = Path(__file__).parent / "prompts" / "article_extraction.txt"


def load_prompt_template() -> str:
    """Load the article extraction prompt template."""
    return PROMPT_TEMPLATE_PATH.read_text(encoding="utf-8")


def format_image_metadata(images: list[dict]) -> str:
    """Format image metadata for the prompt."""
    if not images:
        return "No images detected on this page."

    lines = []
    for img in images:
        lines.append(
            f"- {img['filename']}: bounding box {img['bbox']}, confidence {img['confidence']:.2f}"
        )
    return "\n".join(lines)


def extract_json_from_response(text: str) -> dict:
    """Extract JSON from Gemini response, handling markdown code blocks."""
    # Try to find JSON in code blocks first (use greedy match for content)
    json_match = re.search(r"```(?:json)?\s*(\{[\s\S]*\})\s*```", text)
    if json_match:
        text = json_match.group(1)
    else:
        # Try to find raw JSON object - find the first { and last }
        first_brace = text.find('{')
        last_brace = text.rfind('}')
        if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
            text = text[first_brace:last_brace + 1]

    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        console.print(f"[red]JSON parse error: {e}[/red]")
        console.print(f"[dim]Response text: {text[:500]}...[/dim]")
        return {"articles": []}


def curate_page(
    client: genai.Client,
    model_name: str,
    page_text: str,
    page_images: list[dict],
    page_num: int,
    prompt_template: str
) -> list[dict]:
    """
    Use Gemini to extract structured articles from a page.

    Args:
        client: Gemini client instance
        model_name: Name of the Gemini model to use
        page_text: Raw OCR text for the page
        page_images: Image metadata for the page
        page_num: Page number
        prompt_template: The prompt template string

    Returns:
        List of article dictionaries
    """
    # Format the prompt
    prompt = prompt_template.format(
        page_num=page_num,
        page_text=page_text,
        image_metadata=format_image_metadata(page_images)
    )

    # Call Gemini with retry logic for rate limiting
    max_retries = 5
    base_delay = GEMINI_RATE_LIMIT_BASE_DELAY

    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=GEMINI_TEMPERATURE,
                    max_output_tokens=8192,
                )
            )

            # Parse response
            result = extract_json_from_response(response.text)
            articles = result.get("articles", [])

            # Warn if page has content but Gemini returned no articles
            if not articles and len(page_text) > 200:
                console.print(f"[yellow]Warning: Page {page_num} has content ({len(page_text)} chars) but Gemini returned no articles[/yellow]")

            # Add page number to each article
            for article in articles:
                article["page"] = page_num

            return articles

        except Exception as e:
            error_str = str(e)
            # Check for rate limit error (429)
            if "429" in error_str or "quota" in error_str.lower() or "rate" in error_str.lower():
                delay = base_delay * (2 ** attempt)  # Exponential backoff
                if attempt < max_retries - 1:
                    console.print(f"[yellow]Rate limited on page {page_num}, waiting {delay}s (attempt {attempt + 1}/{max_retries})...[/yellow]")
                    time.sleep(delay)
                    continue
            console.print(f"[red]Gemini error on page {page_num}: {e}[/red]")
            return []

    console.print(f"[red]Max retries exceeded for page {page_num}[/red]")
    return []


def curate_edition(
    edition_id: str,
    single_page: int | None = None,
    dry_run: bool = False,
    require_confirmation: bool = True
):
    """
    Curate all pages of an edition using Gemini.

    Input:
      - pages/page_XX.txt (raw OCR text)
      - extracted-images/images-metadata.json

    Output:
      - pages/page_XX_articles.json (structured articles per page)

    Args:
        edition_id: Edition identifier (e.g., "1986-10-17")
        single_page: If set, only process this page number
        dry_run: If True, only show what would be done without making API calls
        require_confirmation: If True, ask for user approval before API calls
    """
    if not GEMINI_API_KEY and not dry_run:
        console.print("[red]Error: GEMINI_API_KEY environment variable not set[/red]")
        console.print("Get a free API key at: https://makersuite.google.com/app/apikey")
        sys.exit(1)

    paths = get_edition_paths(edition_id)
    pages_dir = paths["pages_dir"]
    images_dir = paths["images_dir"]

    if not pages_dir.exists():
        console.print(f"[red]Error: Pages directory not found: {pages_dir}[/red]")
        console.print("Run extract.py first to generate OCR text.")
        sys.exit(1)

    # Find text files
    text_files = sorted(pages_dir.glob("page_*.txt"), key=lambda p: p.name)
    if not text_files:
        console.print(f"[red]Error: No page text files found in {pages_dir}[/red]")
        sys.exit(1)

    # Load image metadata
    images_metadata = {}
    metadata_path = images_dir / "images-metadata.json"
    if metadata_path.exists():
        with open(metadata_path) as f:
            images_metadata = json.load(f)
            # Convert string keys to int
            images_metadata = {int(k): v for k, v in images_metadata.items()}

    console.print(f"\n[bold]Curating edition: {edition_id}[/bold]")
    console.print(f"Found {len(text_files)} pages with OCR text")
    console.print(f"Image metadata loaded: {len(images_metadata)} pages have images\n")

    # Filter to single page if specified
    if single_page is not None:
        text_files = [f for f in text_files if f"page_{single_page:02d}" in f.name]
        if not text_files:
            console.print(f"[red]Error: Page {single_page} not found[/red]")
            sys.exit(1)

    # ═══════════════════════════════════════════════════════════════
    # API CALL REVIEW PHASE
    # ═══════════════════════════════════════════════════════════════
    tracker = get_tracker(GEMINI_MODEL)

    # Determine which pages actually need API calls
    pages_needing_api = get_pages_needing_processing(edition_id)
    if single_page is not None:
        pages_needing_api = [p for p in pages_needing_api if p == single_page]

    # Show which pages will be skipped vs processed
    all_page_nums = [int(re.search(r"page_(\d+)", f.name).group(1)) for f in text_files]
    pages_to_skip = [p for p in all_page_nums if p not in pages_needing_api]

    if pages_to_skip:
        console.print(f"[dim]Pages with existing valid JSON (will skip): {pages_to_skip}[/dim]")
    if pages_needing_api:
        console.print(f"[yellow]Pages requiring API calls: {pages_needing_api}[/yellow]")
    else:
        console.print("[green]All pages already have valid JSON. No API calls needed.[/green]")
        return

    # Get cost estimate
    estimate = tracker.estimate_cost(len(pages_needing_api))

    # DRY RUN MODE: Just show estimate and exit
    if dry_run:
        console.print("\n[bold cyan]═══ DRY RUN MODE ═══[/bold cyan]")
        tracker.display_estimate(estimate)
        tracker.display_history()
        console.print("\n[dim]No API calls were made. Remove --dry-run to execute.[/dim]")
        return

    # APPROVAL MODE: Request confirmation
    if require_confirmation:
        if not tracker.request_approval(estimate, edition_id):
            console.print("\n[yellow]Aborted by user.[/yellow]")
            return
        console.print("\n[green]Approved! Starting API calls...[/green]\n")

    # ═══════════════════════════════════════════════════════════════
    # EXECUTE API CALLS
    # ═══════════════════════════════════════════════════════════════

    # Initialize Gemini client
    client = genai.Client(api_key=GEMINI_API_KEY)
    console.print(f"[green]✓ Gemini client initialized ({GEMINI_MODEL})[/green]\n")

    # Load prompt template
    prompt_template = load_prompt_template()

    # Process each page
    total_articles = 0

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        console=console,
    ) as progress:
        task = progress.add_task("Curating pages...", total=len(text_files))

        for text_file in text_files:
            # Extract page number from filename
            page_num = int(re.search(r"page_(\d+)", text_file.name).group(1))

            # Skip pages that already have valid JSON
            if page_num not in pages_needing_api:
                output_file = pages_dir / f"page_{page_num:02d}_articles.json"
                if output_file.exists():
                    with open(output_file) as f:
                        data = json.load(f)
                        existing_articles = data.get("articles", [])
                        total_articles += len(existing_articles)
                console.print(f"  [dim]Page {page_num}: Skipping (valid JSON exists)[/dim]")
                progress.advance(task)
                continue

            progress.update(task, description=f"Page {page_num}: Calling Gemini...")

            # Load page text
            page_text = text_file.read_text(encoding="utf-8")

            # Get images for this page
            page_images = images_metadata.get(page_num, [])

            # Curate with Gemini
            articles = curate_page(client, GEMINI_MODEL, page_text, page_images, page_num, prompt_template)

            # Log the API call
            tracker.log_call(
                page_num=page_num,
                input_tokens=EST_INPUT_TOKENS_PER_PAGE,
                output_tokens=EST_OUTPUT_TOKENS_PER_PAGE,
                success=len(articles) > 0
            )

            # Save articles
            output_file = pages_dir / f"page_{page_num:02d}_articles.json"
            with open(output_file, "w", encoding="utf-8") as f:
                json.dump({"page": page_num, "articles": articles}, f, indent=2, ensure_ascii=False)

            total_articles += len(articles)
            progress.update(task, description=f"Page {page_num}: {len(articles)} articles")

            # Rate limiting
            time.sleep(GEMINI_API_DELAY_MS / 1000)

            progress.advance(task)

    # Finalize tracking session
    tracker.finalize_session(edition_id)

    console.print(f"\n[bold green]Curation complete![/bold green]")
    console.print(f"  Total articles extracted: {total_articles}")
    console.print(f"  Average per page: {total_articles / len(text_files):.1f}")


def main():
    parser = argparse.ArgumentParser(description="Curate articles using Gemini")
    parser.add_argument("--edition", required=True, help="Edition ID (e.g., 1986-10-17)")
    parser.add_argument("--page", type=int, help="Process only this page number")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview API calls and costs without executing"
    )
    parser.add_argument(
        "--no-confirm",
        action="store_true",
        help="Skip confirmation prompt (use with caution)"
    )

    args = parser.parse_args()
    curate_edition(
        args.edition,
        single_page=args.page,
        dry_run=args.dry_run,
        require_confirmation=not args.no_confirm
    )


if __name__ == "__main__":
    main()
