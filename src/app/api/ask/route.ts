/**
 * POST /api/ask — "Ask the Archive" RAG endpoint
 *
 * Pipeline: question → embed → hybrid retrieve → LLM generate → response
 *
 * Body: { question: string, filters?: { category?, startDate?, endDate? } }
 */

import { NextRequest, NextResponse } from "next/server";
import { embedQuery } from "@/src/lib/embeddings";
import { hybridSearch, queryArticlesByEmbedding } from "@/src/lib/db";
import type { RetrievedArticle } from "@/src/lib/db";
import { generateAnswer } from "@/src/lib/answer-generator";
import { reformulateQuery } from "@/src/lib/query-reformulator";
import { rerankArticles } from "@/src/lib/reranker";
import type { AskResponse } from "@/src/types";
import { createRateLimiter, getClientIp } from "@/src/lib/rate-limit";

const MAX_QUESTION_LENGTH = 1000;
const RETRIEVAL_TIMEOUT_MS = 10_000;

const askRateLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

interface AskRequestBody {
    question: string;
    filters?: {
        category?: string;
        startDate?: string;
        endDate?: string;
    };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    const totalStart = Date.now();

    try {
        // ── Rate limit ──
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

        const body = (await request.json()) as AskRequestBody;

        // ── Validate ──
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

        // ── Step 1: Reformulate query for better retrieval ──
        const { embeddingQuery, ftsQuery, mode } = await reformulateQuery(question);

        // ── Step 2: Embed the reformulated query ──
        let questionEmbedding: number[];
        try {
            questionEmbedding = await embedQuery(embeddingQuery);
        } catch (err) {
            console.error("Failed to embed question:", err);
            return NextResponse.json(
                { error: "Failed to process question. Please try again." },
                { status: 502 },
            );
        }

        // ── Step 3: Retrieve relevant articles (with timeout) ──
        const retrievalStart = Date.now();
        const filters = body.filters ?? {};
        let articles: RetrievedArticle[];
        let method: "hybrid" | "vector" = "hybrid";

        const retrievalTimeout = new Promise<never>((_, reject) =>
            setTimeout(
                () => reject(new Error("Retrieval timeout")),
                RETRIEVAL_TIMEOUT_MS,
            ),
        );

        try {
            articles = await Promise.race([
                hybridSearch(ftsQuery, questionEmbedding, {
                    limit: 8,
                    category: filters.category ?? null,
                    startDate: filters.startDate ?? null,
                    endDate: filters.endDate ?? null,
                    vectorWeight: 0.7,
                }),
                retrievalTimeout,
            ]);
        } catch (err) {
            if (err instanceof Error && err.message === "Retrieval timeout") {
                return NextResponse.json(
                    { error: "Retrieval took too long. Please try again." },
                    { status: 504 },
                );
            }
            console.warn("Hybrid search failed, falling back to vector-only:", err);
            method = "vector";
            const fallbackTimeout = new Promise<never>((_, reject) =>
                setTimeout(
                    () => reject(new Error("Retrieval timeout")),
                    RETRIEVAL_TIMEOUT_MS,
                ),
            );
            articles = await Promise.race([
                queryArticlesByEmbedding(questionEmbedding, {
                    limit: 8,
                    category: filters.category ?? null,
                    startDate: filters.startDate ?? null,
                    endDate: filters.endDate ?? null,
                }),
                fallbackTimeout,
            ]);
        }
        const retrievalTimeMs = Date.now() - retrievalStart;

        // ── Step 4: Re-rank articles by relevance ──
        const rankedArticles = await rerankArticles(question, articles);

        // ── Step 5: Generate answer (using ORIGINAL question, not reformulated) ──
        const generationStart = Date.now();
        const { answer, citations, confidence } = await generateAnswer(
            question,
            rankedArticles,
        );
        const generationTimeMs = Date.now() - generationStart;

        // ── Build response ──
        const response: AskResponse = {
            question,
            answer,
            citations,
            confidence,
            mode,
            sourceArticles: rankedArticles.map((a) => ({
                id: a.id,
                headline: a.headline,
                editionDate: a.editionDate,
                category: a.category,
                summary: a.summary,
                byline: a.byline,
                bodySnippet: a.bodyPlain.slice(0, 300) + (a.bodyPlain.length > 300 ? "…" : ""),
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
    } catch (err) {
        console.error("Ask API error:", err);
        return NextResponse.json(
            { error: "An unexpected error occurred. Please try again." },
            { status: 500 },
        );
    }
}
