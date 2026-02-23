"use client";

import { useState, useEffect } from "react";
import type { Article, VintageAd } from "@/src/types";

interface RawApiArticle extends Omit<Article, 'imageUrls'> {
    imageUrls?: string[];
    imageUrl?: string;
}

interface EditionResponse {
    edition: {
        id: string;
        date: string;
        pageCount: number;
        publicationInfo?: string;
    };
    articles: RawApiArticle[];
    ads?: VintageAd[];
    pagination?: {
        nextCursor: string | null;
        hasMore: boolean;
    };
}

interface UseEditionArticlesResult {
    articles: Article[];
    ads: VintageAd[];
    publicationInfo: string;
    hasActiveEdition: boolean;
    isLoading: boolean;
    error: Error | null;
}

const CATEGORY_LOOKUP: Record<string, Article["category"]> = {
    "campus news": "Campus News",
    "campus-news": "Campus News",
    news: "News",
    "world & nation": "News",
    "world-and-nation": "News",
    sports: "Sports",
    features: "Campus News",       // backward compat: old editions with "Features" → Campus News
    opinion: "Opinion",
    "arts & entertainment": "Arts & Entertainment",
    "arts-and-entertainment": "Arts & Entertainment",
    arts: "Arts & Entertainment",
    photography: "Arts & Entertainment",
};

const normalizeText = (value: unknown): string =>
    typeof value === "string" ? value : "";

const normalizeCategory = (value: unknown): Article["category"] => {
    if (typeof value !== "string") return "Campus News";
    return CATEGORY_LOOKUP[value.trim().toLowerCase()] ?? "Campus News";
};

const normalizeId = (
    value: unknown,
    editionDate: string,
    page: number | undefined,
    index: number
): string => {
    if (typeof value === "string" && value.trim().length > 0) {
        return value;
    }
    return `${editionDate}-article-${page ?? 0}-${index}`;
};

export function useEditionArticles(date: string | null): UseEditionArticlesResult {
    const [articles, setArticles] = useState<Article[]>([]);
    const [ads, setAds] = useState<VintageAd[]>([]);
    const [publicationInfo, setPublicationInfo] = useState("");
    const [isLoading, setIsLoading] = useState(Boolean(date));
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        const abortController = new AbortController();

        async function fetchArticles() {
            if (!date) {
                setArticles([]);
                setAds([]);
                setPublicationInfo("");
                setError(null);
                setIsLoading(false);
                return;
            }

            setIsLoading(true);
            setError(null);

            try {
                const allArticles: RawApiArticle[] = [];
                const allAds: VintageAd[] = [];
                const seenCursors = new Set<string>();
                let cursor: string | null = null;
                let editionDate = date;
                let editionPublicationInfo = "";
                let pageRequests = 0;
                const maxPageRequests = 25;
                let remainingPages = false;

                while (pageRequests < maxPageRequests) {
                    pageRequests += 1;
                    const params = new URLSearchParams({ limit: "100" });
                    if (cursor) {
                        params.set("cursor", cursor);
                    }

                    const res = await fetch(`/api/editions/${date}?${params.toString()}`, {
                        signal: abortController.signal,
                    });

                    if (!res.ok) {
                        if (res.status === 404) {
                            allArticles.length = 0;
                            break;
                        }
                        throw new Error(`Failed to fetch edition: ${res.status}`);
                    }

                    const data: EditionResponse = await res.json();
                    editionDate = data.edition.date;
                    if (data.edition.publicationInfo) {
                        editionPublicationInfo = data.edition.publicationInfo;
                    }
                    allArticles.push(...data.articles);
                    if (data.ads) allAds.push(...data.ads);

                    const nextCursor = data.pagination?.nextCursor ?? null;
                    const hasMore = Boolean(data.pagination?.hasMore && nextCursor);
                    if (!hasMore || !nextCursor) {
                        remainingPages = false;
                        break;
                    }
                    remainingPages = true;

                    if (seenCursors.has(nextCursor)) {
                        console.warn(
                            `Stopped fetching edition ${date}: repeated cursor "${nextCursor}".`
                        );
                        remainingPages = false;
                        break;
                    }

                    seenCursors.add(nextCursor);
                    cursor = nextCursor;
                }

                if (remainingPages && pageRequests >= maxPageRequests) {
                    console.warn(
                        `Stopped fetching edition ${date}: exceeded ${maxPageRequests} pagination requests.`
                    );
                }

                // Map API response to frontend Article format
                const mappedArticles: Article[] = allArticles.map((a, index) => {
                    const normalizedSummary = normalizeText(a.summary);
                    const normalizedFullText = normalizeText(a.fullText);
                    const page = typeof a.page === "number" ? a.page : 1;

                    return {
                        id: normalizeId(a.id, editionDate, page, index),
                        date: editionDate,
                        category: normalizeCategory(a.category),
                        headline: normalizeText(a.headline) || (Array.isArray(a.imageUrls) && a.imageUrls.length > 0 && !normalizeText(a.fullText) ? "" : "Untitled Article"),
                        summary: normalizedSummary,
                        fullText: normalizedFullText,
                        imageUrls: Array.isArray(a.imageUrls)
                            ? a.imageUrls.map((u: string) => normalizeText(u)).filter(Boolean)
                            : (a.imageUrl && normalizeText(a.imageUrl) ? [normalizeText(a.imageUrl)] : []),
                        byline: normalizeText(a.byline) || undefined,
                        writerPosition: normalizeText(a.writerPosition) || undefined,
                        imageCaption: normalizeText(a.imageCaption) || undefined,
                        imageCaptions: Array.isArray(a.imageCaptions)
                            ? a.imageCaptions.map((c: string | null) => c ? normalizeText(c) : null)
                            : [],
                        page,
                        isFeatured: Boolean(a.isFeatured),
                        isHero: Boolean(a.isHero),
                    };
                });

                setArticles(mappedArticles);
                setAds(allAds);
                setPublicationInfo(editionPublicationInfo);
            } catch (err) {
                if (err instanceof DOMException && err.name === "AbortError") {
                    return;
                }
                setError(err instanceof Error ? err : new Error("Unknown error"));
            } finally {
                if (!abortController.signal.aborted) {
                    setIsLoading(false);
                }
            }
        }

        fetchArticles();

        return () => {
            abortController.abort();
        };
    }, [date]);

    return { articles, ads, publicationInfo, hasActiveEdition: Boolean(date), isLoading, error };
}
