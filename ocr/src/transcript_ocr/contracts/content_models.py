"""Canonical OCR content contracts."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

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


class ArticleImage(BaseModel):
    caption: str
    position: str = ""


class Article(BaseModel):
    headline: str = Field(
        description="Primary headline only — the main title in large/bold type. Exclude subheadlines, deck text, and kickers.",
    )
    author: str = ""
    writer_position: str = ""
    category: Literal["Campus News", "News", "Sports", "Arts & Entertainment", "Opinion"] = Field(
        default="Campus News",
        description="Must be exactly one of: Campus News, News, Sports, Arts & Entertainment, Opinion",
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
    images: list[ArticleImage] = []
    image_files: list[str] = []


class OtherContent(BaseModel):
    title: str = ""
    body: str


class Ad(BaseModel):
    business_name: str
    body: str
    image_files: list[str] = []


class PageContent(BaseModel):
    articles: list[Article]
    other_content: list[OtherContent] = []
    ads: list[Ad] = []
    page_number: str = ""
    publication_info: str = ""


class MergedArticle(BaseModel):
    headline: str = Field(
        default="",
        description="Primary headline only — the main title in large/bold type. Exclude subheadlines, deck text, and kickers.",
    )
    author: str = ""
    writer_position: str = ""
    category: Literal["Campus News", "News", "Sports", "Arts & Entertainment", "Opinion"] = Field(
        default="Campus News",
        description="Must be exactly one of: Campus News, News, Sports, Arts & Entertainment, Opinion",
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
    images: list[ArticleImage] = []
    image_files: list[str] = []
    source_pages: list[str] = []


class EditionContent(BaseModel):
    articles: list[MergedArticle]
    ads: list[Ad] = []
    other_content: list[OtherContent] = []


class MergeInstruction(BaseModel):
    article_ids: list[int]
    merged_headline: str
    merged_author: str = ""
    merged_writer_position: str = ""
    confidence: float = Field(default=1.0, description="0.0-1.0 confidence in this grouping decision")


class MergeDecisions(BaseModel):
    groups: list[MergeInstruction]


class ImageRegionAssignment(BaseModel):
    region_number: int
    content_type: Literal["article", "ad", "standalone", "text_ad", "not_image"] = Field(
        description="Type of content in this region: article photo, ad image, standalone image, text-only ad, or scanner noise/artifact",
    )
    content_index: int = Field(
        default=-1,
        description="0-based index into the article or ad list. Use -1 for standalone, text_ad, or not_image.",
    )
    caption: str = Field(
        default="",
        description="Brief description of what the image shows. Leave empty for text_ad and not_image.",
    )


class ImageRegionAssignments(BaseModel):
    assignments: list[ImageRegionAssignment]


class SuspectArticleDecision(BaseModel):
    index: int = Field(description="0-based index into the suspect articles list")
    decision: Literal["keep", "demote"] = Field(
        description="'keep' = real article, stays. 'demote' = not a real article, move to other_content.",
    )


class OtherContentDecision(BaseModel):
    index: int = Field(description="0-based index into the other content list")
    decision: Literal["promote", "keep"] = Field(
        description="'promote' = real article, move to articles. 'keep' = stays in other_content.",
    )
    headline: str = Field(
        default="",
        description="For promoted items: a clean headline. Empty for 'keep'.",
    )
    category: Literal["Campus News", "News", "Sports", "Arts & Entertainment", "Opinion"] = Field(
        default="Campus News",
        description="For promoted items: article category. Ignored for 'keep'.",
    )


class ContentTriageResponse(BaseModel):
    suspect_articles: list[SuspectArticleDecision]
    other_content: list[OtherContentDecision]


class EnrichedAd(BaseModel):
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


class EnrichedAdsResponse(BaseModel):
    enriched_ads: list[EnrichedAd]


__all__ = [
    "AD_ENRICHMENT_CATEGORIES",
    "ARTICLE_CATEGORIES",
    "Ad",
    "Article",
    "ArticleImage",
    "ContentTriageResponse",
    "EditionContent",
    "EnrichedAd",
    "EnrichedAdsResponse",
    "ImageRegionAssignment",
    "ImageRegionAssignments",
    "MergeDecisions",
    "MergeInstruction",
    "MergedArticle",
    "OtherContent",
    "OtherContentDecision",
    "PageContent",
    "SuspectArticleDecision",
]
