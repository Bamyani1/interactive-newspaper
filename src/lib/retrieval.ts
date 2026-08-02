import {
    fuseArticleResults,
    queryArticlesByEmbedding,
    searchArticlesForRag,
} from "@/src/lib/db";
import type { RetrievedArticle } from "@/src/lib/db";
import type { RetrievalMethod } from "@/src/lib/db";
import { embedQuery } from "@/src/lib/embeddings";
import { reformulateQuery } from "@/src/lib/query-reformulator";
import type {
    ConversationTurn,
} from "@/src/lib/conversation-store";
import { rerankArticles } from "@/src/lib/reranker";
import type { RankedArticle } from "@/src/lib/reranker";
import { getRagRetrievalConfig } from "@/src/lib/rag-index-config";

export interface RetrievalFilters {
    category?: string;
    startDate?: string;
    endDate?: string;
}

export interface CandidateRetrievalResult {
    articles: RetrievedArticle[];
    method: RetrievalMethod;
    retrievalTimeMs: number;
    rawFts: RetrievedArticle[];
    rawVector: RetrievedArticle[];
    signals: {
        fts: { status: "success" | "failed"; count: number; error?: string };
        vector: { status: "success" | "failed"; count: number; error?: string };
    };
    identity: ReturnType<typeof getRagRetrievalConfig>;
    servedTarget: "legacy" | "versioned";
    shadow?: {
        articles: RetrievedArticle[];
        method: RetrievalMethod | "none";
        signals: CandidateRetrievalResult["signals"];
    };
}

