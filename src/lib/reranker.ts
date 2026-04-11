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
import type { RetrievedArticle } from "@/src/lib/db";

const RERANKER_MODEL = "gemini-3-flash-preview";
const RERANKER_TIMEOUT_MS = 5_000;
const RERANKER_MAX_TOKENS = 100;
const DEFAULT_MIN_SCORE = 3;
const DEFAULT_MAX_ARTICLES = 5;

export interface RankedArticle extends RetrievedArticle {
    relevanceScore: number;
}

interface RerankOptions {
    minScore?: number;
    maxArticles?: number;
}

const RERANKER_PROMPT = `You are a relevance judge for a 1960s university newspaper archive search system.

Given a user question and a list of article summaries, rate each article's relevance to the question on a scale of 0-10:
- 0: Completely irrelevant
- 3: Tangentially related
- 5: Somewhat relevant
- 7: Relevant
- 10: Directly answers the question

Respond with ONLY a JSON array of scores in the same order as the articles. Example: [8, 2, 6, 0, 9]
No other text.`;

export async function rerankArticles(
    question: string,
    articles: RetrievedArticle[],
    options: RerankOptions = {},
): Promise<RankedArticle[]> {
    const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
    const maxArticles = options.maxArticles ?? DEFAULT_MAX_ARTICLES;

    // Nothing to rerank
    if (articles.length === 0) return [];

    // Skip reranking for very small result sets
    if (articles.length <= 2) {
        return articles.map((a) => ({ ...a, relevanceScore: 5 }));
    }

    try {
        const client = getGeminiClient();

        const articleSummaries = articles
            .map(
                (a, i) =>
                    `[${i + 1}] "${a.headline}" (${a.editionDate}, ${a.category}): ${a.summary}`,
            )
            .join("\n");

        const userPrompt = `<user_question>${question}</user_question>\n\nArticles:\n${articleSummaries}`;

        const controller = new AbortController();
        const timeout = setTimeout(
            () => controller.abort(),
            RERANKER_TIMEOUT_MS,
        );

        const response = await client.models.generateContent({
            model: RERANKER_MODEL,
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            config: {
                systemInstruction: RERANKER_PROMPT,
                maxOutputTokens: RERANKER_MAX_TOKENS,
                temperature: 0.0,
                thinkingConfig: { thinkingBudget: 0 },
                abortSignal: controller.signal,
            },
        });

        clearTimeout(timeout);

        const text = response.text?.trim() ?? "";
        const scores = parseScores(text, articles.length);

        if (!scores) {
            console.warn("Failed to parse reranker scores, returning original articles");
            return articles.map((a) => ({ ...a, relevanceScore: 5 }));
        }

        // Attach scores, filter, sort, and cap
        return articles
            .map((a, i) => ({ ...a, relevanceScore: scores[i] }))
            .filter((a) => a.relevanceScore >= minScore)
            .sort((a, b) => b.relevanceScore - a.relevanceScore)
            .slice(0, maxArticles);
    } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
            console.warn("Reranker timed out, returning original articles");
        } else {
            console.warn("Reranker failed, returning original articles:", err);
        }
        return articles.map((a) => ({ ...a, relevanceScore: 5 }));
    }
}

export function parseScores(
    text: string,
    expectedCount: number,
): number[] | null {
    try {
        // Extract JSON array from the response (may have surrounding text)
        const arrayMatch = text.match(/\[[\d\s,.]+\]/);
        if (!arrayMatch) return null;

        const parsed = JSON.parse(arrayMatch[0]) as unknown[];
        if (!Array.isArray(parsed) || parsed.length !== expectedCount) return null;

        const scores = parsed.map(Number);
        if (scores.some((s) => isNaN(s) || s < 0 || s > 10)) return null;

        return scores;
    } catch {
        return null;
    }
}
