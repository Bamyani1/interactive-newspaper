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
    headline: str
    author: str = ""
    writer_position: str = ""
    category: Literal["Campus News", "News", "Sports", "Arts & Entertainment", "Opinion"] = Field(
        default="Campus News",
        description="Must be exactly one of: Campus News, News, Sports, Arts & Entertainment, Opinion",
    )
    continues_on: str = ""
    continued_from: str = ""
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
    headline: str
    author: str = ""
    writer_position: str = ""
    category: Literal["Campus News", "News", "Sports", "Arts & Entertainment", "Opinion"] = Field(
        default="Campus News",
        description="Must be exactly one of: Campus News, News, Sports, Arts & Entertainment, Opinion",
    )
    continues_on: str = ""
    continued_from: str = ""
    body: str
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
    content_type: str
    content_index: int = -1
    caption: str = ""


class ImageRegionAssignments(BaseModel):
    assignments: list[ImageRegionAssignment]


class EnrichedAd(BaseModel):
    business_name: str
    body: str
    image_files: list[str]
    category: str
    ad_type: str
    display_text: str
    phone: str
    address: str
    price: str


class EnrichedAdsResponse(BaseModel):
    enriched_ads: list[EnrichedAd]


__all__ = [
    "AD_ENRICHMENT_CATEGORIES",
    "ARTICLE_CATEGORIES",
    "Ad",
    "Article",
    "ArticleImage",
    "EditionContent",
    "EnrichedAd",
    "EnrichedAdsResponse",
    "ImageRegionAssignment",
    "ImageRegionAssignments",
    "MergeDecisions",
    "MergeInstruction",
    "MergedArticle",
    "OtherContent",
    "PageContent",
]
