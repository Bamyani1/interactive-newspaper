/**
 * POST /api/ask — "Ask the Archive" RAG endpoint
 *
 * Pipeline: question → embed → hybrid retrieve → LLM generate → response
 *
 * Body: { question: string, filters?: { category?, startDate?, endDate? } }
 */

import { NextRequest, NextResponse } from "next/server";
import { embedQuery, QuotaExhaustedError } from "@/src/lib/embeddings";
import { hybridSearch, queryArticlesByEmbedding } from "@/src/lib/db";
import type { RetrievedArticle } from "@/src/lib/db";
import { generateAnswer, generateAnswerStream } from "@/src/lib/answer-generator";
import { reformulateQuery } from "@/src/lib/query-reformulator";
import { rerankArticles } from "@/src/lib/reranker";
import {
    getConversationHistory,
    addConversationTurn,
    newSessionId,
    formatHistoryForPrompt,
} from "@/src/lib/conversation-store";
import { runAgentLoop } from "@/src/lib/agent-loop";
import type { RankedArticle } from "@/src/lib/reranker";
import type { AskResponse, AskErrorKind, Citation } from "@/src/types";
import { createRateLimiter, getClientIp } from "@/src/lib/rate-limit";
import { getCachedAnswer, setCachedAnswer } from "@/src/lib/answer-cache";
import { checkDailyBudget, DailyBudgetExceededError } from "@/src/lib/cost-tracker";
import {
    DEDUP_TTL_MS,
    dedupKey,
    freshResponseFromCached,
    getOrExtract,
    inFlightAsk,
    type DedupEntry,
    _clearAskDedupForTests,
    _askDedupInternalsForTests,
} from "@/src/lib/ask-dedup";
import {
    computeRerankSignals,
    logRerankSignals,
    _computeRerankSignalsForTests,
} from "@/src/lib/rerank-signals";

export {
    _clearAskDedupForTests,
    _askDedupInternalsForTests,
    _computeRerankSignalsForTests,
};

const MAX_QUESTION_LENGTH = 1000;
const RETRIEVAL_TIMEOUT_MS = 10_000;
const GLOBAL_DEADLINE_MS = 30_000;

const askRateLimiter = createRateLimiter({ bucket: "ask", limit: 10, windowMs: 60_000 });

/**
 * Thrown when the request exceeds the global deadline. The top-level catch
 * converts this to a 504. Distinct from the retrieval-specific timeout
 * which uses a local "Retrieval timeout" marker.
 */
class DeadlineExceededError extends Error {
    constructor(public readonly deadlineMs: number) {
        super(`Global deadline exceeded: ${deadlineMs}ms`);
        this.name = "DeadlineExceededError";
    }
}

/**
 * Wraps an error with the pipeline stage that produced it so the top-level
 * catch can return a structured error response with stage info instead of
 * an opaque 500. Operators can grep logs by requestId/stage to find the
 * culprit.
 */
class StageError extends Error {
    constructor(
        public readonly stage: string,
        public readonly cause: unknown,
    ) {
        super(cause instanceof Error ? cause.message : String(cause));
        this.name = "StageError";
    }
}

function wrapStage<T>(stage: string, fn: () => Promise<T>): Promise<T> {
    return fn().catch((err) => {
        // Don't wrap errors that the route already handles specifically.
        if (
            err instanceof DeadlineExceededError ||
            err instanceof QuotaExhaustedError ||
            err instanceof StageError
        ) {
            throw err;
        }
        throw new StageError(stage, err);
    });
}

/** Generate a short, log-greppable request identifier. */
function newRequestId(): string {
    return Math.random().toString(36).slice(2, 10);
}

const PERSIST_TURN_TIMEOUT_MS = 1500;

/**
 * Await a conversation-turn write but cap total latency so a slow Neon
 * never blocks the user's `done` event. If the timer wins, the write
 * continues in the background — `addConversationTurn` swallows its own
 * errors, so no unhandled rejection. Emitting `done` after this closes
 * the race where a rapid follow-up could arrive before the prior turn
 * landed in history.
 */
async function persistTurnBounded(
    sessionId: string,
    question: string,
    answer: string,
    citedArticleIds: string[],
): Promise<void> {
    await Promise.race([
        addConversationTurn(sessionId, question, answer, citedArticleIds),
        new Promise<void>((resolve) =>
            setTimeout(resolve, PERSIST_TURN_TIMEOUT_MS),
        ),
    ]);
}

/**
 * Build a typed error response body. The `kind` discriminator lets the
 * client render friendly per-kind UI copy (countdown for rate_limit /
 * budget; retry CTA for timeout; requestId for server) without
 * sniffing status codes. `error` is kept as a legacy alias for pre-
 * redesign consumers.
 */
function askErrorJson(params: {
    status: number;
    kind: AskErrorKind;
    message: string;
    retryAfterSec?: number;
    requestId?: string;
    stage?: string;
    cause?: string;
    extraHeaders?: Record<string, string>;
}): NextResponse {
    const body: Record<string, unknown> = {
        kind: params.kind,
        message: params.message,
        error: params.message,
    };
    if (params.retryAfterSec !== undefined) {
        body.retryAfterSec = params.retryAfterSec;
    }
    if (params.requestId) body.requestId = params.requestId;
    if (params.stage) body.stage = params.stage;
    if (params.cause) body.cause = params.cause;

    const headers: Record<string, string> = { ...(params.extraHeaders ?? {}) };
    if (params.retryAfterSec !== undefined) {
        headers["Retry-After"] = String(params.retryAfterSec);
    }

    return NextResponse.json(body, { status: params.status, headers });
}

