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
import { parseEraLabel, eraOverlapFraction } from "@/src/lib/era-parser";
export type { Era } from "@/src/lib/era-parser";

const REFORMULATION_MODEL = "gemini-3-flash-preview";
const REFORMULATION_TIMEOUT_MS = 5_000;
const REFORMULATION_MAX_TOKENS = 350;

export interface ReformulatedQuery {
    embeddingQuery: string;
    ftsQuery: string;
    mode: "text" | "visual";
    eras?: import("@/src/lib/era-parser").Era[];
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

When the question explicitly asks about change over time, compares two or more distinct eras (decades, named periods, years far apart), or asks "how did X change from A to B" — emit an additional ERAS line listing the era labels as a JSON array. Use labels like "1960s", "early 1970s", "late 1980s", "2000", "mid-century". Emit ERAS only when there are TWO OR MORE distinct eras. Omit ERAS entirely for single-era questions ("what was life like in 1965?") or for timeless questions ("how did the football team recruit?").

Respond in EXACTLY this format (three lines, or four if the question is multi-era):
SEMANTIC: <your semantic query>
KEYWORDS: <your keyword query>
MODE: text|visual
ERAS: ["<label 1>", "<label 2>", ...]`;

export async function reformulateQuery(
    originalQuestion: string,
    opts: { signal?: AbortSignal; requestId?: string } = {},
): Promise<ReformulatedQuery> {
    const fallback: ReformulatedQuery = {
        embeddingQuery: originalQuestion,
        ftsQuery: originalQuestion,
        mode: "text",
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
                    parts: [{ text: `<user_question>${originalQuestion}</user_question>` }],
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

    const eras = parseErasFromResponse(text);

    return { embeddingQuery, ftsQuery, mode, ...(eras ? { eras } : {}) };
}

/**
 * Parse, validate, and deduplicate the optional ERAS line. Returns
 * undefined (not present/applicable), or an array of ≥2 non-overlapping
 * parsed eras. Fewer than 2 valid eras after dedup → undefined.
 */
function parseErasFromResponse(
    text: string,
): import("@/src/lib/era-parser").Era[] | undefined {
    const match = text.match(/^ERAS:\s*(.+)$/m);
    if (!match) return undefined;

    let labels: unknown;
    try {
        labels = JSON.parse(match[1].trim());
    } catch {
        return undefined;
    }
    if (!Array.isArray(labels)) return undefined;

    // Parse each label through the deterministic era-parser.
    const parsed = labels
        .filter((l): l is string => typeof l === "string")
        .map((l) => parseEraLabel(l))
        .filter((e): e is import("@/src/lib/era-parser").Era => e !== null);

    if (parsed.length < 2) return undefined;

    // Collapse overlapping eras (>50% overlap → keep the wider one).
    const deduped = collapseOverlappingEras(parsed);
    return deduped.length >= 2 ? deduped : undefined;
}

function collapseOverlappingEras(
    eras: import("@/src/lib/era-parser").Era[],
): import("@/src/lib/era-parser").Era[] {
    const result = [...eras];
    for (let i = 0; i < result.length; i++) {
        for (let j = i + 1; j < result.length; j++) {
            if (eraOverlapFraction(result[i], result[j]) > 0.5) {
                // Keep the wider of the two.
                const iSpan = Date.parse(result[i].endDate) - Date.parse(result[i].startDate);
                const jSpan = Date.parse(result[j].endDate) - Date.parse(result[j].startDate);
                if (iSpan >= jSpan) {
                    result.splice(j, 1);
                } else {
                    result.splice(i, 1);
                }
                // Restart the inner loop after a splice.
                j = i;
            }
        }
    }
    return result;
}
