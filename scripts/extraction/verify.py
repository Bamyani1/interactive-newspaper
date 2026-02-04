#!/usr/bin/env python3
"""
Verification Tool
Generate an HTML verification report with extracted images and articles for manual review.

Usage:
    python verify.py --edition 1986-10-17
    python verify.py --edition 1986-10-17 --page 1
"""
import argparse
import base64
import json
import webbrowser
from pathlib import Path

from rich.console import Console

from config import get_edition_paths

console = Console()

HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Extraction Verification - {edition_id}</title>
    <style>
        * {{
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a2e;
            color: #eee;
            line-height: 1.6;
        }}
        .container {{
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
        }}
        header {{
            text-align: center;
            padding: 30px 0;
            border-bottom: 1px solid #333;
            margin-bottom: 30px;
        }}
        header h1 {{
            font-size: 2.5rem;
            color: #fff;
        }}
        header p {{
            color: #888;
            margin-top: 10px;
        }}
        .stats {{
            display: flex;
            justify-content: center;
            gap: 40px;
            margin-top: 20px;
        }}
        .stat {{
            text-align: center;
        }}
        .stat-value {{
            font-size: 2rem;
            font-weight: bold;
            color: #4ecdc4;
        }}
        .stat-label {{
            color: #888;
            font-size: 0.9rem;
        }}
        .page-section {{
            background: #16213e;
            border-radius: 12px;
            padding: 30px;
            margin-bottom: 30px;
        }}
        .page-header {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 1px solid #333;
        }}
        .page-header h2 {{
            font-size: 1.5rem;
        }}
        .page-layout {{
            display: grid;
            grid-template-columns: 300px 1fr;
            gap: 30px;
        }}
        .page-images {{
            display: flex;
            flex-direction: column;
            gap: 15px;
        }}
        .page-images h3 {{
            font-size: 1rem;
            color: #888;
            margin-bottom: 5px;
        }}
        .page-images img {{
            width: 100%;
            border-radius: 8px;
            border: 1px solid #333;
        }}
        .extracted-image {{
            background: #0f0f23;
            padding: 10px;
            border-radius: 8px;
        }}
        .extracted-image img {{
            margin-bottom: 8px;
        }}
        .extracted-image .filename {{
            font-family: monospace;
            font-size: 0.8rem;
            color: #4ecdc4;
        }}
        .extracted-image .confidence {{
            font-size: 0.75rem;
            color: #888;
        }}
        .articles {{
            display: flex;
            flex-direction: column;
            gap: 20px;
        }}
        .article {{
            background: #0f0f23;
            border-radius: 8px;
            padding: 20px;
            border-left: 4px solid #4ecdc4;
        }}
        .article.has-image {{
            border-left-color: #f39c12;
        }}
        .article-header {{
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 15px;
        }}
        .article h3 {{
            font-size: 1.2rem;
            color: #fff;
            flex: 1;
        }}
        .article-meta {{
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            margin-bottom: 10px;
        }}
        .badge {{
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 0.75rem;
            font-weight: 600;
        }}
        .badge-category {{
            background: #4ecdc4;
            color: #000;
        }}
        .badge-continues {{
            background: #f39c12;
            color: #000;
        }}
        .badge-image {{
            background: #e74c3c;
            color: #fff;
        }}
        .byline {{
            color: #888;
            font-style: italic;
            margin-bottom: 10px;
        }}
        .summary {{
            color: #ccc;
            margin-bottom: 15px;
            padding: 10px;
            background: rgba(255,255,255,0.05);
            border-radius: 4px;
        }}
        .full-text {{
            color: #aaa;
            font-size: 0.9rem;
            max-height: 200px;
            overflow-y: auto;
            padding: 15px;
            background: rgba(0,0,0,0.3);
            border-radius: 4px;
        }}
        .full-text p {{
            margin-bottom: 10px;
        }}
        .image-match {{
            margin-top: 15px;
            padding: 15px;
            background: rgba(243, 156, 18, 0.1);
            border-radius: 8px;
            border: 1px solid #f39c12;
        }}
        .image-match h4 {{
            color: #f39c12;
            margin-bottom: 10px;
            font-size: 0.9rem;
        }}
        .image-match img {{
            max-width: 200px;
            border-radius: 4px;
        }}
        .image-match .caption {{
            margin-top: 10px;
            font-size: 0.85rem;
            color: #ccc;
            font-style: italic;
        }}
        .no-articles {{
            text-align: center;
            padding: 40px;
            color: #666;
        }}
        .toggle-btn {{
            background: #333;
            border: none;
            color: #fff;
            padding: 5px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.8rem;
        }}
        .toggle-btn:hover {{
            background: #444;
        }}
        .ocr-text {{
            display: none;
            margin-top: 20px;
            padding: 15px;
            background: #0a0a1a;
            border-radius: 8px;
            font-family: monospace;
            font-size: 0.8rem;
            white-space: pre-wrap;
            max-height: 400px;
            overflow-y: auto;
            color: #888;
        }}
        .ocr-text.visible {{
            display: block;
        }}
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>Extraction Verification</h1>
            <p>Edition: {edition_id}</p>
            <div class="stats">
                <div class="stat">
                    <div class="stat-value">{total_pages}</div>
                    <div class="stat-label">Pages</div>
                </div>
                <div class="stat">
                    <div class="stat-value">{total_articles}</div>
                    <div class="stat-label">Articles</div>
                </div>
                <div class="stat">
                    <div class="stat-value">{total_images}</div>
                    <div class="stat-label">Images</div>
                </div>
            </div>
        </header>

        {pages_html}
    </div>

    <script>
        function toggleOCR(pageNum) {{
            const el = document.getElementById('ocr-' + pageNum);
            el.classList.toggle('visible');
        }}
    </script>
