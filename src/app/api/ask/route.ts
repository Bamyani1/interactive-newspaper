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
import type { RankedArticle } from "@/src/lib/reranker";
import type { AskResponse, Citation } from "@/src/types";
import { createRateLimiter, getClientIp } from "@/src/lib/rate-limit";

const MAX_QUESTION_LENGTH = 1000;
const RETRIEVAL_TIMEOUT_MS = 10_000;
const GLOBAL_DEADLINE_MS = 30_000;

const askRateLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

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

// ── Concurrent request dedup (Step 10) ──
// Coalesces two identical (ip, question, filters) POSTs that overlap in
// time so the second one piggybacks on the first instead of running the
// full pipeline twice. embedQuery already has its own LRU cache; this
// adds dedup for reformulator + rerank + answer-gen which don't.

const DEDUP_TTL_MS = 30_000;

interface DedupExtracted {
    body: unknown;
    status: number;
    headers: Record<string, string>;
}

interface DedupEntry {
    promise: Promise<NextResponse>;
    // The extraction is cached as a PROMISE rather than a settled value so
    // all concurrent waiters share a single response.clone().json() call.
    // Caching only the result (old impl) had a race window between the
    // second check and the cache write where two waiters could both call
    // response.clone() in parallel — fragile across runtimes.
    extractPromise?: Promise<DedupExtracted>;
}

const inFlightAsk = new Map<string, DedupEntry>();

function dedupKey(ip: string, question: string, filters: unknown): string {
    // Simple non-cryptographic fingerprint; collisions don't matter because
    // they're scoped to the same IP and would only cause a missed dedup, not
    // wrong data.
    let h = 0;
    const s = `${question}|${JSON.stringify(filters ?? {})}`;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return `${ip}:${h}`;
}

async function getOrExtract(entry: DedupEntry): Promise<DedupExtracted> {
    if (!entry.extractPromise) {
        entry.extractPromise = (async () => {
            const response = await entry.promise;
            const body = await response.clone().json();
            const headers: Record<string, string> = {};
            response.headers.forEach((value, key) => {
                headers[key] = value;
            });
            return { body, status: response.status, headers };
        })();
    }
    return entry.extractPromise;
}

function freshResponseFromCached(data: DedupExtracted): NextResponse {
    return NextResponse.json(data.body, {
        status: data.status,
        headers: data.headers,
    });
}

