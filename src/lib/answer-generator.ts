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
const MAX_ANSWER_TOKENS = 2560;
const GENERATION_TIMEOUT_MS = 15_000;
const MAX_SOURCE_CHARS = 5000;

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
1. First, assess each source's relevance to the question. Disregard any source that is not meaningfully related to what is being asked.
2. Answer ONLY from the relevant source articles. Never use outside knowledge.
3. CITE every factual claim using the format [Source N] where N matches the article number.
4. If the sources do not contain enough information to answer, say: "I don't have enough information in the archive to answer this question."
5. Provide thorough, detailed answers. Use 1-2 paragraphs for simple questions and multiple paragraphs for complex ones. Synthesize information across sources to give comprehensive context.
6. Use past tense when describing historical events.
7. Preserve exact names, dates, and figures from the sources — do not paraphrase numbers or proper nouns.
8. If multiple sources discuss the same topic, synthesize them and cite all relevant sources.
9. Never make up quotes, statistics, or events not explicitly stated in the sources.

RESPONSE FORMAT:
Begin with a line: "Relevant sources: [Source N, Source M, ...]" listing only sources you will actually cite.
Then write a blank line, followed by your answer as plain text with inline [Source N] citations. Do not use markdown headers or bullet points.

EXAMPLES:

Question: "What sports teams did Ohio Wesleyan have in 1965?"
Sources: [Source 1] about the Battling Bishops football season, [Source 2] about basketball tryouts, [Source 3] about campus dining changes
Good answer:
Relevant sources: [Source 1, Source 2]

Ohio Wesleyan's Battling Bishops competed in football during the fall 1965 season, finishing with a 5-3 record [Source 1]. The university also fielded a basketball team, with tryouts for the 1965-66 season drawing over 30 hopefuls to Branch Rickey Arena [Source 2].

Question: "Did OWU have a computer science department?"
Sources: [Source 1] about English department hiring, [Source 2] about library renovations
Good answer:
Relevant sources: []

I don't have enough information in the archive to answer this question. The sources I found cover English department hiring and library renovations, but none mention a computer science department.`;
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
${a.bodyPlain.slice(0, MAX_SOURCE_CHARS)}`,
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

        const rawText = response.text?.trim() ?? "";

        // Strip the CoT preamble ("Relevant sources: ...") before user-facing answer
        const rawAnswer = rawText.replace(/^Relevant sources:[^\n]*\n\n/, "").trim();

        if (!rawAnswer) {
            return {
                answer:
                    "I wasn't able to generate an answer from the available sources. Please try rephrasing your question.",
                citations: [],
                confidence: "low",
            };
        }

        // Parse citations from the full text (including preamble) so all referenced sources are captured
        const citations = parseCitations(rawText, sourceArticles);

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
