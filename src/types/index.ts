/**
 * Shared Type Definitions
 * Single source of truth for all types used across frontend and API layers.
 */

// ─── Frontend Types ─────────────────────────────────────────────

export interface Article {
    id: string;
    date: string;
    category: "News" | "Sports" | "Features" | "Opinion" | "Arts" | "Campus Life" | "Ads";
    headline: string;
    summary: string;
    fullText: string;
    imageUrls: string[];
    byline?: string | null;
    page: number;
    isHero: boolean;
    isFeatured: boolean;
    imageCaption?: string | null;
    continuesOnPage?: number | null;
    continuesFromPage?: number | null;
    relatedImages?: string[];
}

export interface EditionInfo {
    id: string;
    date: string;
    pageCount: number;
    articleCount: number;
}

export interface VintageAd {
    title: string;
    subtitle?: string;
    body: string;
    price?: string;
    footer?: string;
    tag?: string;
    imageUrl?: string;
}

export type SectionId = "Top" | Article["category"] | "All";

// ─── OCR / Server-Side Types ────────────────────────────────────

export interface OcrImage {
    caption: string;
    position: string;
}

export interface OcrArticle {
    headline: string;
    author: string;
    body: string;
    images: OcrImage[];
    image_files: string[];
    source_pages: string[];
}

export interface OcrAd {
    business_name: string;
    body: string;
    image_files: string[];
}

export interface OcrEdition {
    edition_date: string;
    publication_info: string;
    articles: OcrArticle[];
    ads: OcrAd[];
    other_content: { title: string; body: string }[];
}
