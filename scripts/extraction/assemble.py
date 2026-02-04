#!/usr/bin/env python3
"""
Phase 3: Assembly
Combine curated articles into frontend-ready JSON format with continuation merging.

Usage:
    python assemble.py --edition 1986-10-17
    python assemble.py --edition 1986-10-17 --merge-strategy headline_partial
"""
import argparse
import json
import re
import sys
from pathlib import Path

from rich.console import Console
from rich.table import Table

from config import get_edition_paths, MIN_LEAD_STORY_LENGTH, MIN_FEATURED_LENGTH

console = Console()


def slugify(text: str) -> str:
    """Convert text to URL-friendly slug."""
    text = text.lower()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[-\s]+", "-", text)
    return text.strip("-")[:50]


def generate_article_id(edition_id: str, headline: str, page: int, index: int) -> str:
    """Generate a unique article ID."""
    slug = slugify(headline) or f"article-{index}"
    return f"{edition_id}-p{page}-{slug}"


def is_lead_story(article: dict, page_articles: list[dict]) -> bool:
    """
    Determine if an article is the lead story on page 1.
    Heuristics: longest article, News category, first on page.
    """
    if article.get("category") == "Ads":
        return False

    # Check if it has the longest text on the page
    article_length = len(article.get("fullText", ""))
    max_length = max(len(a.get("fullText", "")) for a in page_articles)

    return article_length == max_length and article_length > MIN_LEAD_STORY_LENGTH


def should_feature(article: dict) -> bool:
    """
    Determine if an article should be featured.
    Heuristics: has image, substantial length, not an ad.
    """
    if article.get("category") == "Ads":
        return False

    has_image = bool(article.get("relatedImages"))
    text_length = len(article.get("fullText", ""))

    return has_image and text_length > MIN_FEATURED_LENGTH


def extract_caption(article: dict) -> str | None:
    """Extract image caption from curated article data."""
    return article.get("imageCaption")


def normalize_category(category: str) -> str:
    """Normalize category to match frontend expectations."""
    valid_categories = {"News", "Sports", "Features", "Opinion", "Arts", "Campus Life", "Ads"}

    # Direct match
    if category in valid_categories:
        return category

    # Map common variations
    category_map = {
        "Editorial": "Opinion",
        "Letters": "Opinion",
        "Entertainment": "Arts",
        "Culture": "Arts",
        "Music": "Arts",
        "Theater": "Arts",
        "Campus": "Campus Life",
        "Social": "Campus Life",
        "Local": "News",
        "Business": "News",
        "Lifestyle": "Features",
        "Profile": "Features",
        "Advertisement": "Ads",
    }

    return category_map.get(category, "News")


def find_continuation_match(
    source_article: dict,
    target_page: int,
    candidates: list[dict],
    strategy: str = "page_and_headline"
) -> dict | None:
    """
    Find the continuation of an article on a target page.
    
    Strategies:
    - 'page_only': Match solely by page number (trust continuesFromPage)
    - 'headline_partial': Page + headline keyword overlap
    - 'headline_contained': Page + source headline contains continuation headline
    """
    source_headline = source_article.get("headline", "").lower()
    source_words = set(source_headline.split())
    
    for candidate in candidates:
        cand_page = candidate.get("page")
        cand_from = candidate.get("continuesFromPage")
        cand_headline = candidate.get("headline", "").lower()
        
        # Must be on target page and marked as continuation from source page
        if cand_page != target_page:
            continue
        if cand_from is None:
            continue
        # Handle both string and int types for page numbers
        try:
            if int(cand_from) != source_article.get("page"):
                continue
        except (ValueError, TypeError):
            continue
        
        # Strategy: page_only - just trust the page reference
        if strategy == "page_only":
            return candidate
        
        # Strategy: headline_partial - require some word overlap
        if strategy == "headline_partial":
            cand_words = set(cand_headline.split())
            overlap = source_words & cand_words
            if overlap:
                return candidate
        
        # Strategy: headline_contained - continuation headline is in source
        if strategy == "headline_contained":
            # Check if continuation headline is contained in source
            # e.g., "Giving" in "OWU shooting for level giving"
            if cand_headline in source_headline:
                return candidate
            # Also check significant words (>3 chars)
            cand_significant = [w for w in cand_headline.split() if len(w) > 3]
            for word in cand_significant:
                if word in source_headline:
                    return candidate
    
    return None


