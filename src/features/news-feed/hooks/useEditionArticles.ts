"use client";

import { useState, useEffect } from "react";
import type { Article } from "../data/mockData";

interface EditionResponse {
    edition: {
        id: string;
        date: string;
        pageCount: number;
    };
    articles: Article[];
}

interface UseEditionArticlesResult {
    articles: Article[];
    isLoading: boolean;
    error: Error | null;
}

export function useEditionArticles(date: string): UseEditionArticlesResult {
    const [articles, setArticles] = useState<Article[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function fetchArticles() {
            setIsLoading(true);
            setError(null);

            try {
                const res = await fetch(`/api/editions/${date}`);

                if (!res.ok) {
                    if (res.status === 404) {
                        // No articles for this date
                        setArticles([]);
                        return;
                    }
                    throw new Error(`Failed to fetch edition: ${res.status}`);
                }

                const data: EditionResponse = await res.json();

                if (!cancelled) {
                    // Map API response to frontend Article format
                    const mappedArticles: Article[] = data.articles.map((a) => ({
                        id: a.id,
                        date: data.edition.date,
                        category: a.category as Article["category"],
                        headline: a.headline,
                        summary: a.summary || "",
                        fullText: a.fullText,
                        imageUrl: a.imageUrl || undefined,
                        author: undefined,
                        byline: a.byline || undefined,
                        imageCaption: a.imageCaption || undefined,
                        page: a.page,
                        isFeatured: a.isFeatured,
                        isHero: a.isHero,
                    }));

                    setArticles(mappedArticles);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err : new Error("Unknown error"));
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        }

        fetchArticles();

        return () => {
            cancelled = true;
        };
    }, [date]);

    return { articles, isLoading, error };
}
