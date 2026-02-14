"""
Import OCR pipeline output (edition.json + diagnostics.json) into the database.

Usage:
    python -m db.import_editions                    # Import all editions from output/
    python -m db.import_editions 1991-11-19         # Import single edition
    python -m db.import_editions --dry-run          # Preview without writing
    python -m db.import_editions --dry-run 1991-11-19
"""

import json
import os
import re
import sys
import unicodedata
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import func, select

from db.connection import get_session
from db.storage import ensure_bucket, get_storage_client, upload_image
from db.models import (
    Author,
    ContentAuthor,
    ContentItem,
    ContentType,
    Edition,
    Image,
    ImportRun,
    Page,
    Publication,
    Semester,
)

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output"

# Known author roles — matched case-insensitively at end of byline
KNOWN_ROLES = [
    "Editor-in-Chief",
    "Managing Editor",
    "News Editor",
    "Arts Editor",
    "Sports Editor",
    "Opinion Editor",
    "Photo Editor",
    "Copy Editor",
    "Staff Writer",
    "Staff Reporter",
    "Staff Columnist",
    "Contributing Writer",
    "Correspondent",
    "Transcript Staff",
    # Section/beat attributions (OCR sometimes includes these)
    "News",
    "Arts",
    "Sports",
    "Opinion",
    "Academics",
    "Academic Affairs",
    "Senior Class President",
    "Student Opposition Party",
]
_ROLE_PATTERN = re.compile(
    r",?\s*(" + "|".join(re.escape(r) for r in KNOWN_ROLES) + r")\s*$",
    re.IGNORECASE,
)

# Graduation year patterns: 'XX or class of XXXX
_GRAD_YEAR_PATTERN = re.compile(r"""(?:'(\d{2})\b|class\s+of\s+(\d{4}))""", re.IGNORECASE)


def slugify(text: str) -> str:
    """Convert text to URL-safe slug."""
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^\w\s-]", "", text.lower())
    text = re.sub(r"[-\s]+", "-", text).strip("-")
    return text


def derive_academic_year(d: date) -> str:
    """Derive academic year string from edition date. Aug-Dec = start year."""
    if d.month >= 8:
        return f"{d.year}-{d.year + 1}"
    return f"{d.year - 1}-{d.year}"


def derive_semester(d: date) -> Semester:
    """Derive semester from edition date."""
    if d.month >= 8 or d.month == 12:
        return Semester.fall
    if 1 <= d.month <= 5:
        return Semester.spring
    return Semester.summer


def parse_author(raw_byline: str) -> list[dict]:
    """
    Parse a raw byline into structured author records.

    Returns list of dicts with keys: name, role, graduation_year, position
    """
    if not raw_byline or not raw_byline.strip():
        return []

    byline = raw_byline.strip()

    # Strip "By " prefix
    byline = re.sub(r"^By\s+", "", byline, flags=re.IGNORECASE)

    # Extract role if present (shared across all authors in byline)
    role = None
    role_match = _ROLE_PATTERN.search(byline)
    if role_match:
        role = role_match.group(1)
        byline = byline[: role_match.start()].strip()

    # Split on " and " for multi-author bylines FIRST, then extract per-author details
    names = re.split(r"\s+and\s+", byline, flags=re.IGNORECASE)

    results = []
    for i, name in enumerate(names):
        name = name.strip().rstrip(",")
        if not name:
            continue

        # Extract graduation year per author
        grad_year = None
        grad_match = _GRAD_YEAR_PATTERN.search(name)
        if grad_match:
            if grad_match.group(1):  # 'XX format
                yy = int(grad_match.group(1))
                grad_year = 1900 + yy if yy > 50 else 2000 + yy
            else:  # class of XXXX format
                grad_year = int(grad_match.group(2))
            name = name[: grad_match.start()].strip().rstrip(",")

        if not name:
            continue

        # Normalize to title case (but preserve single-letter initials)
        parts = name.split()
        normalized_parts = []
        for p in parts:
            if len(p) <= 2 and p.endswith("."):
                normalized_parts.append(p.upper())
            else:
                normalized_parts.append(p.title())
        canonical = " ".join(normalized_parts)

        results.append({
            "name": canonical,
            "role": role,
            "graduation_year": grad_year,
            "position": i,
        })

    return results