/**
 * Rerank articles and, if the reranker filtered all of them out, run ONE
 * corrective retry that reformulates the query for broader recall,
 * re-embeds, re-retrieves, and re-ranks with a lower minScore.
 *
 * Both streaming and non-streaming pipelines call this. Each retry stage
 * is wrapped in wrapStage so the top-level catch (non-streaming) and the
 * streaming error-to-SSE mapping can attribute failures to a specific
 * stage ("reformulate-retry", "embed-retry", "retrieve-retry",
 * "rerank-retry") and preserve typed errors (QuotaExhaustedError,
 * DeadlineExceededError) instead of collapsing them into generic 500s.
 */
async function rerankWithCragRetry(params: {
    question: string;
    articles: RetrievedArticle[];
    mode: "text" | "visual";
    keepTopK: number;
    conversationHistory: import("@/src/lib/conversation-store").ConversationTurn[];
    filters: { category?: string; startDate?: string; endDate?: string };
    retrievalLimit: number;
    vectorWeight: number;
    onlyWithImages: boolean;
    retrievalTimeoutMs: number;
    signal: AbortSignal;
    requestId: string;
}): Promise<RankedArticle[]> {
    const minScore = params.mode === "visual" ? 3 : 4;
    let ranked = await wrapStage("rerank", () =>
        rerankArticles(params.question, params.articles, {
            maxArticles: params.keepTopK,
            minScore,
            signal: params.signal,
            requestId: params.requestId,
        }),
    );

    if (
        ranked.length === 0 &&
        params.articles.length > 0 &&
        !params.signal.aborted
    ) {
        console.warn(
            JSON.stringify({
                level: "warn",
                route: "/api/ask",
                requestId: params.requestId,
                stage: "crag-retry",
                msg: "reranker filtered all articles, retrying with broader query",
            }),
        );
        const retry = await wrapStage("reformulate-retry", () =>
            reformulateQuery(`Try broader search terms for: ${params.question}`, {
                signal: params.signal,
                requestId: params.requestId,
                conversationHistory: params.conversationHistory,
            }),
        );
        // embed-retry: QuotaExhaustedError otherwise flows through wrapStage
        // untouched and loses the retry-stage tag. Wrap it (and any other
        // non-deadline error) in StageError so both streaming and
        // non-streaming catches can attribute it to "embed-retry".
        let retryEmbedding: number[];
        try {
            retryEmbedding = await embedQuery(retry.embeddingQuery, {
                signal: params.signal,
            });
        } catch (err) {
            if (err instanceof DeadlineExceededError) throw err;
            throw new StageError("embed-retry", err);
        }
        // retrieve-retry: same pattern. The "Retrieval timeout" Error is
        // a local marker, not a typed class; caller unwraps via StageError.cause.
        let retryArticles: RetrievedArticle[];
        try {
            retryArticles = await Promise.race([
                hybridSearch(retry.ftsQuery, retryEmbedding, {
                    limit: params.retrievalLimit,
                    category: params.filters.category ?? null,
                    startDate: params.filters.startDate ?? null,
                    endDate: params.filters.endDate ?? null,
                    vectorWeight: params.vectorWeight,
                    onlyWithImages: params.onlyWithImages,
                    signal: params.signal,
                }),
                new Promise<never>((_, reject) =>
                    setTimeout(
                        () => reject(new Error("Retrieval timeout")),
                        params.retrievalTimeoutMs,
                    ),
                ),
            ]);
        } catch (err) {
            if (err instanceof DeadlineExceededError) throw err;
            throw new StageError("retrieve-retry", err);
        }
        ranked = await wrapStage("rerank-retry", () =>
            rerankArticles(params.question, retryArticles, {
                maxArticles: params.keepTopK,
                minScore: params.mode === "visual" ? 2 : 3,
                signal: params.signal,
                requestId: params.requestId,
            }),
        );
    }

    return ranked;
}

// Test hook: tests set this to a short value so they can exercise the
// global deadline path without waiting 30 real seconds. Null = default.
let _testDeadlineMsOverride: number | null = null;
export function _setGlobalDeadlineForTests(ms: number | null): void {
    _testDeadlineMsOverride = ms;
}

// Test hook: tests set this to a short value so they can exercise the
// retrieval-timeout path in real wall time. Null = default.
let _testRetrievalTimeoutMsOverride: number | null = null;
export function _setRetrievalTimeoutForTests(ms: number | null): void {
    _testRetrievalTimeoutMsOverride = ms;
}

interface AskRequestBody {
    question: string;
    sessionId?: string;
    filters?: {
        category?: string;
        startDate?: string;
        endDate?: string;
    };
}

