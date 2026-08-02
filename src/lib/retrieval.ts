import { DbTimeoutError, hybridSearch, queryArticlesByEmbedding } from "@/src/lib/db";
import type { RetrievedArticle } from "@/src/lib/db";
import { embedQuery } from "@/src/lib/embeddings";
import { reformulateQuery } from "@/src/lib/query-reformulator";
import type {
    ConversationTurn,
} from "@/src/lib/conversation-store";
import { rerankArticles } from "@/src/lib/reranker";
import type { RankedArticle } from "@/src/lib/reranker";

export interface RetrievalFilters {
    category?: string;
    startDate?: string;
    endDate?: string;
}

export interface CandidateRetrievalResult {
    articles: RetrievedArticle[];
    method: "hybrid" | "vector";
    retrievalTimeMs: number;
}

export async function retrieveCandidates(params: {
    embeddingQuery: string;
    ftsQuery: string;
    filters?: RetrievalFilters;
    limit: number;
    vectorWeight: number;
    onlyWithImages: boolean;
    timeoutMs?: number;
    signal?: AbortSignal;
    requestId?: string;
}): Promise<CandidateRetrievalResult> {
    const started = Date.now();
    const embedding = await embedQuery(params.embeddingQuery, {
        signal: params.signal,
        requestId: params.requestId,
    });
    const searchOptions = {
        limit: params.limit,
        category: params.filters?.category ?? null,
        startDate: params.filters?.startDate ?? null,
        endDate: params.filters?.endDate ?? null,
        onlyWithImages: params.onlyWithImages,
        timeoutMs: params.timeoutMs,
        signal: params.signal,
    };

    try {
        const articles = await hybridSearch(params.ftsQuery, embedding, {
            ...searchOptions,
            vectorWeight: params.vectorWeight,
        });
        return {
            articles,
            method: "hybrid",
            retrievalTimeMs: Date.now() - started,
        };
    } catch (error) {
        // A timeout/abort is not evidence that vector-only search is healthy;
        // starting a second query would duplicate work under the same deadline.
        if (error instanceof DbTimeoutError || params.signal?.aborted) throw error;
        console.warn(
            JSON.stringify({
                level: "warn",
                route: "/api/ask",
                requestId: params.requestId,
                stage: "retrieve",
                msg: "hybrid search failed; using vector-only fallback",
                err: error instanceof Error ? error.message : String(error),
            }),
        );
        const articles = await queryArticlesByEmbedding(embedding, searchOptions);
        return {
            articles,
            method: "vector",
            retrievalTimeMs: Date.now() - started,
        };
    }
}

export async function rerankWithCorrectiveRetry(params: {
    question: string;
    articles: RetrievedArticle[];
    mode: "text" | "visual";
    maxArticles: number;
    conversationHistory?: ConversationTurn[];
    filters?: RetrievalFilters;
    retrievalLimit: number;
    vectorWeight: number;
    onlyWithImages: boolean;
    timeoutMs?: number;
    signal?: AbortSignal;
    requestId?: string;
}): Promise<RankedArticle[]> {
    let ranked = await rerankArticles(params.question, params.articles, {
        maxArticles: params.maxArticles,
        minScore: params.mode === "visual" ? 3 : 4,
        mode: params.mode,
        signal: params.signal,
        requestId: params.requestId,
    });
    if (ranked.length > 0 || params.articles.length === 0 || params.signal?.aborted) {
        return ranked;
    }

    console.warn(
        JSON.stringify({
            level: "warn",
            route: "/api/ask",
            requestId: params.requestId,
            stage: "crag-retry",
            msg: "reranker rejected all candidates; trying one broader retrieval",
        }),
    );
    const broader = await reformulateQuery(
        `Try broader search terms for: ${params.question}`,
        {
            signal: params.signal,
            requestId: params.requestId,
            conversationHistory: params.conversationHistory,
        },
    );
    const retry = await retrieveCandidates({
        embeddingQuery: broader.embeddingQuery,
        ftsQuery: broader.ftsQuery,
        filters: params.filters,
        limit: params.retrievalLimit,
        vectorWeight: params.vectorWeight,
        onlyWithImages: params.onlyWithImages,
        timeoutMs: params.timeoutMs,
        signal: params.signal,
        requestId: params.requestId,
    });
    ranked = await rerankArticles(params.question, retry.articles, {
        maxArticles: params.maxArticles,
        minScore: params.mode === "visual" ? 2 : 3,
        mode: params.mode,
        signal: params.signal,
        requestId: params.requestId,
    });
    return ranked;
}

/** Canonical search service used by agent tools and route-level retrieval. */
export async function searchAndRankArchive(params: {
    question: string;
    filters?: RetrievalFilters;
    maxArticles?: number;
    signal?: AbortSignal;
    requestId?: string;
    conversationHistory?: ConversationTurn[];
}): Promise<{
    articles: RankedArticle[];
    candidates: number;
    method: "hybrid" | "vector";
    mode: "text" | "visual";
    retrievalTimeMs: number;
}> {
    const reformulated = await reformulateQuery(params.question, {
        signal: params.signal,
        requestId: params.requestId,
        conversationHistory: params.conversationHistory,
    });
    const hasExplicitDates = Boolean(
        params.filters?.startDate || params.filters?.endDate,
    );
    const filters: RetrievalFilters = {
        ...params.filters,
        startDate: hasExplicitDates
            ? params.filters?.startDate
            : reformulated.startDate,
        endDate: hasExplicitDates
            ? params.filters?.endDate
            : reformulated.endDate,
    };
    const visual = reformulated.mode === "visual";
    const maxArticles = Math.max(1, Math.min(params.maxArticles ?? 10, 20));
    const retrieval = await retrieveCandidates({
        embeddingQuery: reformulated.embeddingQuery,
        ftsQuery: reformulated.ftsQuery,
        filters,
        limit: visual ? Math.max(maxArticles * 2, 20) : Math.max(maxArticles * 2, 20),
        vectorWeight: visual ? 0.7 : 0.6,
        onlyWithImages: visual,
        signal: params.signal,
        requestId: params.requestId,
    });
    const articles = await rerankWithCorrectiveRetry({
        question: params.question,
        articles: retrieval.articles,
        mode: reformulated.mode,
        maxArticles,
        conversationHistory: params.conversationHistory,
        filters,
        retrievalLimit: visual ? 30 : 20,
        vectorWeight: visual ? 0.7 : 0.6,
        onlyWithImages: visual,
        signal: params.signal,
        requestId: params.requestId,
    });
    return {
        articles,
        candidates: retrieval.articles.length,
        method: retrieval.method,
        mode: reformulated.mode,
        retrievalTimeMs: retrieval.retrievalTimeMs,
    };
}
