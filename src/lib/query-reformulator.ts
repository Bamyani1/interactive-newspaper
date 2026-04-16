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
import { formatHistoryForPrompt } from "@/src/lib/conversation-store";
import type { ConversationTurn } from "@/src/lib/conversation-store";

const REFORMULATION_MODEL = "gemini-3-flash-preview";
const REFORMULATION_TIMEOUT_MS = 5_000;
const REFORMULATION_MAX_TOKENS = 350;

export type Complexity = "simple" | "complex";

export interface ReformulatedQuery {
    embeddingQuery: string;
    ftsQuery: string;
    mode: "text" | "visual";
    complexity: Complexity;
}

const REFORMULATION_PROMPT = `You help reformulate modern search queries for The Transcript Archive (Ohio Wesleyan University, 1950-2006).

Given a user question, produce two reformulated queries:
1. SEMANTIC: A natural-language expansion for embedding search. Add era-appropriate synonyms and rephrase for semantic similarity. Keep it under 50 words.
2. KEYWORDS: A keyword query for full-text search. List the most important search terms including period-appropriate synonyms, separated by OR. Keep it under 40 words.
3. MODE: Either "text" (factual question) or "visual" (user wants to see images, photos, or visual changes over time). Use "visual" when the query asks to "show", "see", or requests photos, pictures, or visual history.

Expand abbreviations (OWU → Ohio Wesleyan University). Add era-appropriate terms:
- basketball → basketball OR cagers OR hoopsters
- football → football OR gridiron OR "Battling Bishops"
- other sports → lacrosse OR swimming OR track OR tennis OR wrestling OR "cross country" OR baseball OR soccer
- student government → "student government" OR "student senate" OR "student council" OR WCSA
- protest → protest OR demonstration OR rally OR sit-in OR strike
- dormitory → dormitory OR dorm OR "residence hall"
- fraternity/sorority → fraternity OR sorority OR "Greek life" OR pledge OR rush
- draft / Vietnam → draft OR "selective service" OR conscription OR ROTC OR Vietnam OR "anti-war"
- civil rights → "civil rights" OR integration OR "Black students" OR Negro OR desegregation
- governance → dean OR provost OR president OR "board of trustees" OR faculty OR administration
- campus places → "Branch Rickey Arena" OR "Hamilton-Williams" OR "Slocum Hall" OR "Sanborn Hall" OR "Beeghly Library"
- the newspaper → "The Transcript" OR "student newspaper" OR editor OR editorial
- academics → curriculum OR course OR major OR professor OR faculty OR seminar

4. COMPLEXITY: Classify the question's retrieval difficulty:
   - "simple" — single topic, single era, factual lookup, clear keywords (e.g., "What was the 1965 homecoming like?")
   - "complex" — multiple eras/decades, comparative ("how did X change"), analytical ("why"), requires synthesis across many articles, entity-relationship questions ("who wrote the most about sports"), or multi-hop reasoning

If CONVERSATION HISTORY is provided below the question, use it to resolve ambiguous references ("that", "more", "he/she", "next", "previous"). Rewrite the question to be fully self-contained — a reader with no context should understand exactly what is being asked.

Respond in EXACTLY this format (four lines, no extra text):
SEMANTIC: <your semantic query>
KEYWORDS: <your keyword query>
MODE: text|visual
COMPLEXITY: simple|complex`;

export async function reformulateQuery(
    originalQuestion: string,
    opts: {
        signal?: AbortSignal;
        requestId?: string;
        conversationHistory?: ConversationTurn[];
    } = {},
): Promise<ReformulatedQuery> {
    const fallback: ReformulatedQuery = {
        embeddingQuery: originalQuestion,
        ftsQuery: originalQuestion,
        mode: "text",
        complexity: "simple",
    };

    try {
        const client = getGeminiClient();

        const controller = new AbortController();
        const timeout = setTimeout(
            () => controller.abort(),
            REFORMULATION_TIMEOUT_MS,
        );

        // Combine the outer request signal (from /api/ask's global deadline)
        // with the internal 5s timeout. Either firing aborts the SDK call.
        const combinedSignal = opts.signal
            ? AbortSignal.any([opts.signal, controller.signal])
            : controller.signal;

        const response = await client.models.generateContent({
            model: REFORMULATION_MODEL,
            contents: [
                {
                    role: "user",
                    parts: [{ text: buildReformulatorInput(originalQuestion, opts.conversationHistory) }],
                },
            ],
            config: {
                systemInstruction: REFORMULATION_PROMPT,
                maxOutputTokens: REFORMULATION_MAX_TOKENS,
                temperature: 0.0,
                thinkingConfig: { thinkingBudget: 0 },
                abortSignal: combinedSignal,
            },
        });

        clearTimeout(timeout);

        const text = response.text?.trim() ?? "";
        return parseReformulationResponse(text, fallback);
    } catch (err) {
        const isTimeout = err instanceof Error && err.name === "AbortError";
        console.warn(
            JSON.stringify({
                level: "warn",
                route: "/api/ask",
                requestId: opts.requestId,
                stage: "reformulate",
                msg: isTimeout
                    ? "reformulation timed out, using original query"
                    : "reformulation failed, using original query",
                err: err instanceof Error ? err.message : String(err),
            }),
        );
        return fallback;
    }
}

function buildReformulatorInput(
    question: string,
    history?: ConversationTurn[],
): string {
    const historyBlock = history && history.length > 0
        ? `CONVERSATION HISTORY:\n${formatHistoryForPrompt(history)}\n\n`
        : "";
    return `${historyBlock}<user_question>${question}</user_question>`;
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

    const modeMatch = text.match(/^MODE:\s*(.+)$/m);
    const mode = modeMatch && modeMatch[1].trim().toLowerCase() === "visual" ? "visual" : "text";

    const complexityMatch = text.match(/^COMPLEXITY:\s*(.+)$/m);
    const complexity: Complexity =
        complexityMatch && complexityMatch[1].trim().toLowerCase() === "complex"
            ? "complex"
            : "simple";

    return { embeddingQuery, ftsQuery, mode, complexity };
}
