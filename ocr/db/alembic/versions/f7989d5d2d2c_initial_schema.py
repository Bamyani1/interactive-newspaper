"""initial schema

Revision ID: f7989d5d2d2c
Revises:
Create Date: 2026-02-13 00:52:57.756115

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'f7989d5d2d2c'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Extensions ───────────────────────────────────────────────────
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")

    # ── publications ─────────────────────────────────────────────────
    op.create_table(
        "publications",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("institution", sa.String(255)),
        sa.Column("city", sa.String(100)),
        sa.Column("state", sa.String(50)),
        sa.Column("description", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── editions ─────────────────────────────────────────────────────
    semester_enum = postgresql.ENUM("Fall", "Spring", "Summer", name="semester", create_type=True)
    semester_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "editions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("publication_id", sa.Integer, sa.ForeignKey("publications.id"), nullable=False),
        sa.Column("edition_date", sa.Date, nullable=False),
        sa.Column("publication_info", sa.Text),
        sa.Column("page_count", sa.SmallInteger),
        sa.Column("academic_year", sa.String(9)),
        sa.Column("semester", semester_enum),
        sa.Column("ocr_quality_score", sa.Float),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("publication_id", "edition_date", name="uq_edition_pub_date"),
    )
    op.create_index("ix_editions_edition_date", "editions", ["edition_date"])

    # ── pages ────────────────────────────────────────────────────────
    op.create_table(
        "pages",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("edition_id", sa.Integer, sa.ForeignKey("editions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("page_number", sa.SmallInteger, nullable=False),
        sa.Column("scan_filename", sa.String(255)),
        sa.UniqueConstraint("edition_id", "page_number", name="uq_page_edition_num"),
    )

    # ── content_type enum ────────────────────────────────────────────
    content_type_enum = postgresql.ENUM("article", "ad", "other_content", name="contenttype", create_type=True)
    content_type_enum.create(op.get_bind(), checkfirst=True)

    # ── content_items ────────────────────────────────────────────────
    op.create_table(
        "content_items",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("edition_id", sa.Integer, sa.ForeignKey("editions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content_type", content_type_enum, nullable=False),
        sa.Column("headline", sa.Text),
        sa.Column("body", sa.Text),
        sa.Column("author_raw", sa.Text),
        sa.Column("business_name", sa.String(500)),
        sa.Column("source_pages", postgresql.ARRAY(sa.Text)),
        sa.Column("sort_order", sa.SmallInteger, default=0),
        sa.Column("has_illegible", sa.Boolean, default=False),
        sa.Column("word_count", sa.Integer),
        sa.Column("search_vector", postgresql.TSVECTOR),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_content_items_edition_id", "content_items", ["edition_id"])
    op.create_index("ix_content_items_content_type", "content_items", ["content_type"])
    op.create_index("ix_content_items_search_vector", "content_items", ["search_vector"], postgresql_using="gin")
    op.create_index(
        "ix_content_items_headline_trgm", "content_items", ["headline"],
        postgresql_using="gin", postgresql_ops={"headline": "gin_trgm_ops"},
    )

    # ── authors ──────────────────────────────────────────────────────
    op.create_table(
        "authors",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("canonical_name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(255), unique=True, nullable=False),
        sa.Column("graduation_year", sa.SmallInteger),
        sa.Column("is_staff", sa.Boolean, default=False),
        sa.Column("bio", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        "ix_authors_name_trgm", "authors", ["canonical_name"],
        postgresql_using="gin", postgresql_ops={"canonical_name": "gin_trgm_ops"},
    )

    # ── content_authors ──────────────────────────────────────────────
    op.create_table(
        "content_authors",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("content_id", sa.Integer, sa.ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_id", sa.Integer, sa.ForeignKey("authors.id"), nullable=False),
        sa.Column("role", sa.String(100)),
        sa.Column("author_position", sa.SmallInteger, default=0),
        sa.UniqueConstraint("content_id", "author_id", name="uq_content_author"),
    )
    op.create_index("ix_content_authors_content_id", "content_authors", ["content_id"])
    op.create_index("ix_content_authors_author_id", "content_authors", ["author_id"])

    # ── images ───────────────────────────────────────────────────────
    op.create_table(
        "images",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("edition_id", sa.Integer, sa.ForeignKey("editions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content_id", sa.Integer, sa.ForeignKey("content_items.id", ondelete="SET NULL"), nullable=True),
        sa.Column("file_path", sa.String(500)),
        sa.Column("storage_url", sa.Text),
        sa.Column("thumbnail_url", sa.Text),
        sa.Column("caption", sa.Text),
        sa.Column("page_position", sa.String(50)),
        sa.Column("source_page", sa.SmallInteger),
        sa.Column("width_px", sa.Integer),
        sa.Column("height_px", sa.Integer),
        sa.Column("file_size_bytes", sa.Integer),
        sa.Column("is_standalone", sa.Boolean, default=False),
    )
    op.create_index("ix_images_edition_id", "images", ["edition_id"])

    # ── categories ───────────────────────────────────────────────────
    op.create_table(
        "categories",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(100), unique=True, nullable=False),
        sa.Column("slug", sa.String(100), unique=True, nullable=False),
        sa.Column("sort_order", sa.SmallInteger, default=0),
    )

    # ── content_categories ───────────────────────────────────────────
    op.create_table(
        "content_categories",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("content_id", sa.Integer, sa.ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("category_id", sa.Integer, sa.ForeignKey("categories.id"), nullable=False),
        sa.Column("confidence", sa.Float),
        sa.Column("classified_by", sa.String(50)),
        sa.UniqueConstraint("content_id", "category_id", name="uq_content_category"),
    )
    op.create_index("ix_content_categories_content_id", "content_categories", ["content_id"])
    op.create_index("ix_content_categories_category_id", "content_categories", ["category_id"])

    # ── tags ─────────────────────────────────────────────────────────
    op.create_table(
        "tags",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(100), unique=True, nullable=False),
        sa.Column("slug", sa.String(100), unique=True, nullable=False),
    )

    # ── content_tags ─────────────────────────────────────────────────
    op.create_table(
        "content_tags",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("content_id", sa.Integer, sa.ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tag_id", sa.Integer, sa.ForeignKey("tags.id"), nullable=False),
        sa.UniqueConstraint("content_id", "tag_id", name="uq_content_tag"),
    )
    op.create_index("ix_content_tags_content_id", "content_tags", ["content_id"])
    op.create_index("ix_content_tags_tag_id", "content_tags", ["tag_id"])

    # ── people ───────────────────────────────────────────────────────
    op.create_table(
        "people",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("canonical_name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(255), unique=True, nullable=False),
        sa.Column("graduation_year", sa.SmallInteger),
        sa.Column("author_id", sa.Integer, sa.ForeignKey("authors.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        "ix_people_name_trgm", "people", ["canonical_name"],
        postgresql_using="gin", postgresql_ops={"canonical_name": "gin_trgm_ops"},
    )

    # ── mentions ─────────────────────────────────────────────────────
    op.create_table(
        "mentions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("content_id", sa.Integer, sa.ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("person_id", sa.Integer, sa.ForeignKey("people.id"), nullable=False),
        sa.Column("mention_text", sa.Text),
        sa.Column("mention_context", sa.Text),
        sa.Column("confidence", sa.Float),
        sa.Column("extracted_by", sa.String(50)),
    )
    op.create_index("ix_mentions_content_id", "mentions", ["content_id"])
    op.create_index("ix_mentions_person_id", "mentions", ["person_id"])

    # ── users ────────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(255), unique=True, nullable=False),
        sa.Column("display_name", sa.String(255)),
        sa.Column("graduation_year", sa.SmallInteger),
        sa.Column("person_id", sa.Integer, sa.ForeignKey("people.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── bookmarks ────────────────────────────────────────────────────
    op.create_table(
        "bookmarks",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content_id", sa.Integer, sa.ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("note", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "content_id", name="uq_bookmark_user_content"),
    )
    op.create_index("ix_bookmarks_user_id", "bookmarks", ["user_id"])
    op.create_index("ix_bookmarks_content_id", "bookmarks", ["content_id"])

    # ── memories ─────────────────────────────────────────────────────
    op.create_table(
        "memories",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content_id", sa.Integer, sa.ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("is_approved", sa.Boolean, default=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_memories_user_id", "memories", ["user_id"])
    op.create_index("ix_memories_content_id", "memories", ["content_id"])

    # ── import_runs ──────────────────────────────────────────────────
    op.create_table(
        "import_runs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("edition_id", sa.Integer, sa.ForeignKey("editions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(50), nullable=False),
        sa.Column("source_path", sa.Text),
        sa.Column("diagnostics", postgresql.JSONB),
        sa.Column("pages_attempted", sa.SmallInteger),
        sa.Column("pages_processed", sa.SmallInteger),
        sa.Column("total_prompt_tokens", sa.Integer),
        sa.Column("total_time_seconds", sa.Float),
        sa.Column("imported_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_import_runs_edition_id", "import_runs", ["edition_id"])

    # ── Full-Text Search trigger ─────────────────────────────────────
    # Auto-maintain search_vector on content_items INSERT/UPDATE
    # Weights: A=headline, B=author_raw/business_name, C=body
    op.execute("""
        CREATE OR REPLACE FUNCTION content_items_search_vector_update() RETURNS trigger AS $$
        BEGIN
            NEW.search_vector :=
                setweight(to_tsvector('english', coalesce(NEW.headline, '')), 'A') ||
                setweight(to_tsvector('english', coalesce(NEW.author_raw, '')), 'B') ||
                setweight(to_tsvector('english', coalesce(NEW.business_name, '')), 'B') ||
                setweight(to_tsvector('english', coalesce(NEW.body, '')), 'C');
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)

    op.execute("""
        CREATE TRIGGER content_items_search_vector_trigger
        BEFORE INSERT OR UPDATE OF headline, body, author_raw, business_name
        ON content_items
        FOR EACH ROW
        EXECUTE FUNCTION content_items_search_vector_update();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS content_items_search_vector_trigger ON content_items")
    op.execute("DROP FUNCTION IF EXISTS content_items_search_vector_update()")

    op.drop_table("import_runs")
    op.drop_table("memories")
    op.drop_table("bookmarks")
    op.drop_table("users")
    op.drop_table("mentions")
    op.drop_table("people")
    op.drop_table("content_tags")
    op.drop_table("tags")
    op.drop_table("content_categories")
    op.drop_table("categories")
    op.drop_table("images")
    op.drop_table("content_authors")
    op.drop_table("authors")
    op.drop_table("content_items")
    op.drop_table("pages")
    op.drop_table("editions")
    op.drop_table("publications")

    op.execute("DROP TYPE IF EXISTS contenttype")
    op.execute("DROP TYPE IF EXISTS semester")