def merge_continued_articles(all_articles: list[dict], strategy: str = "page_only") -> list[dict]:
    """
    Merge articles that continue across pages.
    
    Args:
        all_articles: List of raw article dicts with 'raw', 'page', 'index' keys
        strategy: Matching strategy - 'page_only', 'headline_partial', 'headline_contained'
    
    Returns:
        Filtered list with continuations merged into their source articles
    """
    # Build lookup: page -> articles on that page
    page_to_articles = {}
    for item in all_articles:
        page = item["page"]
        if page not in page_to_articles:
            page_to_articles[page] = []
        page_to_articles[page].append(item["raw"])
    
    # Track which articles are continuations (to be removed)
    continuation_ids = set()
    merge_count = 0
    
    for item in all_articles:
        article = item["raw"]
        continues_on = article.get("continuesOnPage")
        
        if continues_on is None:
            continue
        
        try:
            target_page = int(continues_on)
        except (ValueError, TypeError):
            continue
        
        # Find the continuation on the target page
        candidates = page_to_articles.get(target_page, [])
        continuation = find_continuation_match(article, target_page, candidates, strategy)
        
        if continuation:
            # Merge the fullText
            source_text = article.get("fullText", "")
            cont_text = continuation.get("fullText", "")
            
            # Append continuation text
            merged_text = source_text + cont_text
            article["fullText"] = merged_text
            
            # Mark continuation for removal
            cont_id = (target_page, continuation.get("headline", ""))
            continuation_ids.add(cont_id)
            merge_count += 1
            
            console.print(f"  [green]✓ Merged:[/green] '{article.get('headline', '')[:40]}...' + p.{target_page} continuation")
        else:
            console.print(f"  [yellow]⚠ No match found for:[/yellow] '{article.get('headline', '')[:40]}...' → p.{target_page}")
    
    # Filter out merged continuations
    result = []
    for item in all_articles:
        article = item["raw"]
        page = item["page"]
        headline = article.get("headline", "")
        
        # Skip if this is a continuation that was merged
        if (page, headline) in continuation_ids:
            continue
        
        result.append(item)
    
    console.print(f"\n[bold]Merge summary ({strategy}):[/bold] {merge_count} articles merged, {len(all_articles) - len(result)} fragments removed\n")
    
    return result