def get_or_create_author(session, name: str, grad_year: int | None = None) -> Author:
    """Find existing author by case-insensitive name match, or create new."""
    existing = session.execute(
        select(Author).where(func.lower(Author.canonical_name) == name.lower())
    ).scalar_one_or_none()

    if existing:
        # Update graduation year if we have it and they don't
        if grad_year and not existing.graduation_year:
            existing.graduation_year = grad_year
        return existing

    author = Author(
        canonical_name=name,
        slug=slugify(name),
        graduation_year=grad_year,
    )
    session.add(author)
    session.flush()
    return author


def count_words(text: str | None) -> int:
    if not text:
        return 0
    return len(text.split())


def import_edition(session, edition_dir: Path, publication_id: int, dry_run: bool = False, storage_client=None) -> dict:
    """
    Import a single edition from its output directory.

    Returns summary dict with counts.
    """
    edition_json = edition_dir / "edition.json"
    if not edition_json.exists():
        print(f"  SKIP: No edition.json in {edition_dir.name}")
        return {"skipped": True}

    with open(edition_json) as f:
        data = json.load(f)

    edition_date_str = data["edition_date"]
    edition_date = date.fromisoformat(edition_date_str)

    print(f"  Importing {edition_date_str}...")

    # Delete existing edition data for idempotency (cascade deletes content, pages, images, etc.)
    existing = session.execute(
        select(Edition).where(
            Edition.publication_id == publication_id,
            Edition.edition_date == edition_date,
        )
    ).scalar_one_or_none()

    if existing:
        print(f"    Replacing existing edition (id={existing.id})")
        session.delete(existing)
        session.flush()

    # Count pages from .md files in edition dir
    page_files = sorted(edition_dir.glob("*.md"))
    page_count = len(page_files)

    # Create edition
    edition = Edition(
        publication_id=publication_id,
        edition_date=edition_date,
        publication_info=data.get("publication_info", ""),
        page_count=page_count,
        academic_year=derive_academic_year(edition_date),
        semester=derive_semester(edition_date),
    )
    session.add(edition)
    session.flush()

    # Create page rows
    for pf in page_files:
        # Extract page number from filename like "0001_Page 1.md"
        match = re.search(r"Page\s+(\d+)", pf.name)
        if match:
            page_num = int(match.group(1))
            # Derive scan filename from .md name
            scan_base = pf.stem  # "0001_Page 1"
            page = Page(
                edition_id=edition.id,
                page_number=page_num,
                scan_filename=scan_base,
            )
            session.add(page)

    session.flush()

    stats = {"articles": 0, "ads": 0, "other_content": 0, "authors": 0, "images": 0, "uploads": 0}
    sort_order = 0

    # Import articles
    for article_data in data.get("articles", []):
        sort_order += 1
        body = article_data.get("body", "")
        headline = article_data.get("headline", "")
        author_raw = article_data.get("author", "")

        item = ContentItem(
            edition_id=edition.id,
            content_type=ContentType.article,
            headline=headline,
            body=body,
            author_raw=author_raw,
            source_pages=article_data.get("source_pages", []),
            sort_order=sort_order,
            has_illegible="[illegible]" in body,
            word_count=count_words(body),
        )
        session.add(item)
        session.flush()

        # Parse and link authors
        parsed_authors = parse_author(author_raw)
        for pa in parsed_authors:
            author = get_or_create_author(session, pa["name"], pa["graduation_year"])
            ca = ContentAuthor(
                content_id=item.id,
                author_id=author.id,
                role=pa["role"],
                author_position=pa["position"],
            )
            session.add(ca)
            stats["authors"] += 1

        # Link images (from article.images metadata + article.image_files)
        image_files = article_data.get("image_files", [])
        image_meta = article_data.get("images", [])

        for idx, img_file in enumerate(image_files):
            caption = image_meta[idx]["caption"] if idx < len(image_meta) else ""
            position = image_meta[idx].get("position", "") if idx < len(image_meta) else ""

            # Extract source page from filename: "images/0001_Page 1_img2.jpg"
            page_match = re.search(r"Page\s+(\d+)", img_file)
            source_page = int(page_match.group(1)) if page_match else None

            # Get file size if the image exists on disk
            img_path = edition_dir / img_file
            file_size = img_path.stat().st_size if img_path.exists() else None

            img = Image(
                edition_id=edition.id,
                content_id=item.id,
                file_path=img_file,
                caption=caption,
                page_position=position,
                source_page=source_page,
                file_size_bytes=file_size,
                is_standalone=False,
            )
            session.add(img)
            stats["images"] += 1

            if storage_client and img_path.exists():
                storage_path = f"{edition_date_str}/{img_path.name}"
                img.storage_url = upload_image(storage_client, img_path, storage_path)
                if img.storage_url:
                    stats["uploads"] += 1

        # Handle images in metadata that don't have corresponding files
        # (OCR detected an image but CV didn't match a file to it)
        for idx in range(len(image_files), len(image_meta)):
            img = Image(
                edition_id=edition.id,
                content_id=item.id,
                file_path=None,
                caption=image_meta[idx].get("caption", ""),
                page_position=image_meta[idx].get("position", ""),
                is_standalone=False,
            )
            session.add(img)

        stats["articles"] += 1

    # Import ads
    for ad_data in data.get("ads", []):
        sort_order += 1
        body = ad_data.get("body", "")
        business_name = ad_data.get("business_name", "")

        item = ContentItem(
            edition_id=edition.id,
            content_type=ContentType.ad,
            headline=business_name,  # unified headline field
            body=body,
            business_name=business_name,
            sort_order=sort_order,
            has_illegible="[illegible]" in body,
            word_count=count_words(body),
        )
        session.add(item)
        session.flush()

        # Link ad images
        for idx, img_file in enumerate(ad_data.get("image_files", [])):
            page_match = re.search(r"Page\s+(\d+)", img_file)
            source_page = int(page_match.group(1)) if page_match else None
            img_path = edition_dir / img_file
            file_size = img_path.stat().st_size if img_path.exists() else None

            img = Image(
                edition_id=edition.id,
                content_id=item.id,
                file_path=img_file,
                source_page=source_page,
                file_size_bytes=file_size,
                is_standalone=False,
            )
            session.add(img)
            stats["images"] += 1

            if storage_client and img_path.exists():
                storage_path = f"{edition_date_str}/{img_path.name}"
                img.storage_url = upload_image(storage_client, img_path, storage_path)
                if img.storage_url:
                    stats["uploads"] += 1

        stats["ads"] += 1

    # Import other_content
    for other_data in data.get("other_content", []):
        sort_order += 1
        body = other_data.get("body", "")
        title = other_data.get("title", "")

        item = ContentItem(
            edition_id=edition.id,
            content_type=ContentType.other_content,
            headline=title,
            body=body,
            sort_order=sort_order,
            has_illegible="[illegible]" in body,
            word_count=count_words(body),
        )
        session.add(item)
        stats["other_content"] += 1

    # Check for standalone images (in images/ dir but not linked to any content)
    images_dir = edition_dir / "images"
    if images_dir.exists():
        linked_files = set()
        for a in data.get("articles", []):
            linked_files.update(a.get("image_files", []))
        for a in data.get("ads", []):
            linked_files.update(a.get("image_files", []))

        for img_path in sorted(images_dir.glob("*.jpg")):
            rel_path = f"images/{img_path.name}"
            if rel_path not in linked_files:
                img = Image(
                    edition_id=edition.id,
                    content_id=None,
                    file_path=rel_path,
                    file_size_bytes=img_path.stat().st_size,
                    is_standalone=True,
                )
                page_match = re.search(r"Page\s+(\d+)", img_path.name)
                if page_match:
                    img.source_page = int(page_match.group(1))
                session.add(img)
                stats["images"] += 1

                if storage_client and img_path.exists():
                    storage_path = f"{edition_date_str}/{img_path.name}"
                    img.storage_url = upload_image(storage_client, img_path, storage_path)
                    if img.storage_url:
                        stats["uploads"] += 1

    # Import diagnostics
    diag_file = edition_dir / "diagnostics.json"
    if diag_file.exists():
        with open(diag_file) as f:
            diag_data = json.load(f)

        # Sum token counts across pages
        total_prompt_tokens = 0
        for pd in diag_data.get("page_diagnostics", []):
            tokens = pd.get("gemini_tokens", {})
            total_prompt_tokens += tokens.get("prompt_tokens", 0)

        # Calculate total time
        total_time = None
        if diag_data.get("start_time") and diag_data.get("end_time"):
            start = datetime.fromisoformat(diag_data["start_time"])
            end = datetime.fromisoformat(diag_data["end_time"])
            total_time = (end - start).total_seconds()

        import_run = ImportRun(
            edition_id=edition.id,
            status="success",
            source_path=str(edition_dir),
            diagnostics=diag_data,
            pages_attempted=diag_data.get("pages_attempted"),
            pages_processed=diag_data.get("pages_processed"),
            total_prompt_tokens=total_prompt_tokens,
            total_time_seconds=total_time,
        )
        session.add(import_run)

    session.flush()
    return stats


