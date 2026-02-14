"""SQLAlchemy models for the Historical Newspaper Archive."""

from datetime import date, datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TSVECTOR
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


# ── Enums ────────────────────────────────────────────────────────────

import enum


class ContentType(str, enum.Enum):
    article = "article"
    ad = "ad"
    other_content = "other_content"


class Semester(str, enum.Enum):
    fall = "Fall"
    spring = "Spring"
    summer = "Summer"


# ── Core tables ──────────────────────────────────────────────────────


class Publication(Base):
    __tablename__ = "publications"

    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    institution = Column(String(255))
    city = Column(String(100))
    state = Column(String(50))
    description = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    editions = relationship("Edition", back_populates="publication")


class Edition(Base):
    __tablename__ = "editions"
    __table_args__ = (
        UniqueConstraint("publication_id", "edition_date", name="uq_edition_pub_date"),
    )

    id = Column(Integer, primary_key=True)
    publication_id = Column(Integer, ForeignKey("publications.id"), nullable=False)
    edition_date = Column(Date, nullable=False, index=True)
    publication_info = Column(Text)
    page_count = Column(SmallInteger)
    academic_year = Column(String(9))  # "1990-1991"
    semester = Column(Enum(Semester))
    ocr_quality_score = Column(Float)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    publication = relationship("Publication", back_populates="editions")
    pages = relationship("Page", back_populates="edition", cascade="all, delete-orphan")
    content_items = relationship("ContentItem", back_populates="edition", cascade="all, delete-orphan")
    images = relationship("Image", back_populates="edition", cascade="all, delete-orphan")
    import_runs = relationship("ImportRun", back_populates="edition", cascade="all, delete-orphan")


class Page(Base):
    __tablename__ = "pages"
    __table_args__ = (
        UniqueConstraint("edition_id", "page_number", name="uq_page_edition_num"),
    )

    id = Column(Integer, primary_key=True)
    edition_id = Column(Integer, ForeignKey("editions.id", ondelete="CASCADE"), nullable=False)
    page_number = Column(SmallInteger, nullable=False)
    scan_filename = Column(String(255))

    edition = relationship("Edition", back_populates="pages")


# ── Content ──────────────────────────────────────────────────────────


class ContentItem(Base):
    __tablename__ = "content_items"

    id = Column(Integer, primary_key=True)
    edition_id = Column(Integer, ForeignKey("editions.id", ondelete="CASCADE"), nullable=False, index=True)
    content_type = Column(Enum(ContentType), nullable=False, index=True)
    headline = Column(Text)  # articles: headline, ads: business_name, other: title
    body = Column(Text)
    author_raw = Column(Text)  # preserved original byline text
    business_name = Column(String(500))  # ads only
    source_pages = Column(ARRAY(Text))
    sort_order = Column(SmallInteger, default=0)
    has_illegible = Column(Boolean, default=False)
    word_count = Column(Integer)
    search_vector = Column(TSVECTOR)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    edition = relationship("Edition", back_populates="content_items")
    content_authors = relationship("ContentAuthor", back_populates="content_item", cascade="all, delete-orphan")
    images = relationship("Image", back_populates="content_item")
    content_categories = relationship("ContentCategory", back_populates="content_item", cascade="all, delete-orphan")
    content_tags = relationship("ContentTag", back_populates="content_item", cascade="all, delete-orphan")
    mentions = relationship("Mention", back_populates="content_item", cascade="all, delete-orphan")
    bookmarks = relationship("Bookmark", back_populates="content_item", cascade="all, delete-orphan")
    memories = relationship("Memory", back_populates="content_item", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_content_items_search_vector", "search_vector", postgresql_using="gin"),
        Index("ix_content_items_headline_trgm", "headline", postgresql_using="gin",
              postgresql_ops={"headline": "gin_trgm_ops"}),
    )


# ── Authors ──────────────────────────────────────────────────────────


class Author(Base):
    __tablename__ = "authors"

    id = Column(Integer, primary_key=True)
    canonical_name = Column(String(255), nullable=False)
    slug = Column(String(255), unique=True, nullable=False)
    graduation_year = Column(SmallInteger)
    is_staff = Column(Boolean, default=False)
    bio = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    content_authors = relationship("ContentAuthor", back_populates="author")

    __table_args__ = (
        Index("ix_authors_name_trgm", "canonical_name", postgresql_using="gin",
              postgresql_ops={"canonical_name": "gin_trgm_ops"}),
    )


