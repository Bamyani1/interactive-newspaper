"""Markdown exporters for page and edition output."""

from __future__ import annotations

from ..contracts.content_models import EditionContent, PageContent


def page_content_to_markdown(
    page_content: PageContent,
    page_name: str,
    standalone_images: list[str] | None = None,
) -> str:
    """Convert structured PageContent to readable Markdown."""
    lines = [f"# {page_name}"]

    if page_content.publication_info:
        lines.append(f"\n*{page_content.publication_info}*")

    if page_content.page_number:
        lines.append(f"\nPage {page_content.page_number}")

    for article in page_content.articles:
        lines.append("\n---\n")

        if article.headline:
            lines.append(f"## {article.headline}\n")

        if article.author:
            lines.append(f"*{article.author}*\n")

        body = article.body.replace("\r\n", "\n")
        paragraphs = [p.strip() for p in body.split("\n") if p.strip()]
        lines.append("\n\n".join(paragraphs))

        for i, img in enumerate(article.images):
            caption = img.caption
            lines.append(f"\n> Photo: {caption}")
            if i < len(article.image_files):
                lines.append(f"\n![{caption}]({article.image_files[i]})")

        for img_file in article.image_files[len(article.images) :]:
            lines.append(f"\n![Photo]({img_file})")

    for other in page_content.other_content:
        lines.append("\n---\n")

        if other.title:
            lines.append(f"## {other.title}\n")

        body = other.body.replace("\r\n", "\n")
        paragraphs = [p.strip() for p in body.split("\n") if p.strip()]
        lines.append("\n\n".join(paragraphs))

    if page_content.ads:
        lines.append("\n---\n")
        lines.append("## Advertisements\n")

        for ad in page_content.ads:
            lines.append(f"### {ad.business_name}\n")
            lines.append(ad.body.strip())
            for img_file in ad.image_files:
                lines.append(f"\n![Ad image]({img_file})")
            lines.append("")

    if standalone_images:
        lines.append("\n---\n")
        lines.append("## Images\n")
        for img_file in standalone_images:
            lines.append(f"![Page image]({img_file})\n")

    return "\n".join(lines) + "\n"


def edition_to_markdown(edition_date: str, edition_content: EditionContent) -> str:
    """Convert merged EditionContent to a single Markdown document."""
    lines = [f"# {edition_date}"]

    for article in edition_content.articles:
        lines.append("\n---\n")
        if article.headline:
            lines.append(f"## {article.headline}\n")
        if article.author:
            lines.append(f"*{article.author}*\n")
        if article.source_pages:
            lines.append(f"*Pages: {', '.join(article.source_pages)}*\n")

        body = article.body.replace("\r\n", "\n")
        paragraphs = [p.strip() for p in body.split("\n") if p.strip()]
        lines.append("\n\n".join(paragraphs))

        for i, img in enumerate(article.images):
            caption = img.caption
            lines.append(f"\n> Photo: {caption}")
            if i < len(article.image_files):
                lines.append(f"\n![{caption}]({article.image_files[i]})")

        for img_file in article.image_files[len(article.images) :]:
            lines.append(f"\n![Photo]({img_file})")

    for other in edition_content.other_content:
        lines.append("\n---\n")
        if other.title:
            lines.append(f"## {other.title}\n")
        body = other.body.replace("\r\n", "\n")
        paragraphs = [p.strip() for p in body.split("\n") if p.strip()]
        lines.append("\n\n".join(paragraphs))

    if edition_content.ads:
        lines.append("\n---\n")
        lines.append("## Advertisements\n")
        for ad in edition_content.ads:
            lines.append(f"### {ad.business_name}\n")
            lines.append(ad.body.strip())
            for img_file in ad.image_files:
                lines.append(f"\n![Ad image]({img_file})")
            lines.append("")

    return "\n".join(lines) + "\n"


__all__ = ["edition_to_markdown", "page_content_to_markdown"]
