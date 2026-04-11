/**
 * Query Reformulator
 *
 * Uses Gemini Flash to expand modern user queries into 1960s-era newspaper
 * language. Produces separate queries optimized for semantic (embedding) and
 * keyword (FTS) retrieval paths.
 *
 * Graceful fallback: returns the original question on any error or timeout.
 */

import { getGeminiClient } from "@/src/lib/gemini-client";

const REFORMULATION_MODEL = "gemini-3-flash-preview";
const REFORMULATION_TIMEOUT_MS = 3_000;
const REFORMULATION_MAX_TOKENS = 200;

export interface ReformulatedQuery {
    embeddingQuery: string;
    ftsQuery: string;
}

const REFORMULATION_PROMPT = `You help reformulate modern search queries for a 1960s university newspaper archive (The Transcript, Ohio Wesleyan University).

Given a user question, produce two reformulated queries:
1. SEMANTIC: A natural-language expansion for embedding search. Add 1960s-era synonyms and rephrase for semantic similarity. Keep it under 50 words.
2. KEYWORDS: A keyword query for full-text search. List the most important search terms including period-appropriate synonyms, separated by OR. Keep it under 30 words.

Expand abbreviations (OWU → Ohio Wesleyan University). Add era-appropriate terms:
- basketball → basketball OR cagers OR hoopsters
- football → football OR gridiron OR "Battling Bishops"
- student government → "student government" OR "student senate" OR "student council"
- protest → protest OR demonstration OR rally OR sit-in
- dormitory → dormitory OR dorm OR "residence hall"
- fraternity/sorority → fraternity OR sorority OR "Greek life" OR pledge

Respond in EXACTLY this format (two lines, no extra text):
SEMANTIC: <your semantic query>
KEYWORDS: <your keyword query>`;

export async function reformulateQuery(
    originalQuestion: string,
): Promise<ReformulatedQuery> {
    const fallback: ReformulatedQuery = {
        embeddingQuery: originalQuestion,
        ftsQuery: originalQuestion,
    };

    try {
        const client = getGeminiClient();

        const controller = new AbortController();
        const timeout = setTimeout(
            () => controller.abort(),
            REFORMULATION_TIMEOUT_MS,
        );

        const response = await client.models.generateContent({
            model: REFORMULATION_MODEL,
            contents: [
                {
                    role: "user",
                    parts: [{ text: `<user_question>${originalQuestion}</user_question>` }],
                },
            ],
            config: {
                systemInstruction: REFORMULATION_PROMPT,
                maxOutputTokens: REFORMULATION_MAX_TOKENS,
                temperature: 0.0,
                thinkingConfig: { thinkingBudget: 0 },
                abortSignal: controller.signal,
            },
        });

        clearTimeout(timeout);

        const text = response.text?.trim() ?? "";
        return parseReformulationResponse(text, fallback);
    } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
            console.warn("Query reformulation timed out, using original query");
        } else {
            console.warn("Query reformulation failed, using original query:", err);
        }
        return fallback;
    }
}

export function parseReformulationResponse(
    text: string,
    fallback: ReformulatedQuery,
): ReformulatedQuery {
    const semanticMatch = text.match(/^SEMANTIC:\s*(.+)$/m);
    const keywordsMatch = text.match(/^KEYWORDS:\s*(.+)$/m);

    if (!semanticMatch || !keywordsMatch) {
        return fallback;
    }

    const embeddingQuery = semanticMatch[1].trim();
    const ftsQuery = keywordsMatch[1].trim();

    // Sanity check: don't return empty strings
    if (!embeddingQuery || !ftsQuery) {
        return fallback;
    }

    return { embeddingQuery, ftsQuery };
}