class ContentAuthor(Base):
    __tablename__ = "content_authors"
    __table_args__ = (
        UniqueConstraint("content_id", "author_id", name="uq_content_author"),
    )

    id = Column(Integer, primary_key=True)
    content_id = Column(Integer, ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id = Column(Integer, ForeignKey("authors.id"), nullable=False, index=True)
    role = Column(String(100))  # "Staff Writer", "Arts Editor", etc.
    author_position = Column(SmallInteger, default=0)  # 0 = primary

    content_item = relationship("ContentItem", back_populates="content_authors")
    author = relationship("Author", back_populates="content_authors")


# ── Images ───────────────────────────────────────────────────────────


class Image(Base):
    __tablename__ = "images"

    id = Column(Integer, primary_key=True)
    edition_id = Column(Integer, ForeignKey("editions.id", ondelete="CASCADE"), nullable=False, index=True)
    content_id = Column(Integer, ForeignKey("content_items.id", ondelete="SET NULL"), nullable=True)
    file_path = Column(String(500))  # relative: "images/0001_Page 1_img2.jpg"
    storage_url = Column(Text)  # Supabase Storage public URL
    thumbnail_url = Column(Text)
    caption = Column(Text)
    page_position = Column(String(50))  # "top-left", "center-right", etc.
    source_page = Column(SmallInteger)
    width_px = Column(Integer)
    height_px = Column(Integer)
    file_size_bytes = Column(Integer)
    is_standalone = Column(Boolean, default=False)

    edition = relationship("Edition", back_populates="images")
    content_item = relationship("ContentItem", back_populates="images")


# ── Classification & Tagging ────────────────────────────────────────


class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True)
    name = Column(String(100), unique=True, nullable=False)
    slug = Column(String(100), unique=True, nullable=False)
    sort_order = Column(SmallInteger, default=0)

    content_categories = relationship("ContentCategory", back_populates="category")


class ContentCategory(Base):
    __tablename__ = "content_categories"
    __table_args__ = (
        UniqueConstraint("content_id", "category_id", name="uq_content_category"),
    )

    id = Column(Integer, primary_key=True)
    content_id = Column(Integer, ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False, index=True)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=False, index=True)
    confidence = Column(Float)  # 0.0 - 1.0
    classified_by = Column(String(50))  # "manual", "ai_gemini", "rule_based"

    content_item = relationship("ContentItem", back_populates="content_categories")
    category = relationship("Category", back_populates="content_categories")


class Tag(Base):
    __tablename__ = "tags"

    id = Column(Integer, primary_key=True)
    name = Column(String(100), unique=True, nullable=False)
    slug = Column(String(100), unique=True, nullable=False)

    content_tags = relationship("ContentTag", back_populates="tag")


class ContentTag(Base):
    __tablename__ = "content_tags"
    __table_args__ = (
        UniqueConstraint("content_id", "tag_id", name="uq_content_tag"),
    )

    id = Column(Integer, primary_key=True)
    content_id = Column(Integer, ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False, index=True)
    tag_id = Column(Integer, ForeignKey("tags.id"), nullable=False, index=True)

    content_item = relationship("ContentItem", back_populates="content_tags")
    tag = relationship("Tag", back_populates="content_tags")


# ── People & Mentions ───────────────────────────────────────────────


class Person(Base):
    __tablename__ = "people"

    id = Column(Integer, primary_key=True)
    canonical_name = Column(String(255), nullable=False)
    slug = Column(String(255), unique=True, nullable=False)
    graduation_year = Column(SmallInteger)
    author_id = Column(Integer, ForeignKey("authors.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    author = relationship("Author")
    mentions = relationship("Mention", back_populates="person")

    __table_args__ = (
        Index("ix_people_name_trgm", "canonical_name", postgresql_using="gin",
              postgresql_ops={"canonical_name": "gin_trgm_ops"}),
    )


class Mention(Base):
    __tablename__ = "mentions"

    id = Column(Integer, primary_key=True)
    content_id = Column(Integer, ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False, index=True)
    person_id = Column(Integer, ForeignKey("people.id"), nullable=False, index=True)
    mention_text = Column(Text)  # exact match from body
    mention_context = Column(Text)  # surrounding sentence
    confidence = Column(Float)
    extracted_by = Column(String(50))  # "spacy_ner", "ai_gemini", "manual"

    content_item = relationship("ContentItem", back_populates="mentions")
    person = relationship("Person", back_populates="mentions")


# ── User-Facing Tables ──────────────────────────────────────────────


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, nullable=False)
    display_name = Column(String(255))
    graduation_year = Column(SmallInteger)
    person_id = Column(Integer, ForeignKey("people.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    person = relationship("Person")
    bookmarks = relationship("Bookmark", back_populates="user", cascade="all, delete-orphan")
    memories = relationship("Memory", back_populates="user", cascade="all, delete-orphan")


class Bookmark(Base):
    __tablename__ = "bookmarks"
    __table_args__ = (
        UniqueConstraint("user_id", "content_id", name="uq_bookmark_user_content"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    content_id = Column(Integer, ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False, index=True)
    note = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="bookmarks")
    content_item = relationship("ContentItem", back_populates="bookmarks")


class Memory(Base):
    __tablename__ = "memories"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    content_id = Column(Integer, ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False, index=True)
    body = Column(Text, nullable=False)
    is_approved = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="memories")
    content_item = relationship("ContentItem", back_populates="memories")


# ── Import Provenance ────────────────────────────────────────────────


class ImportRun(Base):
    __tablename__ = "import_runs"

    id = Column(Integer, primary_key=True)
    edition_id = Column(Integer, ForeignKey("editions.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(50), nullable=False)  # "success", "partial", "failed"
    source_path = Column(Text)
    diagnostics = Column(JSONB)  # full diagnostics.json stored as-is
    pages_attempted = Column(SmallInteger)
    pages_processed = Column(SmallInteger)
    total_prompt_tokens = Column(Integer)
    total_time_seconds = Column(Float)
    imported_at = Column(DateTime(timezone=True), server_default=func.now())

    edition = relationship("Edition", back_populates="import_runs")
