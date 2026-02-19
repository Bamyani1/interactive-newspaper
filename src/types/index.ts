/**
 * Shared Type Definitions
 * Single source of truth for all types used across frontend and API layers.
 */

// ─── Frontend Types ─────────────────────────────────────────────

export interface Article {
    id: string;
    date: string;
    category: "News" | "Sports" | "Features" | "Opinion" | "Arts" | "Campus Life";
    headline: string;
    summary: string;
    fullText: string;
    imageUrls: string[];
    byline?: string | null;
    page: number;
    isHero: boolean;
    isFeatured: boolean;
    imageCaption?: string | null;
    imageCaptions: (string | null)[];
}

export interface EditionInfo {
    id: string;
    date: string;
    pageCount: number;
    articleCount: number;
}

export type AdCategory =
    | "Food & Drink" | "Entertainment" | "Services" | "Retail"
    | "Greek Life" | "Jobs" | "Housing" | "Education" | "Events" | "Other";

export type AdType = "display" | "classified";

export interface VintageAd {
    title: string;
    body: string;
    category?: AdCategory;
    adType?: AdType;
    displayText?: string;
    phone?: string;
    address?: string;
    price?: string;
}

export type WeatherSource =
    | "NOAA_GHCN_DAILY_ARCHIVE"
    | "NOAA_DAILY_SUMMARIES"
    | "ACIS_STNDATA"
    | "OPEN_METEO_ARCHIVE";

export interface WeatherQuery {
    date: string;
    location_name?: string;
    lat?: number;
    lon?: number;
    state?: string;
    country?: string;
    station_id?: string;
    /**
     * Test and diagnostics switch. When true, skip station observations and use
     * reanalysis fallback directly.
     */
    force_fallback?: boolean;
}

export interface DailyWeatherRecord {
    date: string;
    tmax_c: number | null;
    tmin_c: number | null;
    precip_mm: number | null;
    source: WeatherSource;
    source_station_id: string | null;
    quality_flag: string | null;
    is_estimated: boolean;
    raw: Record<string, unknown>;
}

export interface MonthlyTrendingTrack {
    rank: number;
    title: string;
    artist: string;
    youtubeId: string;
}

export interface MonthlyTrendingRecord {
    month: string;
    tracks: MonthlyTrendingTrack[];
}

export type MonthlyTrendingReason = "INVALID_DATE" | "NO_DATA" | null;

export type SectionId = "Top" | Article["category"] | "Ads" | "Classifieds" | "All";

// ─── OCR / Server-Side Types ────────────────────────────────────

export interface OcrImage {
    caption: string;
    position: string;
}

export interface OcrArticle {
    headline?: string;
    author?: string;
    body?: string;
    images: OcrImage[];
    image_files: string[];
    source_pages: string[];
}

export interface OcrAd {
    business_name: string;
    body: string;
    image_files: string[];
}

export interface OcrEnrichedAd extends OcrAd {
    category: string;
    ad_type: string;
    display_text?: string;
    phone?: string;
    address?: string;
    price?: string;
}

export interface OcrEdition {
    edition_date: string;
    publication_info: string;
    articles: OcrArticle[];
    ads: OcrAd[];
    enriched_ads?: OcrEnrichedAd[];
    categories?: string[];   // parallel to articles[], added by enrich_articles.py
    other_content: { title: string; body: string }[];
}