def assemble_edition(edition_id: str, merge_strategy: str = "page_only"):
    """
    Assemble curated articles into frontend-ready JSON.

    Input:
      - pages/page_XX_articles.json

    Output:
      - edition.json (frontend-ready format)
      
    Args:
      merge_strategy: 'page_only', 'headline_partial', 'headline_contained', or 'none'
    """
    paths = get_edition_paths(edition_id)
    pages_dir = paths["pages_dir"]
    images_dir = paths["images_dir"]
    output_file = paths["final_json"]

    # Find article files
    article_files = sorted(pages_dir.glob("page_*_articles.json"), key=lambda p: p.name)
    if not article_files:
        console.print(f"[red]Error: No article files found in {pages_dir}[/red]")
        console.print("Run curate.py first to extract articles.")
        sys.exit(1)

    # Load image metadata for reference
    images_metadata = {}
    metadata_path = images_dir / "images-metadata.json"
    if metadata_path.exists():
        with open(metadata_path) as f:
            images_metadata = json.load(f)

    console.print(f"\n[bold]Assembling edition: {edition_id}[/bold]")
    console.print(f"Found {len(article_files)} page files\n")

    # Collect all articles
    all_articles = []
    page_articles_map = {}  # For determining lead stories

    for article_file in article_files:
        with open(article_file) as f:
            data = json.load(f)

        page_num = data["page"]
        articles = data.get("articles", [])
        page_articles_map[page_num] = articles

        for i, article in enumerate(articles):
            all_articles.append({
                "raw": article,
                "page": page_num,
                "index": i
            })

    # Merge continued articles (if strategy is not 'none')
    if merge_strategy and merge_strategy != "none":
        console.print(f"[cyan]Merging continued articles (strategy: {merge_strategy})...[/cyan]")
        all_articles = merge_continued_articles(all_articles, strategy=merge_strategy)
        # Rebuild page_articles_map after merging
        page_articles_map = {}
        for item in all_articles:
            page = item["page"]
            if page not in page_articles_map:
                page_articles_map[page] = []
            page_articles_map[page].append(item["raw"])

    # Transform to frontend format
    frontend_articles = []

    # Track which images have been assigned (for fallback assignment)
    assigned_images = set()

    # First pass: collect all explicitly assigned images
    for item in all_articles:
        article = item["raw"]
        related_images = article.get("relatedImages") or []
        assigned_images.update(related_images)

    for item in all_articles:
        article = item["raw"]
        page_num = item["page"]
        index = item["index"]
        page_articles = page_articles_map[page_num]

        # Build image URL
        related_images = article.get("relatedImages") or []
        image_url = None
        if related_images:
            image_url = f"/editions/{edition_id}/extracted-images/{related_images[0]}"

        # Determine hero/featured status
        is_hero = page_num == 1 and is_lead_story(article, page_articles)
        is_featured = should_feature(article)

        # Fallback image assignment for hero/featured articles without images
        if not image_url and (is_hero or is_featured):
            page_images = images_metadata.get(str(page_num), [])
            for img in page_images:
                img_filename = img.get("filename", "")
                if img_filename and img_filename not in assigned_images:
                    image_url = f"/editions/{edition_id}/extracted-images/{img_filename}"
                    assigned_images.add(img_filename)
                    console.print(f"  [cyan]Fallback image:[/cyan] Assigned {img_filename} to '{article.get('headline', '')[:40]}...'")
                    break

        frontend_article = {
            "id": generate_article_id(edition_id, article.get("headline", ""), page_num, index),
            "date": edition_id,
            "category": normalize_category(article.get("category", "News")),
            "headline": article.get("headline", "Untitled"),
            "summary": article.get("summary", ""),
            "fullText": article.get("fullText", ""),
            "imageUrl": image_url,
            "byline": article.get("byline"),
            "page": page_num,
            "isHero": is_hero,
            "isFeatured": is_featured,
            "imageCaption": extract_caption(article),
            "continuesOnPage": article.get("continuesOnPage"),
        }

        frontend_articles.append(frontend_article)

    # Sort by page, then by position within page
    frontend_articles.sort(key=lambda a: (a["page"], 0 if a["isHero"] else 1))

    # Build final output
    output = {
        "edition": edition_id,
        "pageCount": len(article_files),
        "articleCount": len(frontend_articles),
        "articles": frontend_articles
    }

    # Save
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    console.print(f"[green]✓ Saved to {output_file}[/green]\n")

    # Print summary table
    table = Table(title="Edition Summary")
    table.add_column("Category", style="cyan")
    table.add_column("Count", justify="right")

    category_counts = {}
    for article in frontend_articles:
        cat = article["category"]
        category_counts[cat] = category_counts.get(cat, 0) + 1

    for cat, count in sorted(category_counts.items()):
        table.add_row(cat, str(count))

    table.add_row("─" * 10, "─" * 5, style="dim")
    table.add_row("Total", str(len(frontend_articles)), style="bold")

    console.print(table)

    # Print hero/featured articles
    hero_articles = [a for a in frontend_articles if a["isHero"]]
    featured_articles = [a for a in frontend_articles if a["isFeatured"] and not a["isHero"]]

    if hero_articles:
        console.print("\n[bold]Hero Article:[/bold]")
        for a in hero_articles:
            console.print(f"  • {a['headline'][:60]}...")

    if featured_articles:
        console.print(f"\n[bold]Featured Articles ({len(featured_articles)}):[/bold]")
        for a in featured_articles[:5]:
            console.print(f"  • {a['headline'][:60]}...")
        if len(featured_articles) > 5:
            console.print(f"  ... and {len(featured_articles) - 5} more")


def main():
    parser = argparse.ArgumentParser(description="Assemble articles into frontend JSON")
    parser.add_argument("--edition", required=True, help="Edition ID (e.g., 1986-10-17)")
    parser.add_argument(
        "--merge-strategy", 
        choices=["page_only", "headline_partial", "headline_contained", "none"],
        default="page_only",
        help="Strategy for matching article continuations (default: page_only)"
    )

    args = parser.parse_args()
    assemble_edition(args.edition, merge_strategy=args.merge_strategy)


if __name__ == "__main__":
    main()
