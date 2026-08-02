/**
 * LLM-Based Re-Ranker
 *
 * Uses Gemini Flash to score each retrieved article's relevance to the
 * user's question on a 0-10 scale. Filters out low-relevance articles
 * and caps the number sent to the answer generator.
 *
 * Graceful fallback: returns the original articles on any error or timeout.
 */

import { getGeminiClient } from "@/src/lib/gemini-client";
import { recordUsage } from "@/src/lib/cost-tracker";
import { RAG_MODEL_CONFIG } from "@/src/lib/rag-model-config";
import type { RetrievedArticle } from "@/src/lib/db";

const RERANKER_MODEL = RAG_MODEL_CONFIG.rerank.model;
const RERANKER_TIMEOUT_MS = 8_000;
const RERANKER_MAX_TOKENS = 150;
const RERANKER_BODY_CHARS = 2000; // body excerpt sent to reranker per article
const RERANKER_IMAGE_CAPTION_CHARS = 1000;
const DEFAULT_MIN_SCORE = 5;
const DEFAULT_MAX_ARTICLES = 5;

export interface RankedArticle extends RetrievedArticle {
    relevanceScore: number;
}

interface RerankOptions {
    minScore?: number;
    maxArticles?: number;
    mode?: "text" | "visual";
    signal?: AbortSignal;
    requestId?: string;
}

const RERANKER_PROMPT = `You are a relevance judge for a university newspaper archive search system (Ohio Wesleyan University, 1950-2006).

Given a user question and a list of article summaries, rate each article's relevance to the question on a scale of 0-10:
- 0: Completely irrelevant
- 3: Tangentially related
- 5: Somewhat relevant
- 7: Relevant
- 10: Directly answers the question

For a visual search, judge whether the listed image captions describe the requested visual. A direct caption match is strong evidence (7-10); article prose that mentions the subject does not make an unrelated image relevant.

Judge whether a source helps answer the question, not whether it confirms the question's premise. A source that directly says a supposed visit, event, plan, or claim did not happen is highly relevant (7-10), because correcting the false premise is the answer.

Return a JSON object with a "scores" array in the same order as the articles. Example: {"scores":[8,2,6,0,9]}`;

const RERANKER_SCHEMA = {
    type: "object",
    properties: {
        scores: {
            type: "array",
            items: { type: "number", minimum: 0, maximum: 10 },
        },
    },
    required: ["scores"],
    additionalProperties: false,
} as const;

export async function rerankArticles(
    question: string,
    articles: RetrievedArticle[],
    options: RerankOptions = {},
): Promise<RankedArticle[]> {
    const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
    const maxArticles = options.maxArticles ?? DEFAULT_MAX_ARTICLES;

    // Nothing to rerank
    if (articles.length === 0) return [];

    try {
        const client = getGeminiClient();

        const articleSummaries = articles
            .map((a, i) => {
                const relevantText =
                    a.matchedPassages && a.matchedPassages.length > 0
                        ? a.matchedPassages.join("\n\n")
                        : a.bodyPlain || "";
                const bodyExcerpt = relevantText.slice(0, RERANKER_BODY_CHARS);
                const imageCaptions = (a.imageCaptions ?? [])
                    .filter((caption): caption is string => Boolean(caption?.trim()))
                    .map((caption) => caption.trim())
                    .join(" | ")
                    .slice(0, RERANKER_IMAGE_CAPTION_CHARS);
                return `[${i + 1}] "${a.headline}" (${a.editionDate}, ${a.category})\nSummary: ${a.summary || "(none)"}\nExcerpt: ${bodyExcerpt}\nImage captions: ${imageCaptions || "(none)"}`;
            })
            .join("\n\n");

        const userPrompt = `SEARCH MODE: ${options.mode ?? "text"}\nUSER QUESTION (JSON string): ${JSON.stringify(question)}\n\nArticles:\n${articleSummaries}`;

        const controller = new AbortController();
        const timeout = setTimeout(
            () => controller.abort(),
            RERANKER_TIMEOUT_MS,
        );

        const combinedSignal = options.signal
            ? AbortSignal.any([options.signal, controller.signal])
            : controller.signal;

        const response = await client.models.generateContent({
            model: RERANKER_MODEL,
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            config: {
                systemInstruction: RERANKER_PROMPT,
                maxOutputTokens: RERANKER_MAX_TOKENS,
                thinkingConfig: {
                    thinkingLevel: RAG_MODEL_CONFIG.rerank.thinkingLevel,
                },
                responseMimeType: "application/json",
                responseJsonSchema: RERANKER_SCHEMA,
                abortSignal: combinedSignal,
            },
        });

        clearTimeout(timeout);

        void recordUsage(RERANKER_MODEL, response.usageMetadata, {
            requestId: options.requestId,
            op: "rerank",
        });

        const text = response.text?.trim() ?? "";
        const scores = parseScores(text, articles.length);

        if (!scores) {
            console.warn(
                JSON.stringify({
                    level: "warn",
                    route: "/api/ask",
                    requestId: options.requestId,
                    stage: "rerank",
                    msg: "failed to parse reranker scores, returning original articles",
                }),
            );
            return articles
                .slice(0, maxArticles)
                .map((a) => ({ ...a, relevanceScore: 5 }));
        }

        // Attach scores, filter, sort, and cap
        return articles
            .map((a, i) => ({ ...a, relevanceScore: scores[i] }))
            .filter((a) => a.relevanceScore >= minScore)
            .sort((a, b) => b.relevanceScore - a.relevanceScore)
            .slice(0, maxArticles);
    } catch (err) {
        const isTimeout = err instanceof Error && err.name === "AbortError";
        console.warn(
            JSON.stringify({
                level: "warn",
                route: "/api/ask",
                requestId: options.requestId,
                stage: "rerank",
                msg: isTimeout
                    ? "reranker timed out, returning original articles"
                    : "reranker failed, returning original articles",
                err: err instanceof Error ? err.message : String(err),
            }),
        );
        return articles
            .slice(0, maxArticles)
            .map((a) => ({ ...a, relevanceScore: 5 }));
    }
}

export function parseScores(
    text: string,
    expectedCount: number,
): number[] | null {
    try {
        const decoded = JSON.parse(text) as unknown;
        const parsed = Array.isArray(decoded)
            ? decoded
            : typeof decoded === "object" && decoded !== null
              ? (decoded as { scores?: unknown }).scores
              : null;
        if (!Array.isArray(parsed) || parsed.length !== expectedCount) return null;

        const scores = parsed.map(Number);
        if (scores.some((s) => isNaN(s) || s < 0 || s > 10)) return null;

        return scores;
    } catch {
        return null;
    }
}
