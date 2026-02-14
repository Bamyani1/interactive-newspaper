"""Seed reference data: categories and publication record."""

from sqlalchemy import select

from db.connection import get_session
from db.models import Category, Publication

DEFAULT_CATEGORIES = [
    ("News", "news", 1),
    ("Opinion", "opinion", 2),
    ("Arts", "arts", 3),
    ("Sports", "sports", 4),
    ("Letters", "letters", 5),
    ("Classifieds", "classifieds", 6),
    ("Other", "other", 7),
]


def seed_categories(session):
    """Insert default categories if they don't exist."""
    for name, slug, sort_order in DEFAULT_CATEGORIES:
        existing = session.execute(
            select(Category).where(Category.slug == slug)
        ).scalar_one_or_none()
        if not existing:
            session.add(Category(name=name, slug=slug, sort_order=sort_order))
            print(f"  Created category: {name}")
        else:
            print(f"  Category exists: {name}")


def seed_publication(session):
    """Ensure The Transcript publication record exists."""
    existing = session.execute(
        select(Publication).where(Publication.name == "The Transcript")
    ).scalar_one_or_none()
    if not existing:
        session.add(Publication(
            name="The Transcript",
            institution="Ohio Wesleyan University",
            city="Delaware",
            state="Ohio",
            description="An independent student newspaper at Ohio Wesleyan University",
        ))
        print("  Created publication: The Transcript")
    else:
        print("  Publication exists: The Transcript")


def main():
    session = get_session()
    try:
        print("Seeding reference data...")
        seed_publication(session)
        seed_categories(session)
        session.commit()
        print("Done.")
    except Exception as e:
        session.rollback()
        print(f"ERROR: {e}")
        raise
    finally:
        session.close()


if __name__ == "__main__":
    main()