// Test hook: clears the in-flight dedup map between tests so prior runs
// don't leak into new ones.
export function _clearAskDedupForTests(): void {
    inFlightAsk.clear();
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

// Test hook: exposes the dedup extract internals so unit tests can
// directly verify getOrExtract's exactly-once extraction guarantee with
// a mock response. Kept out of the public route surface via the `_`
// prefix convention.
export const _askDedupInternalsForTests = {
    getOrExtract,
    makeEntry: (response: NextResponse): DedupEntry => ({
        promise: Promise.resolve(response),
    }),
};

/**
 * Retrieval-shape signals, computed once from the hybrid-search result
 * set and emitted on every /api/ask request via `logRerankSignals`. These
 * signals used to gate a reranker-bypass optimization that never fired in
 * practice (see the "Delete rerank bypass, keep telemetry" investigation
 * — all 11 golden cases had avgVectorDist > 0.20, and no clean threshold
 * separated legitimate good retrieval from prompt-injection payloads).
 *
 * Today they exist purely as production observability: operators can
 * grep stderr for `stage: "retrieval-signals"` to see retrieval quality
 * over time, and any future optimization built on top of these numbers
 * can be designed from real multi-run data rather than n=1 theory.
 */
interface RerankSignals {
    avgVectorDist: number | null;
    vectorCount: number;
    bothCount: number;
    ftsOnlyCount: number;
    vectorOnlyCount: number;
    topThreeBothCount: number;
    totalArticles: number;
}

function computeRerankSignals(articles: RetrievedArticle[]): RerankSignals {
    const vectorArticles = articles.filter((a) => a.distance !== null);
    const avgVectorDist =
        vectorArticles.length > 0
            ? vectorArticles.reduce((sum, a) => sum + (a.distance ?? 0), 0) /
              vectorArticles.length
            : null;
    const bothCount = articles.filter((a) => a.source === "both").length;
    const ftsOnlyCount = articles.filter((a) => a.source === "fts").length;
    const vectorOnlyCount = articles.filter((a) => a.source === "vector").length;
    const topThreeBothCount = articles
        .slice(0, 3)
        .filter((a) => a.source === "both").length;

    return {
        avgVectorDist,
        vectorCount: vectorArticles.length,
        bothCount,
        ftsOnlyCount,
        vectorOnlyCount,
        topThreeBothCount,
        totalArticles: articles.length,
    };
}

/**
 * Emit retrieval-signals telemetry for an /api/ask request. Writes at
 * warn level because the project's eslint `no-console` rule restricts to
 * {error, warn}; this is semantically info-level.
 */
function logRerankSignals(
    requestId: string,
    signals: RerankSignals,
    mode: "text" | "visual",
    pathTag: "streaming" | "default",
): void {
    console.warn(
        JSON.stringify({
            level: "info",
            route: "/api/ask",
            requestId,
            stage: "retrieval-signals",
            msg: `retrieval signals (${pathTag})`,
            avgVectorDist:
                signals.avgVectorDist !== null
                    ? Number(signals.avgVectorDist.toFixed(4))
                    : null,
            vectorCount: signals.vectorCount,
            bothCount: signals.bothCount,
            ftsOnlyCount: signals.ftsOnlyCount,
            vectorOnlyCount: signals.vectorOnlyCount,
            topThreeBothCount: signals.topThreeBothCount,
            totalArticles: signals.totalArticles,
            mode,
        }),
    );
}

// Test hook: exposes the signals helper so unit tests can assert the
// telemetry shape directly without standing up a full route-level fetch.
export const _computeRerankSignalsForTests = computeRerankSignals;

interface AskRequestBody {
    question: string;
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
}): Promise<NextResponse> {
    const { body, requestId, totalStart, deadlineMs } = params;
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
                try {
                    const reformulated = await reformulateQuery(question, {
                        signal: globalController.signal,
                    });
                    embeddingQuery = reformulated.embeddingQuery;
                    ftsQuery = reformulated.ftsQuery;
                    mode = reformulated.mode;
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
                send({ type: "stage", name: "reformulate", elapsedMs: stageElapsed() });

                // ── Step 2: Embed ──
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
                const retrievalLimit = mode === "visual" ? 30 : 8;
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
                const keepTopK = mode === "visual" ? 15 : 5;
                logRerankSignals(requestId, computeRerankSignals(articles), mode, "streaming");

                let rankedArticles: RankedArticle[];
                try {
                    rankedArticles = await rerankArticles(question, articles, {
                        maxArticles: keepTopK,
                        minScore: mode === "visual" ? 3 : 5,
                        signal: globalController.signal,
                    });
                } catch (err) {
                    console.error(
                        JSON.stringify({
                            level: "error",
                            route: "/api/ask",
                            requestId,
                            stage: "rerank",
                            msg: "rerank failed (streaming)",
                            err: err instanceof Error ? err.message : String(err),
                        }),
                    );
                    send({
                        type: "error",
                        stage: "rerank",
                        message: "Reranking failed. Please try again.",
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

                for await (const event of generateAnswerStream(question, rankedArticles, {
                    signal: globalController.signal,
                })) {
                    if (event.type === "delta") {
                        send({ type: "delta", text: event.text });
                    } else if (event.type === "done") {
                        finalAnswer = event.answer;
                        finalCitations = event.citations;
                        finalConfidence = event.confidence;
                    }
                }

                const generationTimeMs = Date.now() - generationStart;
                const totalTimeMs = Date.now() - totalStart;

                send({
                    type: "done",
                    answer: finalAnswer,
                    citations: finalCitations,
                    confidence: finalConfidence,
                    meta: {
                        retrievalTimeMs,
                        generationTimeMs,
                        totalTimeMs,
                        articlesSearched: articles.length,
                        method,
                        reformulatedQuery:
                            embeddingQuery !== question ? embeddingQuery : undefined,
                    },
                });
            } catch (err) {
                // Top-level safety net (deadline aborts, unexpected throws)
                const isDeadline = err instanceof DeadlineExceededError;
                const message = isDeadline
                    ? "Request took too long. Please try a simpler question."
                    : err instanceof Error
                      ? err.message
                      : String(err);
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
    const rateResult = askRateLimiter(ip);
    if (!rateResult.allowed) {
        return NextResponse.json(
            { error: "Too many questions. Please wait a moment and try again." },
            {
                status: 429,
                headers: {
                    "Retry-After": String(Math.ceil((rateResult.resetAt - Date.now()) / 1000)),
                },
            },
        );
    }

    // ── Parse + validate body ──
    let body: AskRequestBody;
    try {
        body = (await request.json()) as AskRequestBody;
    } catch {
        return NextResponse.json(
            { error: "Invalid JSON body" },
            { status: 400 },
        );
    }

    if (!body.question || typeof body.question !== "string") {
        return NextResponse.json(
            { error: "Missing required field: question" },
            { status: 400 },
        );
    }
    const question = body.question.trim();
    if (question.length === 0) {
        return NextResponse.json(
            { error: "Question cannot be empty" },
            { status: 400 },
        );
    }
    if (question.length > MAX_QUESTION_LENGTH) {
        return NextResponse.json(
            { error: `Question too long (${question.length} chars). Maximum is ${MAX_QUESTION_LENGTH}.` },
            { status: 400 },
        );
    }

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
        });
    }

    // ── Concurrent request dedup ──
    // If an identical (ip, question, filters) request is already in
    // flight, piggyback on it instead of running the full pipeline again.
    // Falls through (runs our own) if the in-flight one rejects.
    const dedupId = dedupKey(ip, question, body.filters);
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
        const { embeddingQuery, ftsQuery, mode } = await wrapStage(
            "reformulate",
            () =>
                reformulateQuery(question, {
                    signal: globalController.signal,
                }),
        );

        // ── Step 2: Embed the reformulated query ──
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
                return NextResponse.json(
                    {
                        error: "Daily AI quota reached. Please try again tomorrow.",
                        cause: "quota_exhausted",
                        stage: "embed",
                        requestId,
                    },
                    {
                        status: 429,
                        headers: { "Retry-After": "3600" },
                    },
                );
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
            return NextResponse.json(
                {
                    error: "Failed to process question. Please try again.",
                    stage: "embed",
                    requestId,
                },
                { status: 502 },
            );
        }

        // ── Step 3: Retrieve relevant articles (with timeout) ──
        const retrievalStart = Date.now();
        const filters = body.filters ?? {};
        let articles: RetrievedArticle[];
        let method: "hybrid" | "vector" = "hybrid";
        // Visual mode retrieves more candidates since we pre-filter to articles
        // with images (smaller pool, need wider net to find relevant photos)
        const retrievalLimit = mode === "visual" ? 30 : 8;

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
                return NextResponse.json(
                    {
                        error: "Retrieval took too long. Please try again.",
                        stage: "retrieve",
                        requestId,
                    },
                    { status: 504 },
                );
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
        const keepTopK = mode === "visual" ? 15 : 5;
        logRerankSignals(requestId, computeRerankSignals(articles), mode, "default");

        const rankedArticles: RankedArticle[] = await wrapStage("rerank", () =>
            rerankArticles(question, articles, {
                maxArticles: keepTopK,
                minScore: mode === "visual" ? 3 : 5,
                signal: globalController.signal,
            }),
        );

        // ── Step 5: Generate answer (using ORIGINAL question, not reformulated) ──
        const generationStart = Date.now();
        const { answer, citations, confidence } = await wrapStage(
            "generate",
            () =>
                generateAnswer(question, rankedArticles, {
                    signal: globalController.signal,
                }),
        );
        const generationTimeMs = Date.now() - generationStart;

        // ── Build response ──
        const response: AskResponse = {
            question,
            answer,
            citations,
            confidence,
            mode,
            requestId,
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
            })),
            meta: {
                retrievalTimeMs,
                generationTimeMs,
                totalTimeMs: Date.now() - totalStart,
                articlesSearched: articles.length,
                method,
                reformulatedQuery: embeddingQuery !== question ? embeddingQuery : undefined,
            },
        };

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
            return NextResponse.json(
                {
                    error: "Request took too long. Please try a simpler question.",
                    stage: "deadline",
                    requestId,
                },
                { status: 504 },
            );
        }
        if (err instanceof StageError) {
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
            return NextResponse.json(
                {
                    error: "An unexpected error occurred. Please try again.",
                    stage: err.stage,
                    requestId,
                },
                { status: 500 },
            );
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
        return NextResponse.json(
            {
                error: "An unexpected error occurred. Please try again.",
                requestId,
            },
            { status: 500 },
        );
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