</body>
</html>
"""

PAGE_TEMPLATE = """
<section class="page-section">
    <div class="page-header">
        <h2>Page {page_num}</h2>
        <button class="toggle-btn" onclick="toggleOCR({page_num})">Show/Hide OCR Text</button>
    </div>

    <div class="page-layout">
        <div class="page-images">
            <div>
                <h3>Extracted Images ({image_count})</h3>
                {images_html}
            </div>
        </div>

        <div class="articles">
            <h3>Articles ({article_count})</h3>
            {articles_html}
        </div>
    </div>

    <div id="ocr-{page_num}" class="ocr-text">{ocr_text}</div>
</section>
"""

ARTICLE_TEMPLATE = """
<div class="article {has_image_class}">
    <div class="article-header">
        <h3>{headline}</h3>
    </div>
    <div class="article-meta">
        <span class="badge badge-category">{category}</span>
        {continues_badge}
        {image_badge}
    </div>
    {byline_html}
    <div class="summary">{summary}</div>
    {image_match_html}
    <div class="full-text">{full_text}</div>
</div>
"""


def image_to_base64(image_path: Path) -> str:
    """Convert image to base64 data URL."""
    if not image_path.exists():
        return ""
    with open(image_path, "rb") as f:
        data = base64.b64encode(f.read()).decode()
    suffix = image_path.suffix.lower()
    mime = "image/jpeg" if suffix in [".jpg", ".jpeg"] else "image/png"
    return f"data:{mime};base64,{data}"


def generate_report(edition_id: str, single_page: int | None = None):
    """Generate HTML verification report."""
    paths = get_edition_paths(edition_id)
    pages_dir = paths["pages_dir"]
    images_dir = paths["images_dir"]
    output_dir = paths["output_dir"]

    # Find article files - check both pages subdirectory and output directory directly
    article_files = sorted(pages_dir.glob("page_*_articles.json"))

    # If not found in pages dir, check output dir directly (for test runs)
    if not article_files:
        article_files = sorted(output_dir.glob("page_*_articles.json"))
        pages_dir = output_dir

    # Also check for images in output dir
    if not images_dir.exists() or not list(images_dir.glob("*.jpg")):
        alt_images_dir = output_dir / "images"
        if alt_images_dir.exists():
            images_dir = alt_images_dir
    if not article_files:
        console.print(f"[red]No article files found in {pages_dir}[/red]")
        console.print("[dim]Run curate.py first to extract articles.[/dim]")
        return

    # Load images metadata
    images_metadata = {}
    metadata_path = images_dir / "images-metadata.json"
    if metadata_path.exists():
        with open(metadata_path) as f:
            images_metadata = {int(k): v for k, v in json.load(f).items()}

    # Filter to single page if specified
    if single_page:
        article_files = [f for f in article_files if f"page_{single_page:02d}" in f.name]

    pages_html = []
    total_articles = 0
    total_images = sum(len(imgs) for imgs in images_metadata.values())

    for article_file in article_files:
        # Get page number
        page_num = int(article_file.stem.split("_")[1])

        # Load articles
        with open(article_file) as f:
            data = json.load(f)
        articles = data.get("articles", [])
        total_articles += len(articles)

        # Load OCR text
        ocr_file = pages_dir / f"page_{page_num:02d}.txt"
        ocr_text = ocr_file.read_text() if ocr_file.exists() else "OCR text not found"

        # Get page images
        page_images = images_metadata.get(page_num, [])

        # Build images HTML
        images_html = ""
        for img in page_images:
            img_path = images_dir / img["filename"]
            img_data = image_to_base64(img_path)
            if img_data:
                images_html += f"""
                <div class="extracted-image">
                    <img src="{img_data}" alt="{img['filename']}">
                    <div class="filename">{img['filename']}</div>
                    <div class="confidence">Confidence: {img['confidence']:.0%}</div>
                </div>
                """

        if not images_html:
            images_html = "<p style='color:#666'>No images extracted</p>"

        # Build articles HTML
        articles_html = ""
        for article in articles:
            headline = article.get("headline", "Untitled").replace("\n", " ")
            category = article.get("category", "Unknown")
            byline = article.get("byline", "").replace("\n", " ") if article.get("byline") else ""
            summary = article.get("summary", "")
            full_text = article.get("fullText", "")
            continues_on = article.get("continuesOnPage")
            related_images = article.get("relatedImages", [])
            image_caption = article.get("imageCaption", "")

            # Badges
            continues_badge = f'<span class="badge badge-continues">→ Page {continues_on}</span>' if continues_on else ""
            image_badge = f'<span class="badge badge-image">{len(related_images)} image(s)</span>' if related_images else ""

            # Byline
            byline_html = f'<div class="byline">{byline}</div>' if byline else ""

            # Image match
            image_match_html = ""
            if related_images:
                for img_filename in related_images:
                    img_path = images_dir / img_filename
                    img_data = image_to_base64(img_path)
                    if img_data:
                        caption_html = f'<div class="caption">{image_caption.replace(chr(10), " ")}</div>' if image_caption else ""
                        image_match_html += f"""
                        <div class="image-match">
                            <h4>Matched Image: {img_filename}</h4>
                            <img src="{img_data}" alt="{img_filename}">
                            {caption_html}
                        </div>
                        """

            has_image_class = "has-image" if related_images else ""

            articles_html += ARTICLE_TEMPLATE.format(
                headline=headline,
                category=category,
                continues_badge=continues_badge,
                image_badge=image_badge,
                byline_html=byline_html,
                summary=summary,
                image_match_html=image_match_html,
                full_text=full_text,
                has_image_class=has_image_class
            )

        if not articles_html:
            articles_html = '<div class="no-articles">No articles extracted</div>'

        # Build page HTML
        pages_html.append(PAGE_TEMPLATE.format(
            page_num=page_num,
            image_count=len(page_images),
            images_html=images_html,
            article_count=len(articles),
            articles_html=articles_html,
            ocr_text=ocr_text.replace("<", "&lt;").replace(">", "&gt;")
        ))

    # Build final HTML
    html = HTML_TEMPLATE.format(
        edition_id=edition_id,
        total_pages=len(article_files),
        total_articles=total_articles,
        total_images=total_images,
        pages_html="\n".join(pages_html)
    )

    # Save report
    report_path = paths["output_dir"].parent / f"{edition_id}-verification.html"
    report_path.write_text(html)
    console.print(f"[green]Report saved to: {report_path}[/green]")

    # Open in browser
    webbrowser.open(f"file://{report_path}")


def main():
    parser = argparse.ArgumentParser(description="Generate verification report")
    parser.add_argument("--edition", required=True, help="Edition ID")
    parser.add_argument("--page", type=int, help="Single page number")

    args = parser.parse_args()
    generate_report(args.edition, single_page=args.page)


if __name__ == "__main__":
    main()
