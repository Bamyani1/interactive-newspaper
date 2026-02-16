"use client";

import { useState, useEffect } from "react";
import type { Article, VintageAd } from "@/src/types";

interface EditionResponse {
    edition: {
        id: string;
        date: string;
        pageCount: number;
    };
    articles: Article[];
    ads?: VintageAd[];
    pagination?: {
        nextCursor: string | null;
        hasMore: boolean;
    };
}

interface UseEditionArticlesResult {
    articles: Article[];
    ads: VintageAd[];
    hasActiveEdition: boolean;
    isLoading: boolean;
    error: Error | null;
}

const CATEGORY_LOOKUP: Record<string, Article["category"]> = {
    news: "News",
    sports: "Sports",
    features: "Features",
    opinion: "Opinion",
    arts: "Arts",
    "campus life": "Campus Life",
    "campus-life": "Campus Life",
};

const normalizeText = (value: unknown): string =>
    typeof value === "string" ? value : "";

const normalizeCategory = (value: unknown): Article["category"] => {
    if (typeof value !== "string") return "News";
    return CATEGORY_LOOKUP[value.trim().toLowerCase()] ?? "News";
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
    const [isLoading, setIsLoading] = useState(Boolean(date));
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        const abortController = new AbortController();

        async function fetchArticles() {
            if (!date) {
                setArticles([]);
                setAds([]);
                setError(null);
                setIsLoading(false);
                return;
            }

            setIsLoading(true);
            setError(null);

            try {
                const allArticles: Article[] = [];
                const allAds: VintageAd[] = [];
                const seenCursors = new Set<string>();
                let cursor: string | null = null;
                let editionDate = date;
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
                        headline: normalizeText(a.headline) || "Untitled Article",
                        summary: normalizedSummary,
                        fullText: normalizedFullText,
                        imageUrls: Array.isArray((a as any).imageUrls)
                            ? (a as any).imageUrls.map((u: string) => normalizeText(u)).filter(Boolean)
                            : (normalizeText((a as any).imageUrl) ? [normalizeText((a as any).imageUrl)] : []),
                        byline: normalizeText(a.byline) || undefined,
                        imageCaption: normalizeText(a.imageCaption) || undefined,
                        page,
                        isFeatured: Boolean(a.isFeatured),
                        isHero: Boolean(a.isHero),
                    };
                });

                setArticles(mappedArticles);
                setAds(allAds);
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

    return { articles, ads, hasActiveEdition: Boolean(date), isLoading, error };
}
