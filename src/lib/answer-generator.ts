/**
 * Answer Generator
 *
 * Uses Gemini Flash to synthesize a grounded answer from retrieved articles.
 * Every factual claim must cite a source article. If the sources don't contain
 * enough information, the model is instructed to say so honestly.
 */

import { GoogleGenAI } from "@google/genai";
import type { RetrievedArticle } from "@/src/lib/db";
import type { Citation } from "@/src/types";

const GENERATION_MODEL = "gemini-2.0-flash";
const MAX_ANSWER_TOKENS = 1024;
const GENERATION_TIMEOUT_MS = 15_000;

let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("API key required for answer generation");
    if (!_client) _client = new GoogleGenAI({ apiKey });
    return _client;
}

// ─── Types ───────────────────────────────────────────────────────

export interface GeneratedAnswer {
    answer: string;
    citations: Citation[];
    confidence: "low" | "medium" | "high";
}

// ─── System Prompt ───────────────────────────────────────────────

function buildSystemPrompt(): string {
    return `You are "The Archive," a research assistant for The Transcript — Ohio Wesleyan University's student newspaper from the 1960s.

RULES — follow these exactly:
1. Answer ONLY from the provided source articles. Never use outside knowledge.
2. CITE every factual claim using the format [Source N] where N matches the article number.
3. If the sources do not contain enough information to answer, say: "I don't have enough information in the archive to answer this question."
4. Be concise and direct. Use 2-4 sentences for simple questions, up to a paragraph for complex ones.
5. Use past tense when describing historical events.
6. Preserve exact names, dates, and figures from the sources — do not paraphrase numbers or proper nouns.
7. If multiple sources discuss the same topic, synthesize them and cite all relevant sources.
8. Never make up quotes, statistics, or events not explicitly stated in the sources.

RESPONSE FORMAT:
Write your answer as plain text with inline [Source N] citations. Do not use markdown headers or bullet points.`;
}

function buildUserPrompt(
    question: string,
    articles: RetrievedArticle[],
): string {
    const sourcesBlock = articles
        .map(
            (a, i) =>
                `--- Source ${i + 1} ---
Article ID: ${a.id}
Headline: ${a.headline}
Date: ${a.editionDate}
Category: ${a.category}
${a.byline ? `Author: ${a.byline}` : ""}
Content:
${a.bodyPlain.slice(0, 3000)}`,
        )
        .join("\n\n");

    return `SOURCES:
${sourcesBlock}

QUESTION: ${question}`;
}

// ─── Generation ──────────────────────────────────────────────────

export async function generateAnswer(
    question: string,
    sourceArticles: RetrievedArticle[],
): Promise<GeneratedAnswer> {
    if (sourceArticles.length === 0) {
        return {
            answer:
                "I don't have enough information in the archive to answer this question.",
            citations: [],
            confidence: "low",
        };
    }

    // Compute confidence from vector distances only (FTS results have distance=0 which would inflate scores)
    const vectorArticles = sourceArticles.filter((a) => a.source === "vector");
    const avgDistance =
        vectorArticles.length > 0
            ? vectorArticles.reduce((s, a) => s + a.distance, 0) / vectorArticles.length
            : 0.35; // default to "medium" range when no vector results
    const confidence = computeConfidence(avgDistance, sourceArticles.length);

    // If all sources are very distant, return a low-confidence disclaimer
    if (confidence === "low" && avgDistance > 0.45) {
        return {
            answer:
                "I don't have enough information in the archive to answer this question. The articles I found don't seem to be closely related to what you're asking about.",
            citations: [],
            confidence: "low",
        };
    }

    const client = getClient();
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(question, sourceArticles);

    // Generate with timeout
    const controller = new AbortController();
    const timeout = setTimeout(
        () => controller.abort(),
        GENERATION_TIMEOUT_MS,
    );

    try {
        const response = await client.models.generateContent({
            model: GENERATION_MODEL,
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            config: {
                systemInstruction: systemPrompt,
                maxOutputTokens: MAX_ANSWER_TOKENS,
                temperature: 0.2, // low temperature for factual grounding
                abortSignal: controller.signal,
            },
        });

        clearTimeout(timeout);

        const rawAnswer = response.text?.trim() ?? "";

        if (!rawAnswer) {
            return {
                answer:
                    "I wasn't able to generate an answer from the available sources. Please try rephrasing your question.",
                citations: [],
                confidence: "low",
            };
        }

        // Parse citations from the answer text
        const citations = parseCitations(rawAnswer, sourceArticles);

        // Validate: if the answer references sources but we couldn't parse any valid citations,
        // flag it as potentially unreliable
        const hasSourceRefs = /\[Source \d+\]/i.test(rawAnswer);
        const validatedConfidence =
            hasSourceRefs && citations.length === 0 ? "low" : confidence;

        return {
            answer: rawAnswer,
            citations,
            confidence: validatedConfidence,
        };
    } catch (err) {
        clearTimeout(timeout);

        if (err instanceof Error && err.name === "AbortError") {
            return {
                answer:
                    "The answer took too long to generate. Please try a simpler question.",
                citations: [],
                confidence: "low",
            };
        }

        console.error("Answer generation failed:", err);
        return {
            answer:
                "I encountered an error while generating an answer. Please try again.",
            citations: [],
            confidence: "low",
        };
    }
}

// ─── Citation Parsing ────────────────────────────────────────────

function parseCitations(
    answer: string,
    sourceArticles: RetrievedArticle[],
): Citation[] {
    const citationPattern = /\[Source (\d+)\]/gi;
    const seenIds = new Set<string>();
    const citations: Citation[] = [];

    let match;
    while ((match = citationPattern.exec(answer)) !== null) {
        const sourceIndex = parseInt(match[1], 10) - 1; // 1-indexed → 0-indexed
        if (sourceIndex >= 0 && sourceIndex < sourceArticles.length) {
            const article = sourceArticles[sourceIndex];
            if (!seenIds.has(article.id)) {
                seenIds.add(article.id);
                citations.push({
                    articleId: article.id,
                    headline: article.headline,
                    editionDate: article.editionDate,
                });
            }
        }
    }

    return citations;
}

// ─── Confidence ──────────────────────────────────────────────────

function computeConfidence(
    avgDistance: number,
    articleCount: number,
): "low" | "medium" | "high" {
    // Distance thresholds tuned from our embedding audit:
    // - Good matches: < 0.30 distance
    // - Decent matches: 0.30 - 0.40
    // - Weak matches: > 0.40
    if (avgDistance < 0.30 && articleCount >= 2) return "high";
    if (avgDistance < 0.40) return "medium";
    return "low";
}