export class RetrievalSignalsUnavailableError extends Error {
    constructor(
        public readonly ftsError: unknown,
        public readonly vectorError: unknown,
    ) {
        super("Both full-text and vector retrieval signals failed.");
        this.name = "RetrievalSignalsUnavailableError";
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

type ArticleOutcome = PromiseSettledResult<RetrievedArticle[]>;

function combineSignalOutcomes(
    ftsOutcome: ArticleOutcome,
    vectorOutcome: ArticleOutcome,
    params: { limit: number; vectorWeight: number },
): {
    articles: RetrievedArticle[];
    method: RetrievalMethod | "none";
    rawFts: RetrievedArticle[];
    rawVector: RetrievedArticle[];
    signals: CandidateRetrievalResult["signals"];
} {
    const rawFts = ftsOutcome.status === "fulfilled" ? ftsOutcome.value : [];
    const rawVector =
        vectorOutcome.status === "fulfilled" ? vectorOutcome.value : [];
    const bothSucceeded =
        ftsOutcome.status === "fulfilled" && vectorOutcome.status === "fulfilled";
    const articles = bothSucceeded
        ? fuseArticleResults(rawVector, rawFts, params)
        : (ftsOutcome.status === "fulfilled" ? rawFts : rawVector).slice(
              0,
              params.limit,
          );
    const method: RetrievalMethod | "none" = bothSucceeded
        ? rawVector.length > 0 && rawFts.length > 0
            ? "hybrid"
            : rawVector.length > 0
              ? "vector"
              : rawFts.length > 0
                ? "fts"
                : "hybrid"
        : ftsOutcome.status === "fulfilled"
          ? "fts"
          : vectorOutcome.status === "fulfilled"
            ? "vector"
            : "none";
    return {
        articles,
        method,
        rawFts,
        rawVector,
        signals: {
            fts:
                ftsOutcome.status === "fulfilled"
                    ? { status: "success", count: rawFts.length }
                    : {
                          status: "failed",
                          count: 0,
                          error: errorMessage(ftsOutcome.reason),
                      },
            vector:
                vectorOutcome.status === "fulfilled"
                    ? { status: "success", count: rawVector.length }
                    : {
                          status: "failed",
                          count: 0,
                          error: errorMessage(vectorOutcome.reason),
                      },
        },
    };
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
    const identity = getRagRetrievalConfig();
    const servedTarget =
        identity.mode === "versioned" ? "versioned" : "legacy";
    const searchOptions = {
        limit: params.limit,
        category: params.filters?.category ?? null,
        startDate: params.filters?.startDate ?? null,
        endDate: params.filters?.endDate ?? null,
        onlyWithImages: params.onlyWithImages,
        timeoutMs: params.timeoutMs,
        signal: params.signal,
    };

    const embeddingPromise = embedQuery(params.embeddingQuery, {
        signal: params.signal,
        requestId: params.requestId,
    });
    const servedFtsPromise = searchArticlesForRag(params.ftsQuery, {
        ...searchOptions,
        category: searchOptions.category ?? undefined,
        startDate: searchOptions.startDate ?? undefined,
        endDate: searchOptions.endDate ?? undefined,
        retrievalTarget: servedTarget,
    });
    const servedVectorPromise = embeddingPromise.then((embedding) =>
        queryArticlesByEmbedding(embedding, {
            ...searchOptions,
            retrievalTarget: servedTarget,
        }),
    );
    const shadowPromises =
        identity.mode === "shadow"
            ? [
                  searchArticlesForRag(params.ftsQuery, {
                      ...searchOptions,
                      category: searchOptions.category ?? undefined,
                      startDate: searchOptions.startDate ?? undefined,
                      endDate: searchOptions.endDate ?? undefined,
                      retrievalTarget: "versioned",
                  }),
                  embeddingPromise.then((embedding) =>
                      queryArticlesByEmbedding(embedding, {
                          ...searchOptions,
                          retrievalTarget: "versioned",
                      }),
                  ),
              ]
            : null;
    const shadowOutcomesPromise = shadowPromises
        ? Promise.allSettled(shadowPromises)
        : Promise.resolve(null);

    // Start lexical retrieval immediately. Query embedding and vector SQL form
    // a separate branch, so an embedding/API failure can never prevent FTS.
    const [ftsOutcome, vectorOutcome] = await Promise.allSettled([
        servedFtsPromise,
        servedVectorPromise,
    ]);
    const combined = combineSignalOutcomes(ftsOutcome, vectorOutcome, {
        limit: params.limit,
        vectorWeight: params.vectorWeight,
    });
    if (ftsOutcome.status === "rejected") {
        console.warn(
            JSON.stringify({
                level: "warn",
                route: "/api/ask",
                requestId: params.requestId,
                stage: "retrieve",
                signal: "fts",
                msg: "full-text retrieval failed; continuing with vector signal",
                err: errorMessage(ftsOutcome.reason),
            }),
        );
    }
    if (vectorOutcome.status === "rejected") {
        console.warn(
            JSON.stringify({
                level: "warn",
                route: "/api/ask",
                requestId: params.requestId,
                stage: "retrieve",
                signal: "vector",
                msg: "embedding/vector retrieval failed; continuing with full-text signal",
                err: errorMessage(vectorOutcome.reason),
            }),
        );
    }
    if (ftsOutcome.status === "rejected" && vectorOutcome.status === "rejected") {
        await shadowOutcomesPromise;
        throw new RetrievalSignalsUnavailableError(
            ftsOutcome.reason,
            vectorOutcome.reason,
        );
    }

    const shadowOutcomes = await shadowOutcomesPromise;
    const shadow = shadowOutcomes
        ? combineSignalOutcomes(shadowOutcomes[0], shadowOutcomes[1], {
              limit: params.limit,
              vectorWeight: params.vectorWeight,
          })
        : null;

    // eslint-disable-next-line no-console -- structured retrieval telemetry
    console.info(
        JSON.stringify({
            level: "info",
            route: "/api/ask",
            requestId: params.requestId,
            stage: "retrieve",
            msg: "retrieval completed",
            corpusVersion: identity.corpusVersion,
            indexBuildId: identity.activeIndexBuildId,
            pipelineVersion: identity.pipelineVersion,
            embeddingModel: identity.embeddingModel,
            textEmbeddingInputVersion: identity.textEmbeddingInputVersion,
            servedTarget,
            method: combined.method,
            ftsCandidates: combined.rawFts.length,
            vectorCandidates: combined.rawVector.length,
            fusedCandidates: combined.articles.length,
            deduplicatedCandidates: Math.max(
                0,
                combined.rawFts.length +
                    combined.rawVector.length -
                    combined.articles.length,
            ),
            shadowMethod: shadow?.method,
            shadowFtsCandidates: shadow?.rawFts.length,
            shadowVectorCandidates: shadow?.rawVector.length,
            shadowCandidates: shadow?.articles.length,
            shadowErrors: shadow
                ? [shadow.signals.fts.error, shadow.signals.vector.error].filter(
                      Boolean,
                  )
                : undefined,
        }),
    );

    return {
        articles: combined.articles,
        method: combined.method === "none" ? "hybrid" : combined.method,
        retrievalTimeMs: Date.now() - started,
        rawFts: combined.rawFts,
        rawVector: combined.rawVector,
        signals: combined.signals,
        identity,
        servedTarget,
        shadow: shadow
            ? {
                  articles: shadow.articles,
                  method: shadow.method,
                  signals: shadow.signals,
              }
            : undefined,
    };
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
    method: RetrievalMethod;
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
