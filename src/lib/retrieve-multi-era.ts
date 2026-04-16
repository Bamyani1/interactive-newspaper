/**
 * Multi-Era Retrieval
 *
 * Wraps `hybridSearch` with optional per-era fan-out for comparative /
 * temporal-span questions. When the reformulator extracts ≥2 eras, runs
 * parallel date-filtered searches per era and tags each result with its
 * matched era label. Falls back to the existing single-search path for
 * single-era or timeless questions.
 *
 * Also absorbs the hybrid-fails-fall-back-to-vector logic that was
 * previously duplicated inline in route.ts.
 */

import { hybridSearch, queryArticlesByEmbedding } from "@/src/lib/db";
import type { RetrievedArticle } from "@/src/lib/db";
import type { Era } from "@/src/lib/era-parser";

export interface MultiEraArticle extends RetrievedArticle {
    matchedEra?: string;
}

export interface MultiEraResult {
    articles: MultiEraArticle[];
    method: "hybrid" | "vector";
    erasUsed: Era[];
}

export interface RetrieveMultiEraOptions {
    retrievalLimit: number;
    vectorWeight: number;
    category?: string | null;
    filterStartDate?: string | null;
    filterEndDate?: string | null;
    onlyWithImages?: boolean;
    timeoutMs?: number;
    signal?: AbortSignal;
    requestId?: string;
}

function intersectEraWithFilters(
    era: Era,
    filterStart: string | null | undefined,
    filterEnd: string | null | undefined,
): Era | null {
    let start = era.startDate;
    let end = era.endDate;
    if (filterStart && filterStart > start) start = filterStart;
    if (filterEnd && filterEnd < end) end = filterEnd;
    if (start > end) return null;
    return { label: era.label, startDate: start, endDate: end };
}

async function searchWithFallback(
    ftsQuery: string,
    embedding: number[],
    opts: {
        limit: number;
        vectorWeight: number;
        category?: string | null;
        startDate?: string | null;
        endDate?: string | null;
        onlyWithImages?: boolean;
        timeoutMs?: number;
        signal?: AbortSignal;
    },
): Promise<{ articles: RetrievedArticle[]; method: "hybrid" | "vector" }> {
    try {
        const articles = await hybridSearch(ftsQuery, embedding, {
            limit: opts.limit,
            vectorWeight: opts.vectorWeight,
            category: opts.category,
            startDate: opts.startDate,
            endDate: opts.endDate,
            onlyWithImages: opts.onlyWithImages,
            timeoutMs: opts.timeoutMs,
            signal: opts.signal,
        });
        return { articles, method: "hybrid" };
    } catch {
        try {
            const articles = await queryArticlesByEmbedding(embedding, {
                limit: opts.limit,
                category: opts.category,
                startDate: opts.startDate,
                endDate: opts.endDate,
                onlyWithImages: opts.onlyWithImages,
                timeoutMs: opts.timeoutMs,
                signal: opts.signal,
            });
            return { articles, method: "vector" };
        } catch {
            return { articles: [], method: "vector" };
        }
    }
}

export async function retrieveMultiEra(
    ftsQuery: string,
    embedding: number[],
    eras: Era[] | undefined,
    options: RetrieveMultiEraOptions,
): Promise<MultiEraResult> {
    const {
        retrievalLimit,
        vectorWeight,
        category,
        filterStartDate,
        filterEndDate,
        onlyWithImages,
        timeoutMs,
        signal,
    } = options;

    // Single-era path: no eras or fewer than 2 → behave exactly as today.
    if (!eras || eras.length < 2) {
        const { articles, method } = await searchWithFallback(
            ftsQuery, embedding, {
                limit: retrievalLimit,
                vectorWeight,
                category,
                startDate: filterStartDate,
                endDate: filterEndDate,
                onlyWithImages,
                timeoutMs,
                signal,
            },
        );
        return { articles, method, erasUsed: [] };
    }

    // Multi-era path: intersect each era with UI filters, fan out.
    const validEras = eras
        .map((era) => intersectEraWithFilters(era, filterStartDate, filterEndDate))
        .filter((e): e is Era => e !== null);

    if (validEras.length < 2) {
        // After intersection, only 0-1 eras remain → fall back to single path.
        const { articles, method } = await searchWithFallback(
            ftsQuery, embedding, {
                limit: retrievalLimit,
                vectorWeight,
                category,
                startDate: filterStartDate,
                endDate: filterEndDate,
                onlyWithImages,
                timeoutMs,
                signal,
            },
        );
        return { articles, method, erasUsed: [] };
    }

    const perEraLimit = Math.ceil(retrievalLimit / validEras.length);
    let overallMethod: "hybrid" | "vector" = "hybrid";

    const perEraResults = await Promise.all(
        validEras.map(async (era) => {
            const { articles, method } = await searchWithFallback(
                ftsQuery, embedding, {
                    limit: perEraLimit,
                    vectorWeight,
                    category,
                    startDate: era.startDate,
                    endDate: era.endDate,
                    onlyWithImages,
                    timeoutMs,
                    signal,
                },
            );
            if (method === "vector") overallMethod = "vector";
            return articles.map((a) => ({ ...a, matchedEra: era.label }));
        }),
    );

    const merged: MultiEraArticle[] = perEraResults.flat();

    return {
        articles: merged,
        method: overallMethod,
        erasUsed: validEras,
    };
}
