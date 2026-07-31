"""Canonical OCR content contracts."""

from __future__ import annotations

from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PrivateAttr,
    field_validator,
    model_validator,
)

ARTICLE_CATEGORIES = (
    "Campus News",
    "News",
    "Sports",
    "Arts & Entertainment",
    "Opinion",
)

AD_ENRICHMENT_CATEGORIES = (
    "Food & Drink",
    "Entertainment",
    "Services",
    "Retail",
    "Greek Life",
    "Jobs",
    "Housing",
    "Education",
    "Events",
    "Other",
)


class ContractModel(BaseModel):
    """Strict base for every model-facing OCR response contract."""

    model_config = ConfigDict(extra="forbid")
    _source_pages_internal: list[str] = PrivateAttr(default_factory=list)
    _review_unresolved: bool = PrivateAttr(default=False)
    _visual_kind_conflict: bool = PrivateAttr(default=False)


class _FallbackCategory(str):
    """Internal marker that serializes exactly like its public string value."""


class ArticleImage(ContractModel):
    caption: str
    position: str = ""


class Article(ContractModel):
    headline: str = Field(
        description="Primary headline only — the main title in large/bold type. Exclude subheadlines, deck text, and kickers.",
    )
    author: str = ""
    writer_position: str = ""
    category: str = Field(
        default="News",
        description="Must be exactly one of: Campus News, News, Sports, Arts & Entertainment, Opinion",
        json_schema_extra={"enum": list(ARTICLE_CATEGORIES)},
    )
    continues_on: str = Field(
        default="",
        description="Page number (digits only) where this article continues, or '?' if ambiguous. Empty string if none.",
    )
    continued_from: str = Field(
        default="",
        description="Page number (digits only) where this article continues from. Empty string if none.",
    )
    body: str
    images: list[ArticleImage] = Field(default_factory=list)
    image_files: list[str] = Field(default_factory=list)
    _category_fallback_used: bool = PrivateAttr(default=False)

    @field_validator("category", mode="after")
    @classmethod
    def _fallback_invalid_category(cls, value):
        return value if value in ARTICLE_CATEGORIES else _FallbackCategory("News")

    @model_validator(mode="after")
    def _remember_category_fallback(self):
        self._category_fallback_used = (
            "category" not in self.model_fields_set
            or isinstance(self.category, _FallbackCategory)
        )
        return self


class OtherContent(ContractModel):
    title: str = ""
    body: str


class Ad(ContractModel):
    business_name: str
    body: str
    image_files: list[str] = Field(default_factory=list)


class PageContent(ContractModel):
    articles: list[Article]
    other_content: list[OtherContent] = Field(default_factory=list)
    ads: list[Ad] = Field(default_factory=list)
    page_number: str = ""
    publication_info: str = ""


class MergedArticle(ContractModel):
    headline: str = Field(
        default="",
        description="Primary headline only — the main title in large/bold type. Exclude subheadlines, deck text, and kickers.",
    )
    author: str = ""
    writer_position: str = ""
    category: str = Field(
        default="News",
        description="Must be exactly one of: Campus News, News, Sports, Arts & Entertainment, Opinion",
        json_schema_extra={"enum": list(ARTICLE_CATEGORIES)},
    )
    continues_on: str = Field(
        default="",
        description="Page number (digits only) where this article continues, or '?' if ambiguous. Empty string if none.",
    )
    continued_from: str = Field(
        default="",
        description="Page number (digits only) where this article continues from. Empty string if none.",
    )
    body: str = ""
    images: list[ArticleImage] = Field(default_factory=list)
    image_files: list[str] = Field(default_factory=list)
    source_pages: list[str] = Field(default_factory=list)
    _category_fallback_used: bool = PrivateAttr(default=False)

    @field_validator("category", mode="after")
    @classmethod
    def _fallback_invalid_category(cls, value):
        return value if value in ARTICLE_CATEGORIES else _FallbackCategory("News")

    @model_validator(mode="after")
    def _remember_category_fallback(self):
        self._category_fallback_used = (
            "category" not in self.model_fields_set
            or isinstance(self.category, _FallbackCategory)
        )
        return self