// ── Streaming (SSE) handler ──
// When /api/ask is hit with ?stream=1, the route returns a Server-Sent
// Events stream instead of a JSON response. Events are typed:
//   - { type: "stage", name, elapsedMs }       — pipeline step completed
//   - { type: "metadata", question, mode, sourceArticles, meta }
//                                              — emitted after retrieval+rerank
//                                              — so the client can render the
//                                              — citation panel before Gemini
//                                              — streams the answer text
//   - { type: "delta", text }                  — partial answer token(s)
//   - { type: "done", answer, citations, confidence, meta }
//                                              — final event with cleaned answer
//                                              — and full metadata
//   - { type: "error", stage, message, requestId, cause? }
//                                              — any failure; stream then closes
//
// Errors mid-stream cannot change HTTP status (headers already flushed);
// the client differentiates by the "error" event type.
// Concurrent-request dedup does NOT apply to streaming requests because
// the body is a ReadableStream that can't be re-read by multiple waiters.
async function handleStreamingAsk(params: {
    body: AskRequestBody;
    requestId: string;
    totalStart: number;
    deadlineMs: number;
    sessionId: string;
    conversationHistory: import("@/src/lib/conversation-store").ConversationTurn[];
}): Promise<NextResponse> {
    const { body, requestId, totalStart, deadlineMs, sessionId, conversationHistory } = params;
    const question = body.question.trim();
    const filters = body.filters ?? {};

    const globalController = new AbortController();
    const deadlineTimer: ReturnType<typeof setTimeout> = setTimeout(() => {
        globalController.abort();
    }, deadlineMs);

    const encoder = new TextEncoder();
    const sseEncode = (event: object): Uint8Array =>
        encoder.encode(`data: ${JSON.stringify(event)}\n\n`);

    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            let closed = false;
            const send = (event: object): void => {
                if (closed) return;
                try {
                    controller.enqueue(sseEncode(event));
                } catch {
                    // Consumer disconnected mid-write — swallow.
                }
            };

            const stageElapsed = () => Date.now() - totalStart;

            try {
                // ── Step 1: Reformulate ──
                let embeddingQuery: string;
                let ftsQuery: string;
                let mode: "text" | "visual";
                let complexity: "simple" | "complex";
                try {
                    const reformulated = await reformulateQuery(question, {
                        signal: globalController.signal,
                        requestId,
                        conversationHistory,
                    });
                    embeddingQuery = reformulated.embeddingQuery;
                    ftsQuery = reformulated.ftsQuery;
                    mode = reformulated.mode;
                    complexity = reformulated.complexity;
                } catch (err) {
                    console.error(
                        JSON.stringify({
                            level: "error",
                            route: "/api/ask",
                            requestId,
                            stage: "reformulate",
                            msg: "reformulate failed",
                            err: err instanceof Error ? err.message : String(err),
                        }),
                    );
                    send({
                        type: "error",
                        stage: "reformulate",
                        message: "Failed to reformulate question. Please try again.",
                        requestId,
                    });
                    return;
                }
                send({
                    type: "stage",
                    name: "reformulate",
                    elapsedMs: stageElapsed(),
                    detail: embeddingQuery !== question ? embeddingQuery : undefined,
                });

                // ── Agent path for complex questions ──
                if (complexity === "complex") {
                    send({ type: "stage", name: "agent", elapsedMs: stageElapsed() });
                    send({
                        type: "metadata",
                        question,
                        mode,
                        requestId,
                        sourceArticles: [],
                        meta: {
                            reformulatedQuery:
                                embeddingQuery !== question ? embeddingQuery : undefined,
                        },
                    });

                    const conversationContext = conversationHistory.length > 0
                        ? formatHistoryForPrompt(conversationHistory)
                        : undefined;

                    try {
                        const agentResult = await runAgentLoop(question, {
                            signal: globalController.signal,
                            requestId,
                            conversationContext,
                            onProgress: (event) => send(event),
                        });

                        await persistTurnBounded(
                            sessionId,
                            question,
                            agentResult.answer,
                            agentResult.citations.map((c) => c.articleId),
                        );

                        const agentSourceArticles = agentResult.citations.map((c) => {
                            const meta = agentResult.articleMeta.get(c.articleId);
                            return {
                                id: c.articleId,
                                headline: c.headline,
                                editionDate: c.editionDate,
                                category: meta?.category ?? "",
                                summary: meta?.summary ?? "",
                                byline: meta?.byline ?? null,
                                bodySnippet: meta?.bodySnippet ?? "",
                                distance: null,
                                imageUrls: meta?.imageUrls ?? [],
                                imageCaptions: meta?.imageCaptions ?? [],
                            };
                        });

                        const totalTimeMs = Date.now() - totalStart;

                        send({
                            type: "done",
                            answer: agentResult.answer,
                            citations: agentResult.citations,
                            confidence: agentResult.confidence,
                            sessionId,
                            sourceArticles: agentSourceArticles,
                            meta: {
                                retrievalTimeMs: 0,
                                generationTimeMs: 0,
                                totalTimeMs,
                                articlesSearched: agentResult.articleMeta.size,
                                method: "hybrid",
                                reformulatedQuery:
                                    embeddingQuery !== question ? embeddingQuery : undefined,
                                complexity,
                                agentSteps: agentResult.rounds,
                                agentToolCalls: agentResult.toolCallCount,
                            },
                        });
                    } catch (err) {
                        console.error(
                            JSON.stringify({
                                level: "error",
                                route: "/api/ask",
                                requestId,
                                stage: "agent",
                                msg: "agent loop failed (streaming)",
                                err: err instanceof Error ? err.message : String(err),
                            }),
                        );
                        send({
                            type: "error",
                            stage: "agent",
                            message: "An error occurred while researching your question. Please try again.",
                            requestId,
                        });
                    }
                    return;
                }

                // ── Cache check (pipeline path only; skipped when
                // conversation history is in play so we don't serve a
                // prior session's context-flavored answer to a fresh one).
                const cached =
                    conversationHistory.length === 0
                        ? getCachedAnswer(question, filters)
                        : null;
                if (cached) {
                    const cachedSourceArticles = cached.sourceArticles;
                    const cachedMeta = cached.meta;
                    send({
                        type: "metadata",
                        question,
                        mode: cached.mode,
                        requestId,
                        sourceArticles: cachedSourceArticles,
                        meta: {
                            retrievalTimeMs: cachedMeta.retrievalTimeMs,
                            articlesSearched: cachedMeta.articlesSearched,
                            method: cachedMeta.method,
                            reformulatedQuery: cachedMeta.reformulatedQuery,
                        },
                    });
                    send({ type: "delta", text: cached.answer });
                    await persistTurnBounded(
                        sessionId,
                        question,
                        cached.answer,
                        cached.citations.map((c) => c.articleId),
                    );
                    send({
                        type: "done",
                        answer: cached.answer,
                        citations: cached.citations,
                        confidence: cached.confidence,
                        sessionId,
                        sourceArticles: cachedSourceArticles,
                        followUpQuestions: cached.followUpQuestions ?? [],
                        meta: {
                            ...cachedMeta,
                            totalTimeMs: Date.now() - totalStart,
                            cacheHit: true,
                            complexity,
                        },
                    });
                    return;
                }

                // ── Step 2: Embed (pipeline path) ──
                let questionEmbedding: number[];
                try {
                    questionEmbedding = await embedQuery(embeddingQuery, {
                        signal: globalController.signal,
                    });
                } catch (err) {
                    if (err instanceof QuotaExhaustedError) {
                        console.warn(
                            JSON.stringify({
                                level: "warn",
                                route: "/api/ask",
                                requestId,
                                stage: "embed",
                                msg: "quota exhausted (streaming)",
                                err: err instanceof Error ? err.message : String(err),
                            }),
                        );
                        send({
                            type: "error",
                            stage: "embed",
                            cause: "quota_exhausted",
                            message: "Daily AI quota reached. Please try again tomorrow.",
                            requestId,
                        });
                        return;
                    }
                    console.error(
                        JSON.stringify({
                            level: "error",
                            route: "/api/ask",
                            requestId,
                            stage: "embed",
                            msg: "embed failed (streaming)",
                            err: err instanceof Error ? err.message : String(err),
                        }),
                    );
                    send({
                        type: "error",
                        stage: "embed",
                        message: "Failed to process question. Please try again.",
                        requestId,
                    });
                    return;
                }
                send({ type: "stage", name: "embed", elapsedMs: stageElapsed() });

                // ── Step 3: Retrieve ──
                const retrievalTimeoutMs =
                    _testRetrievalTimeoutMsOverride ?? RETRIEVAL_TIMEOUT_MS;
                const retrievalStart = Date.now();
                const retrievalLimit = mode === "visual" ? 30 : 20;
                const vectorWeight = mode === "visual" ? 0.7 : 0.6;
                const onlyWithImages = mode === "visual";

                const retrievalTimeout = new Promise<never>((_, reject) =>
                    setTimeout(
                        () => reject(new Error("Retrieval timeout")),
                        retrievalTimeoutMs,
                    ),
                );

                let articles: RetrievedArticle[];
                let method: "hybrid" | "vector" = "hybrid";

                try {
                    articles = await Promise.race([
                        hybridSearch(ftsQuery, questionEmbedding, {
                            limit: retrievalLimit,
                            category: filters.category ?? null,
                            startDate: filters.startDate ?? null,
                            endDate: filters.endDate ?? null,
                            vectorWeight,
                            onlyWithImages,
                            signal: globalController.signal,
                        }),
                        retrievalTimeout,
                    ]);
                } catch (err) {
                    if (err instanceof Error && err.message === "Retrieval timeout") {
                        send({
                            type: "error",
                            stage: "retrieve",
                            message: "Retrieval took too long. Please try again.",
                            requestId,
                        });
                        return;
                    }
                    console.warn(
                        JSON.stringify({
                            level: "warn",
                            route: "/api/ask",
                            requestId,
                            stage: "retrieve",
                            msg: "hybrid search failed — falling back (streaming)",
                            err: err instanceof Error ? err.message : String(err),
                        }),
                    );
                    method = "vector";
                    const fallbackTimeout = new Promise<never>((_, reject) =>
                        setTimeout(
                            () => reject(new Error("Retrieval timeout")),
                            retrievalTimeoutMs,
                        ),
                    );
                    try {
                        articles = await Promise.race([
                            queryArticlesByEmbedding(questionEmbedding, {
                                limit: retrievalLimit,
                                category: filters.category ?? null,
                                startDate: filters.startDate ?? null,
                                endDate: filters.endDate ?? null,
                                onlyWithImages,
                                signal: globalController.signal,
                            }),
                            fallbackTimeout,
                        ]);
                    } catch (fallbackErr) {
                        send({
                            type: "error",
                            stage: "retrieve",
                            message:
                                fallbackErr instanceof Error &&
                                fallbackErr.message === "Retrieval timeout"
                                    ? "Retrieval took too long. Please try again."
                                    : "Retrieval failed. Please try again.",
                            requestId,
                        });
                        return;
                    }
                }
                const retrievalTimeMs = Date.now() - retrievalStart;
                send({ type: "stage", name: "retrieve", elapsedMs: stageElapsed() });

                // ── Step 4: Rerank ──
                const keepTopK = mode === "visual" ? 15 : 10;
                logRerankSignals(requestId, computeRerankSignals(articles), mode, "streaming");

                let rankedArticles: RankedArticle[];
                try {
                    rankedArticles = await rerankWithCragRetry({
                        question,
                        articles,
                        mode,
                        keepTopK,
                        conversationHistory,
                        filters,
                        retrievalLimit,
                        vectorWeight,
                        onlyWithImages,
                        retrievalTimeoutMs,
                        signal: globalController.signal,
                        requestId,
                    });
                } catch (err) {
                    // Map typed errors back to SSE error events with the
                    // specific stage tag so clients + logs can distinguish
                    // a retry-stage quota-exhausted from a primary rerank
                    // failure. The helper wraps retry-stage typed errors
                    // in StageError with cause=underlying error.
                    const stage =
                        err instanceof StageError ? err.stage : "rerank";
                    const cause =
                        err instanceof StageError ? err.cause : err;
                    const message =
                        cause instanceof QuotaExhaustedError
                            ? "Daily AI quota reached. Please try again later."
                            : cause instanceof DeadlineExceededError
                            ? "Request timed out. Please try again."
                            : cause instanceof Error &&
                              cause.message === "Retrieval timeout"
                            ? "Retrieval took too long. Please try again."
                            : "Reranking failed. Please try again.";
                    console.error(
                        JSON.stringify({
                            level: "error",
                            route: "/api/ask",
                            requestId,
                            stage,
                            msg: "rerank-with-retry failed (streaming)",
                            err:
                                cause instanceof Error
                                    ? cause.message
                                    : String(cause),
                        }),
                    );
                    send({
                        type: "error",
                        stage,
                        message,
                        requestId,
                    });
                    return;
                }
                send({ type: "stage", name: "rerank", elapsedMs: stageElapsed() });

                // Emit metadata BEFORE generation so client can render the
                // citation sidebar immediately, before the answer tokens start
                // streaming in.
                const sourceArticles = rankedArticles.map((a) => ({
                    id: a.id,
                    headline: a.headline,
                    editionDate: a.editionDate,
                    category: a.category,
                    summary: a.summary,
                    byline: a.byline,
                    bodySnippet:
                        (a.bodyPlain || "").slice(0, 300) +
                        ((a.bodyPlain || "").length > 300 ? "\u2026" : ""),
                    distance:
                        a.distance !== null ? parseFloat(a.distance.toFixed(4)) : null,
                    imageUrls: a.imageUrls,
                    imageCaptions: a.imageCaptions,
                }));

                send({
                    type: "metadata",
                    question,
                    mode,
                    requestId,
                    sourceArticles,
                    meta: {
                        retrievalTimeMs,
                        articlesSearched: articles.length,
                        method,
                        reformulatedQuery:
                            embeddingQuery !== question ? embeddingQuery : undefined,
                    },
                });

                // ── Step 5: Generate (streaming) ──
                const generationStart = Date.now();
                let finalAnswer = "";
                let finalCitations: Citation[] = [];
                let finalConfidence: "low" | "medium" | "high" = "low";
                let finalFollowUps: string[] = [];

                try {
                    for await (const event of generateAnswerStream(question, rankedArticles, {
                        signal: globalController.signal,
                        requestId,
                        conversationContext:
                            conversationHistory.length > 0
                                ? formatHistoryForPrompt(conversationHistory)
                                : undefined,
                    })) {
                        if (event.type === "delta") {
                            send({ type: "delta", text: event.text });
                        } else if (event.type === "done") {
                            finalAnswer = event.answer;
                            finalCitations = event.citations;
                            finalConfidence = event.confidence;
                            finalFollowUps = event.followUps;
                        }
                    }
                } catch (err) {
                    console.error(
                        JSON.stringify({
                            level: "error",
                            route: "/api/ask",
                            requestId,
                            stage: "generate",
                            msg: "generate stream failed (streaming)",
                            err: err instanceof Error ? err.message : String(err),
                        }),
                    );
                    send({
                        type: "error",
                        stage: "generate",
                        message: "An error occurred during answer generation. Please try again.",
                        requestId,
                    });
                    return;
                }

                const generationTimeMs = Date.now() - generationStart;
                const totalTimeMs = Date.now() - totalStart;

                await persistTurnBounded(
                    sessionId,
                    question,
                    finalAnswer,
                    finalCitations.map((c) => c.articleId),
                );

                const streamingResponse: AskResponse = {
                    question,
                    answer: finalAnswer,
                    citations: finalCitations,
                    confidence: finalConfidence,
                    mode,
                    requestId,
                    sessionId,
                    sourceArticles,
                    followUpQuestions: finalFollowUps,
                    meta: {
                        retrievalTimeMs,
                        generationTimeMs,
                        totalTimeMs,
                        articlesSearched: articles.length,
                        method,
                        reformulatedQuery:
                            embeddingQuery !== question ? embeddingQuery : undefined,
                        complexity,
                    },
                };

                if (conversationHistory.length === 0) {
                    setCachedAnswer(question, filters, streamingResponse);
                }

                send({
                    type: "done",
                    answer: finalAnswer,
                    citations: finalCitations,
                    confidence: finalConfidence,
                    sessionId,
                    followUpQuestions: finalFollowUps,
                    meta: {
                        retrievalTimeMs,
                        generationTimeMs,
                        totalTimeMs,
                        articlesSearched: articles.length,
                        method,
                        reformulatedQuery:
                            embeddingQuery !== question ? embeddingQuery : undefined,
                        complexity,
                    },
                });
            } catch (err) {
                // Top-level safety net (deadline aborts, unexpected throws)
                const isDeadline = err instanceof DeadlineExceededError;
                const message = isDeadline
                    ? "Request took too long. Please try a simpler question."
                    : "An unexpected error occurred. Please try again.";
                console.error(
                    JSON.stringify({
                        level: "error",
                        route: "/api/ask",
                        requestId,
                        stage: isDeadline ? "deadline" : "unknown",
                        msg: "streaming pipeline unhandled error",
                        err: message,
                    }),
                );
                send({
                    type: "error",
                    stage: isDeadline ? "deadline" : "unknown",
                    message,
                    requestId,
                });
            } finally {
                closed = true;
                clearTimeout(deadlineTimer);
                try {
                    controller.close();
                } catch {
                    // already closed
                }
            }
        },
        cancel() {
            // Client disconnected — abort the pipeline and clean up.
            globalController.abort();
            clearTimeout(deadlineTimer);
        },
    });

    return new NextResponse(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            // Nginx/CDN hint: disable proxy buffering so events arrive in real time.
            "X-Accel-Buffering": "no",
        },
    });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    const totalStart = Date.now();
    const requestId = newRequestId();
    const deadlineMs = _testDeadlineMsOverride ?? GLOBAL_DEADLINE_MS;

    // ── Rate limit (outside the deadline race so a 429 returns instantly) ──
    const ip = getClientIp(request);
    const rateResult = await askRateLimiter(ip);
    if (!rateResult.allowed) {
        return askErrorJson({
            status: 429,
            kind: "rate_limit",
            message: "Too many questions. Please wait a moment and try again.",
            retryAfterSec: Math.ceil((rateResult.resetAt - Date.now()) / 1000),
        });
    }

    // ── Parse + validate body ──
    let body: AskRequestBody;
    try {
        body = (await request.json()) as AskRequestBody;
    } catch {
        return askErrorJson({
            status: 400,
            kind: "bad_request",
            message: "Invalid JSON body",
        });
    }

    if (!body.question || typeof body.question !== "string") {
        return askErrorJson({
            status: 400,
            kind: "bad_request",
            message: "Missing required field: question",
        });
    }
    const question = body.question.trim();
    if (question.length === 0) {
        return askErrorJson({
            status: 400,
            kind: "bad_request",
            message: "Question cannot be empty",
        });
    }
    if (question.length > MAX_QUESTION_LENGTH) {
        return askErrorJson({
            status: 400,
            kind: "bad_request",
            message: `Question too long (${question.length} chars). Maximum is ${MAX_QUESTION_LENGTH}.`,
        });
    }

    // ── Daily budget kill switch ──
    // Fail fast if the project has already burned through today's AI
    // spend ceiling. Covers both streaming and non-streaming paths
    // before any Gemini call is issued.
    try {
        await checkDailyBudget();
    } catch (err) {
        if (err instanceof DailyBudgetExceededError) {
            console.warn(
                JSON.stringify({
                    level: "warn",
                    route: "/api/ask",
                    requestId,
                    stage: "budget",
                    msg: "daily budget exceeded",
                    spentUsd: err.spentUsd,
                    budgetUsd: err.budgetUsd,
                }),
            );
            return askErrorJson({
                status: 429,
                kind: "budget",
                message: "Daily AI budget reached. Please try again tomorrow.",
                retryAfterSec: 3600,
                cause: "daily_budget_reached",
                stage: "budget",
                requestId,
            });
        }
        throw err;
    }

    // ── Session handling ──
    const sessionId = body.sessionId ?? newSessionId();
    const conversationHistory = body.sessionId
        ? await getConversationHistory(body.sessionId)
        : [];

    // ── Streaming branch ──
    // If the client requested ?stream=1, return an SSE stream that emits
    // stage/metadata/delta/done/error events as the pipeline progresses.
    // Dedup + the existing JSON response path are bypassed for streaming
    // because a ReadableStream body can't be re-read by multiple waiters.
    const url = new URL(request.url);
    const isStreaming = url.searchParams.get("stream") === "1";
    if (isStreaming) {
        return handleStreamingAsk({
            body: { question, filters: body.filters },
            requestId,
            totalStart,
            deadlineMs,
            sessionId,
            conversationHistory,
        });
    }

    // ── Concurrent request dedup ──
    // If an identical (ip, question, filters) request is already in
    // flight, piggyback on it instead of running the full pipeline again.
    // Falls through (runs our own) if the in-flight one rejects.
    const dedupId = dedupKey(ip, question, body.filters, sessionId);
    const existingEntry = inFlightAsk.get(dedupId);
    if (existingEntry) {
        try {
            const data = await getOrExtract(existingEntry);
            return freshResponseFromCached(data);
        } catch {
            // Existing pipeline rejected; fall through.
        }
    }

    // Global deadline: guarantees the route returns within `deadlineMs` even
    // if a downstream stage hangs. The AbortController lets signal-aware
    // libs cancel their in-flight fetches; the Promise.race below guarantees
    // return even if those libs ignore the signal.
    const globalController = new AbortController();
    let globalTimer: ReturnType<typeof setTimeout> | undefined;
    const deadlinePromise = new Promise<NextResponse>((_, reject) => {
        globalTimer = setTimeout(() => {
            globalController.abort();
            reject(new DeadlineExceededError(deadlineMs));
        }, deadlineMs);
    });

    const pipelinePromise = (async (): Promise<NextResponse> => {
        // ── Step 1: Reformulate query for better retrieval ──
        const { embeddingQuery, ftsQuery, mode, complexity } = await wrapStage(
            "reformulate",
            () =>
                reformulateQuery(question, {
                    signal: globalController.signal,
                    requestId,
                    conversationHistory,
                }),
        );

        // ── Agent path for complex questions ──
        if (complexity === "complex") {
            const agentStart = Date.now();
            const conversationContext = conversationHistory.length > 0
                ? formatHistoryForPrompt(conversationHistory)
                : undefined;

            const agentResult = await wrapStage("agent", () =>
                runAgentLoop(question, {
                    signal: globalController.signal,
                    requestId,
                    conversationContext,
                }),
            );

            await persistTurnBounded(
                sessionId,
                question,
                agentResult.answer,
                agentResult.citations.map((c) => c.articleId),
            );

            const agentSourceArticles = agentResult.citations.map((c) => {
                const meta = agentResult.articleMeta.get(c.articleId);
                return {
                    id: c.articleId,
                    headline: c.headline,
                    editionDate: c.editionDate,
                    category: meta?.category ?? "",
                    summary: meta?.summary ?? "",
                    byline: meta?.byline ?? null,
                    bodySnippet: meta?.bodySnippet ?? "",
                    distance: null,
                    imageUrls: meta?.imageUrls ?? [],
                    imageCaptions: meta?.imageCaptions ?? [],
                };
            });

            const response: AskResponse = {
                question,
                answer: agentResult.answer,
                citations: agentResult.citations,
                confidence: agentResult.confidence,
                mode,
                requestId,
                sessionId,
                sourceArticles: agentSourceArticles,
                meta: {
                    retrievalTimeMs: 0,
                    generationTimeMs: 0,
                    totalTimeMs: Date.now() - agentStart,
                    articlesSearched: agentResult.articleMeta.size,
                    method: "hybrid",
                    reformulatedQuery: embeddingQuery !== question ? embeddingQuery : undefined,
                    complexity,
                    agentSteps: agentResult.rounds,
                    agentToolCalls: agentResult.toolCallCount,
                },
            };
            return NextResponse.json(response);
        }

        // ── Cache check (pipeline path only; skipped when conversation
        // history is in play to avoid cross-session context pollution).
        const cachedResponse =
            conversationHistory.length === 0
                ? getCachedAnswer(question, body.filters)
                : null;
        if (cachedResponse) {
            const overridden: AskResponse = {
                ...cachedResponse,
                requestId,
                sessionId,
                meta: {
                    ...cachedResponse.meta,
                    totalTimeMs: Date.now() - totalStart,
                    cacheHit: true,
                    complexity,
                },
            };
            await persistTurnBounded(
                sessionId,
                question,
                cachedResponse.answer,
                cachedResponse.citations.map((c) => c.articleId),
            );
            return NextResponse.json(overridden);
        }

        // ── Step 2: Embed the reformulated query (pipeline path) ──
        let questionEmbedding: number[];
        try {
            questionEmbedding = await embedQuery(embeddingQuery, {
                signal: globalController.signal,
            });
        } catch (err) {
            // Quota exhaustion is a distinct, retry-after-tomorrow case;
            // surface as 429 so the client UI can show a useful message
            // instead of an opaque "failed to process question". 0028.
            if (err instanceof QuotaExhaustedError) {
                console.warn(
                    JSON.stringify({
                        level: "warn",
                        route: "/api/ask",
                        requestId,
                        stage: "embed",
                        msg: "quota exhausted",
                        err: err instanceof Error ? err.message : String(err),
                    }),
                );
                return askErrorJson({
                    status: 429,
                    kind: "budget",
                    message: "Daily AI quota reached. Please try again tomorrow.",
                    retryAfterSec: 3600,
                    cause: "quota_exhausted",
                    stage: "embed",
                    requestId,
                });
            }
            console.error(
                JSON.stringify({
                    level: "error",
                    route: "/api/ask",
                    requestId,
                    stage: "embed",
                    msg: "embed failed",
                    err: err instanceof Error ? err.message : String(err),
                }),
            );
            return askErrorJson({
                status: 502,
                kind: "server",
                message: "Failed to process question. Please try again.",
                stage: "embed",
                requestId,
            });
        }

        // ── Step 3: Retrieve relevant articles (with timeout) ──
        const retrievalStart = Date.now();
        const filters = body.filters ?? {};
        let articles: RetrievedArticle[];
        let method: "hybrid" | "vector" = "hybrid";
        // Visual mode retrieves more candidates since we pre-filter to articles
        // with images (smaller pool, need wider net to find relevant photos)
        const retrievalLimit = mode === "visual" ? 30 : 20;

        const retrievalTimeoutMs =
            _testRetrievalTimeoutMsOverride ?? RETRIEVAL_TIMEOUT_MS;
        const retrievalTimeout = new Promise<never>((_, reject) =>
            setTimeout(
                () => reject(new Error("Retrieval timeout")),
                retrievalTimeoutMs,
            ),
        );

        // Adaptive vector/FTS weighting based on query mode:
        // Visual queries (conceptual "show me X") favor vector similarity (0.7)
        // Text queries (factual, often keyword-heavy) get more FTS weight (0.4)
        const vectorWeight = mode === "visual" ? 0.7 : 0.6;
        // Visual mode restricts retrieval to articles with images so the gallery
        // has enough content even after reranking filters out weak matches.
        const onlyWithImages = mode === "visual";

        try {
            articles = await Promise.race([
                hybridSearch(ftsQuery, questionEmbedding, {
                    limit: retrievalLimit,
                    category: filters.category ?? null,
                    startDate: filters.startDate ?? null,
                    endDate: filters.endDate ?? null,
                    vectorWeight,
                    onlyWithImages,
                    signal: globalController.signal,
                }),
                retrievalTimeout,
            ]);
        } catch (err) {
            if (err instanceof Error && err.message === "Retrieval timeout") {
                return askErrorJson({
                    status: 504,
                    kind: "timeout",
                    message: "Retrieval took too long. Please try again.",
                    stage: "retrieve",
                    requestId,
                });
            }
            console.warn(
                JSON.stringify({
                    level: "warn",
                    route: "/api/ask",
                    requestId,
                    stage: "retrieve",
                    msg: "hybrid search failed — falling back to vector-only",
                    err: err instanceof Error ? err.message : String(err),
                }),
            );
            method = "vector";
            const fallbackTimeout = new Promise<never>((_, reject) =>
                setTimeout(
                    () => reject(new Error("Retrieval timeout")),
                    retrievalTimeoutMs,
                ),
            );
            try {
                articles = await Promise.race([
                    queryArticlesByEmbedding(questionEmbedding, {
                        limit: retrievalLimit,
                        category: filters.category ?? null,
                        startDate: filters.startDate ?? null,
                        endDate: filters.endDate ?? null,
                        onlyWithImages,
                        signal: globalController.signal,
                    }),
                    fallbackTimeout,
                ]);
            } catch (fallbackErr) {
                if (fallbackErr instanceof Error && fallbackErr.message === "Retrieval timeout") {
                    return NextResponse.json(
                        {
                            error: "Retrieval took too long. Please try again.",
                            stage: "retrieve",
                            requestId,
                        },
                        { status: 504 },
                    );
                }
                // Re-throw with stage tag so the outer catch reports it correctly
                throw new StageError("retrieve", fallbackErr);
            }
        }
        const retrievalTimeMs = Date.now() - retrievalStart;

        // ── Step 4: Re-rank articles by relevance ──
        // Visual mode uses a lower threshold (3 = tangentially related) because
        // the user's goal is seeing photos, not precise answers — "somewhat related"
        // photos are still valuable. Text mode stays strict at 5.
        const keepTopK = mode === "visual" ? 15 : 10;
        logRerankSignals(requestId, computeRerankSignals(articles), mode, "default");

        const rankedArticles = await rerankWithCragRetry({
            question,
            articles,
            mode,
            keepTopK,
            conversationHistory,
            filters,
            retrievalLimit,
            vectorWeight,
            onlyWithImages,
            retrievalTimeoutMs,
            signal: globalController.signal,
            requestId,
        });

        // ── Step 5: Generate answer (using ORIGINAL question, not reformulated) ──
        const generationStart = Date.now();
        const { answer, citations, confidence, followUps } = await wrapStage(
            "generate",
            () =>
                generateAnswer(question, rankedArticles, {
                    signal: globalController.signal,
                    requestId,
                    conversationContext:
                        conversationHistory.length > 0
                            ? formatHistoryForPrompt(conversationHistory)
                            : undefined,
                }),
        );
        const generationTimeMs = Date.now() - generationStart;

        // ── Store conversation turn ──
        await persistTurnBounded(
            sessionId,
            question,
            answer,
            citations.map((c) => c.articleId),
        );

        // ── Build response ──
        const response: AskResponse = {
            question,
            answer,
            citations,
            confidence,
            mode,
            requestId,
            sessionId,
            sourceArticles: rankedArticles.map((a) => ({
                id: a.id,
                headline: a.headline,
                editionDate: a.editionDate,
                category: a.category,
                summary: a.summary,
                byline: a.byline,
                bodySnippet: (a.bodyPlain || "").slice(0, 300) + ((a.bodyPlain || "").length > 300 ? "…" : ""),
                distance: a.distance !== null ? parseFloat(a.distance.toFixed(4)) : null,
                imageUrls: a.imageUrls,
                imageCaptions: a.imageCaptions,
            })),
            followUpQuestions: followUps,
            meta: {
                retrievalTimeMs,
                generationTimeMs,
                totalTimeMs: Date.now() - totalStart,
                articlesSearched: articles.length,
                method,
                reformulatedQuery: embeddingQuery !== question ? embeddingQuery : undefined,
                complexity,
            },
        };

        if (conversationHistory.length === 0) {
            setCachedAnswer(question, filters, response);
        }

        return NextResponse.json(response);
    })();

    // Register the in-flight pipeline promise in the dedup map BEFORE the
    // race so concurrent duplicate requests that arrive after this point
    // can find it. The entry stores the racing promise so dedup hits get
    // the same deadline behavior as the original.
    const racePromise = Promise.race([pipelinePromise, deadlinePromise]);
    const dedupEntry: DedupEntry = { promise: racePromise };
    inFlightAsk.set(dedupId, dedupEntry);

    try {
        return await racePromise;
    } catch (err) {
        if (err instanceof DeadlineExceededError) {
            return askErrorJson({
                status: 504,
                kind: "timeout",
                message: "Request took too long. Please try a simpler question.",
                stage: "deadline",
                requestId,
            });
        }
        if (err instanceof StageError) {
            // Unwrap the cause so retry-stage typed errors (QuotaExhaustedError
            // or the "Retrieval timeout" marker) map to 429/504 instead of
            // the generic 500. This mirrors the inline handling at the
            // primary embed/retrieve stages.
            if (err.cause instanceof QuotaExhaustedError) {
                console.warn(
                    JSON.stringify({
                        level: "warn",
                        route: "/api/ask",
                        requestId,
                        stage: err.stage,
                        msg: "quota exhausted",
                        err: err.cause.message,
                    }),
                );
                return askErrorJson({
                    status: 429,
                    kind: "budget",
                    message: "Daily AI quota reached. Please try again tomorrow.",
                    retryAfterSec: 3600,
                    cause: "quota_exhausted",
                    stage: err.stage,
                    requestId,
                });
            }
            if (
                err.cause instanceof Error &&
                err.cause.message === "Retrieval timeout"
            ) {
                console.warn(
                    JSON.stringify({
                        level: "warn",
                        route: "/api/ask",
                        requestId,
                        stage: err.stage,
                        msg: "retrieval timeout",
                    }),
                );
                return askErrorJson({
                    status: 504,
                    kind: "timeout",
                    message: "Retrieval took too long. Please try again.",
                    stage: err.stage,
                    requestId,
                });
            }
            console.error(
                JSON.stringify({
                    level: "error",
                    route: "/api/ask",
                    requestId,
                    stage: err.stage,
                    msg: "stage error",
                    err:
                        err.cause instanceof Error
                            ? err.cause.message
                            : String(err.cause),
                }),
            );
            return askErrorJson({
                status: 500,
                kind: "server",
                message: "An unexpected error occurred. Please try again.",
                stage: err.stage,
                requestId,
            });
        }
        console.error(
            JSON.stringify({
                level: "error",
                route: "/api/ask",
                requestId,
                stage: "unknown",
                msg: "unhandled error",
                err: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined,
            }),
        );
        return askErrorJson({
            status: 500,
            kind: "server",
            message: "An unexpected error occurred. Please try again.",
            requestId,
        });
    } finally {
        if (globalTimer) clearTimeout(globalTimer);
        // Auto-evict after TTL so a long-completed entry doesn't pin
        // memory. We don't delete immediately because slow concurrent
        // dups still need a window to read the cached body.
        setTimeout(() => {
            if (inFlightAsk.get(dedupId) === dedupEntry) {
                inFlightAsk.delete(dedupId);
            }
        }, DEDUP_TTL_MS);
    }
}