def ensure_publication(session) -> int:
    """Ensure The Transcript publication record exists. Returns its id."""
    pub = session.execute(
        select(Publication).where(Publication.name == "The Transcript")
    ).scalar_one_or_none()

    if pub:
        return pub.id

    pub = Publication(
        name="The Transcript",
        institution="Ohio Wesleyan University",
        city="Delaware",
        state="Ohio",
        description="An independent student newspaper at Ohio Wesleyan University",
    )
    session.add(pub)
    session.flush()
    return pub.id


def main():
    args = sys.argv[1:]
    dry_run = "--dry-run" in args
    args = [a for a in args if a != "--dry-run"]

    edition_filter = args[0] if args else None

    # Initialize Supabase Storage (None if env vars missing — uploads silently skipped)
    storage_client = None if dry_run else get_storage_client()
    if storage_client:
        ensure_bucket(storage_client)
        print("Supabase Storage connected — images will be uploaded\n")

    session = get_session()
    try:
        pub_id = ensure_publication(session)

        # Find edition directories
        if edition_filter:
            # Match directories that start with the given date
            candidates = [
                d for d in OUTPUT_DIR.iterdir()
                if d.is_dir() and d.name.startswith(edition_filter)
            ]
            if not candidates:
                print(f"No edition directory found matching '{edition_filter}' in {OUTPUT_DIR}")
                sys.exit(1)
        else:
            candidates = sorted(
                d for d in OUTPUT_DIR.iterdir()
                if d.is_dir() and (d / "edition.json").exists()
            )

        if not candidates:
            print(f"No editions found in {OUTPUT_DIR}")
            sys.exit(1)

        print(f"Found {len(candidates)} edition(s) to import")
        if dry_run:
            print("DRY RUN — no changes will be committed\n")

        total_stats = {"articles": 0, "ads": 0, "other_content": 0, "authors": 0, "images": 0, "uploads": 0}

        for edition_dir in candidates:
            stats = import_edition(session, edition_dir, pub_id, dry_run, storage_client)
            if stats.get("skipped"):
                continue
            for k in total_stats:
                total_stats[k] += stats.get(k, 0)

        print(f"\n{'DRY RUN ' if dry_run else ''}Import complete:")
        print(f"  Articles:      {total_stats['articles']}")
        print(f"  Ads:           {total_stats['ads']}")
        print(f"  Other content: {total_stats['other_content']}")
        print(f"  Author links:  {total_stats['authors']}")
        print(f"  Images:        {total_stats['images']}")
        if total_stats["uploads"]:
            print(f"  Uploads:       {total_stats['uploads']}")

        # Count unique authors
        unique_authors = session.execute(
            select(func.count(Author.id))
        ).scalar()
        print(f"  Unique authors: {unique_authors}")

        if dry_run:
            print("\nRolling back (dry run).")
            session.rollback()
        else:
            session.commit()
            print("\nCommitted to database.")

    except Exception as e:
        session.rollback()
        print(f"\nERROR: {e}")
        raise
    finally:
        session.close()


if __name__ == "__main__":
    main()