class EditionContent(ContractModel):
    articles: list[MergedArticle]
    ads: list[Ad] = Field(default_factory=list)
    other_content: list[OtherContent] = Field(default_factory=list)


class ImageRegionAssignment(ContractModel):
    region_number: int
    visual_type: Literal[
        "photograph",
        "illustration",
        "table_chart_map",
        "logo",
        "typographic_display_ad",
        "plain_text",
        "scanner_decorative_artifact",
        "unresolved",
    ] = Field(
        description="What is visibly present, independent of its archive attachment",
    )
    attachment: Literal["article", "ad", "standalone", "reject"] = Field(
        description="Which archive item owns this region, or reject/standalone",
    )
    content_index: int = Field(
        default=-1,
        description="0-based article/ad index; -1 for standalone or reject",
    )
    caption_slot: int = Field(
        default=-1,
        description="Page-local printed-caption slot, or -1 when none matches",
    )
    rejection_reason: Literal[
        "plain_text",
        "scanner_decorative_artifact",
        "rejected_small_ad_visual",
    ] | None = None

    # Compatibility properties for the current assignment applier.  They are
    # deliberately absent from the model schema, so Gemini cannot generate a
    # caption or collapse visual type and attachment back into one decision.
    @property
    def content_type(self) -> str:
        if self.attachment != "reject":
            return self.attachment
        return "text_ad" if self.visual_type == "plain_text" else "not_image"

    @property
    def caption(self) -> str:
        return ""


class ImageRegionAssignments(ContractModel):
    assignments: list[ImageRegionAssignment]


class ContentReviewDecision(ContractModel):
    item_id: str = Field(description="Exact candidate ID supplied by the caller")
    target_type: Literal["article", "ad", "other"]
    category: Literal[
        "Campus News", "News", "Sports", "Arts & Entertainment", "Opinion",
    ] | None = None
    confidence: float = Field(ge=0.0, le=1.0)

    @model_validator(mode="after")
    def _category_only_for_articles(self):
        if self.target_type == "article" and self.category is None:
            raise ValueError("article review decisions require a category")
        if self.target_type != "article" and self.category is not None:
            raise ValueError("non-article review decisions must not include a category")
        return self


class ContentReviewResponse(ContractModel):
    decisions: list[ContentReviewDecision]


class EnrichedAd(ContractModel):
    business_name: str
    body: str
    image_files: list[str]
    category: Literal[
        "Food & Drink", "Entertainment", "Services", "Retail",
        "Greek Life", "Jobs", "Housing", "Education", "Events", "Other",
    ] = Field(description="Business category")
    ad_type: Literal["display", "classified"] = Field(
        description="'classified' ONLY for brief text-only listings (job postings, want-ads). Everything else is 'display'.",
    )
    display_text: str = Field(
        default="",
        description="Condensed ~150 char summary of the ad's key message.",
    )
    phone: str = ""
    address: str = ""
    price: str = ""


class AdEnrichmentDelta(ContractModel):
    ad_id: str = Field(description="Exact stable ID supplied by the caller")
    category: Literal[
        "Food & Drink", "Entertainment", "Services", "Retail",
        "Greek Life", "Jobs", "Housing", "Education", "Events", "Other",
    ]
    ad_type: Literal["display", "classified"]
    display_text: str = ""
    phone: str = ""
    address: str = ""
    price: str = ""


class AdEnrichmentDeltasResponse(ContractModel):
    ads: list[AdEnrichmentDelta]


__all__ = [
    "AD_ENRICHMENT_CATEGORIES",
    "ARTICLE_CATEGORIES",
    "Ad",
    "Article",
    "ArticleImage",
    "AdEnrichmentDelta",
    "AdEnrichmentDeltasResponse",
    "ContentReviewDecision",
    "ContentReviewResponse",
    "EditionContent",
    "EnrichedAd",
    "ImageRegionAssignment",
    "ImageRegionAssignments",
    "MergedArticle",
    "OtherContent",
    "PageContent",
]
