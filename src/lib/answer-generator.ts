/**
 * Answer Generator
 *
 * Uses Gemini Flash to synthesize a grounded answer from retrieved articles.
 * Every factual claim must cite a source article. If the sources don't contain
 * enough information, the model is instructed to say so honestly.
 */

import { getGeminiClient } from "@/src/lib/gemini-client";
import { recordUsage } from "@/src/lib/cost-tracker";
import type { RetrievedArticle } from "@/src/lib/db";
import type { RankedArticle } from "@/src/lib/reranker";
import type { Citation } from "@/src/types";

const GENERATION_MODEL = "gemini-3-flash-preview";
const MAX_ANSWER_TOKENS = 4096;
const GENERATION_TIMEOUT_MS = 15_000;
const MAX_SOURCE_CHARS = 5000;

// Confidence thresholds — calibrated for gemini-embedding-2-preview.
// Distance: lower = closer. Reranker score: 0–10, higher = more relevant.
const DIST_STRONG_MATCH = 0.26; // strong vector match
const DIST_WEAK_MATCH = 0.3; // above this = weak/off-topic
const RERANK_TANGENTIAL = 5; // below this = tangential or worse
const RERANK_MEDIUM = 6;
const RERANK_RELEVANT = 7;
const RERANK_CONFIDENT = 8;

// ─── Types ───────────────────────────────────────────────────────

export interface GeneratedAnswer {
    answer: string;
    citations: Citation[];
    confidence: "low" | "medium" | "high";
    followUps: string[];
}

/**
 * Stream events yielded by `generateAnswerStream`. Current shape: the
 * generator buffers the full JSON response from the LLM, then emits a
 * single `delta` event with the cleaned answer text immediately before
 * the `done` event. This is a deliberate change from token-by-token
 * streaming because the model now produces JSON, and emitting partial
 * JSON tokens would show the user raw JSON syntax. Progressive feedback
 * during loading is handled by the ResearchFeed component instead.
 */
export type AnswerStreamEvent =
    | { type: "delta"; text: string }
    | {
          type: "done";
          answer: string;
          citations: Citation[];
          confidence: "low" | "medium" | "high";
          followUps: string[];
      };

// ─── System Prompt ───────────────────────────────────────────────

function buildSystemPrompt(): string {
    return `You are "The Transcript Archive," a research assistant for The Transcript Archive — Ohio Wesleyan University's student newspaper, with archived editions from 1950 through 2006.

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
Respond with a JSON object with exactly two keys:
{
  "answer": "<your full answer>",
  "follow_ups": ["<question 1>", "<question 2>", "<question 3>"]
}

The "answer" string should begin with "Relevant sources: [Source N, Source M, ...]" on its own line listing only sources you actually cite, followed by a blank line, followed by your answer with inline [Source N] citations. Use ## section headers to organize multi-topic answers and paragraph breaks between distinct points. Do not use bullet points or numbered lists.

Markdown rules — the client renderer only understands a strict subset:
- Use ONLY ## for headings — never ### or deeper levels.
- Use **bold** for emphasis; never single-asterisk *italic* (it conflicts with the bullet markers the renderer strips).
- Do not begin any line with "* " or "- ". No bullets, no lists.

The "follow_ups" array must contain 2-3 follow-up questions (max 3) that:
- Are ≤ 100 characters each
- Reference specific facts, names, dates, or topics from the sources
- Can be answered from the 1950-2006 OWU archive (not about current events)
- Are concrete, not generic ("Tell me more" / "What else?" are forbidden)

Output ONLY the JSON object. No markdown fences. No text before or after.

EXAMPLES:

Question: "What sports teams did Ohio Wesleyan have in 1965?"
Sources: [Source 1] about the Battling Bishops football season, [Source 2] about basketball tryouts, [Source 3] about campus dining changes
Good response:
{"answer": "Relevant sources: [Source 1, Source 2]\\n\\nOhio Wesleyan's Battling Bishops competed in football during the fall 1965 season, finishing with a 5-3 record [Source 1]. The university also fielded a basketball team, with tryouts for the 1965-66 season drawing over 30 hopefuls to Branch Rickey Arena [Source 2].", "follow_ups": ["Who coached the 1965 Battling Bishops football team?", "What was the basketball team's record in 1965-66?", "How did Branch Rickey Arena get its name?"]}

Question: "Did OWU have a computer science department?"
Sources: [Source 1] about English department hiring, [Source 2] about library renovations
Good response:
{"answer": "Relevant sources: []\\n\\nI don't have enough information in the archive to answer this question. The sources I found cover English department hiring and library renovations, but none mention a computer science department.", "follow_ups": []}`;
}

/**
 * Parses the LLM's JSON response into `{ answer, followUps }`. Handles:
 *   - Bare JSON: `{"answer": "...", "follow_ups": [...]}`
 *   - Fenced JSON: \`\`\`json\\n{...}\\n\`\`\`
 *   - Malformed/empty output: returns raw text as answer, empty followUps
 */
export function parseAnswerResponse(rawText: string): {
    answer: string;
    followUps: string[];
} {
    const stripped = rawText
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/, "")
        .trim();

    try {
        const parsed = JSON.parse(stripped) as unknown;
        if (typeof parsed !== "object" || parsed === null) {
            throw new Error("not an object");
        }
        const obj = parsed as Record<string, unknown>;
        const answer = typeof obj.answer === "string" ? obj.answer : "";
        const rawFollowUps = Array.isArray(obj.follow_ups) ? obj.follow_ups : [];
        const followUps = rawFollowUps
            .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
            .slice(0, 3);
        if (!answer) throw new Error("missing answer field");
        return { answer, followUps };
    } catch (err) {
        console.warn(
            JSON.stringify({
                level: "warn",
                route: "/api/ask",
                stage: "generate",
                msg: "failed to parse JSON answer, using raw text",
                err: err instanceof Error ? err.message : String(err),
            }),
        );
        return { answer: rawText, followUps: [] };
    }
}

function buildUserPrompt(
    question: string,
    articles: RetrievedArticle[],
    conversationContext?: string,
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
${(a.bodyPlain || "").slice(0, MAX_SOURCE_CHARS)}`,
        )
        .join("\n\n");

    // Prior turns let the generator resolve pronouns ("that", "he", "the
    // one you mentioned") and maintain tone continuity. The reformulator
    // already rewrites the raw question to be self-contained; this block
    // is for continuity the rewrite can't capture.
    const historyBlock = conversationContext
        ? `CONVERSATION HISTORY:
${conversationContext}

`
        : "";

    return `${historyBlock}SOURCES:
${sourcesBlock}

<user_question>${question}</user_question>`;
}

// ─── Generation ──────────────────────────────────────────────────

export async function generateAnswer(
    question: string,
    sourceArticles: RankedArticle[],
    opts: {
        signal?: AbortSignal;
        requestId?: string;
        conversationContext?: string;
    } = {},
): Promise<GeneratedAnswer> {
    if (sourceArticles.length === 0) {
        return {
            answer:
                "I don't have enough information in the archive to answer this question.",
            citations: [],
            confidence: "low",
            followUps: [],
        };
    }

    // Compute confidence from vector distances + reranker scores. Pass null
    // for avgDistance when no vector results exist so computeConfidence uses
    // the FTS-only path instead of guessing a "medium" 0.27 default. The
    // hardcoded default capped FTS-only confidence at medium even when the
    // reranker scored articles 9/10. See docs/issues for the brittleness fix.
    const vectorArticles = sourceArticles.filter(
        (a): a is RankedArticle & { distance: number } =>
            (a.source === "vector" || a.source === "both") && a.distance !== null,
    );
    const avgDistance: number | null =
        vectorArticles.length > 0
            ? vectorArticles.reduce((s, a) => s + a.distance, 0) / vectorArticles.length
            : null;
    const avgRerankerScore =
        sourceArticles.reduce((s, a) => s + a.relevanceScore, 0) / sourceArticles.length;
    const confidence = computeConfidence(avgDistance, sourceArticles.length, avgRerankerScore);

    // If we have vector results AND they're all far away AND the reranker
    // agrees they're weak, skip the expensive Gemini call. Don't trigger
    // this for FTS-only paths because there's no distance to compare against.
    if (
        avgDistance !== null &&
        avgDistance > DIST_WEAK_MATCH &&
        avgRerankerScore < RERANK_TANGENTIAL
    ) {
        return {
            answer:
                "I don't have enough information in the archive to answer this question. The articles I found don't seem to be closely related to what you're asking about.",
            citations: [],
            confidence: "low",
            followUps: [],
        };
    }

    const client = getGeminiClient();
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(
        question,
        sourceArticles,
        opts.conversationContext,
    );

    // Generate with timeout
    const controller = new AbortController();
    const timeout = setTimeout(
        () => controller.abort(),
        GENERATION_TIMEOUT_MS,
    );

    const combinedSignal = opts.signal
        ? AbortSignal.any([opts.signal, controller.signal])
        : controller.signal;

    try {
        const response = await client.models.generateContent({
            model: GENERATION_MODEL,
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            config: {
                systemInstruction: systemPrompt,
                maxOutputTokens: MAX_ANSWER_TOKENS,
                temperature: 0.2, // low temperature for factual grounding
                thinkingConfig: { thinkingBudget: 0 },
                abortSignal: combinedSignal,
            },
        });

        clearTimeout(timeout);

        void recordUsage(GENERATION_MODEL, response.usageMetadata, {
            requestId: opts.requestId,
            op: "generate",
        });

        const rawText = response.text?.trim() ?? "";
        const { answer: parsedAnswer, followUps } = parseAnswerResponse(rawText);

        // Strip the CoT preamble ("Relevant sources: ...") before user-facing answer
        // Use \n* (zero or more) so missing newline doesn't leave preamble in answer
        const preambleStripped = parsedAnswer.replace(/^Relevant sources:[^\n]*\n*/, "").trim();

        // Strip out-of-bounds citation markers like [Source 6] when only 5 sources exist
        const maxSource = sourceArticles.length;
        const rawAnswer = preambleStripped.replace(
            /\[Source (\d+)\]/gi,
            (match, num) => (parseInt(num, 10) <= maxSource ? match : ""),
        ).replace(/\s+([.,;:])/g, "$1").trim();

        if (!rawAnswer) {
            return {
                answer:
                    "I wasn't able to generate an answer from the available sources. Please try rephrasing your question.",
                citations: [],
                confidence: "low",
                followUps: [],
            };
        }

        // Parse citations from the parsed answer (including preamble) so all referenced sources are captured
        const citations = parseCitations(parsedAnswer, sourceArticles);

        // Validate: if the LLM tried to reference sources but none were valid (e.g., cited
        // [Source 6] when only 5 exist), flag the answer as potentially unreliable.
        // Check the pre-stripped text so we can detect out-of-range citations the LLM attempted.
        const hadAnySourceRefs = /\[Source \d+\]/i.test(preambleStripped);
        const validatedConfidence =
            hadAnySourceRefs && citations.length === 0 ? "low" : confidence;

        return {
            answer: rawAnswer,
            citations,
            confidence: validatedConfidence,
            followUps,
        };
    } catch (err) {
        clearTimeout(timeout);

        if (err instanceof Error && err.name === "AbortError") {
            return {
                answer:
                    "The answer took too long to generate. Please try a simpler question.",
                citations: [],
                confidence: "low",
                followUps: [],
            };
        }

        console.error(
            JSON.stringify({
                level: "error",
                route: "/api/ask",
                requestId: opts.requestId,
                stage: "generate",
                msg: "answer generation failed",
                err: err instanceof Error ? err.message : String(err),
            }),
        );
        return {
            answer:
                "I encountered an error while generating an answer. Please try again.",
            citations: [],
            confidence: "low",
            followUps: [],
        };
    }
}

/**
 * Streaming version of `generateAnswer`. Yields `delta` events as Gemini
 * produces tokens (so the client can render a typing effect), followed by
 * a single `done` event with the cleaned answer and parsed citations.
 *
 * Semantically identical to `generateAnswer` on the happy path, and uses
 * the same confidence rubric, preamble stripping, and citation parsing.
 * On early-skip paths (no sources, distant retrieval), no deltas are
 * produced and a single `done` event with the skip message is yielded.
 *
 * IMPORTANT: the deltas are NOT user-facing raw tokens — the
 * "Relevant sources: ..." preamble is stripped before the first delta is
 * emitted, so the UI never shows the model's chain-of-thought line.
 */
export async function* generateAnswerStream(
    question: string,
    sourceArticles: RankedArticle[],
    opts: {
        signal?: AbortSignal;
        requestId?: string;
        conversationContext?: string;
    } = {},
): AsyncGenerator<AnswerStreamEvent, void, void> {
    if (sourceArticles.length === 0) {
        yield {
            type: "done",
            answer:
                "I don't have enough information in the archive to answer this question.",
            citations: [],
            confidence: "low",
            followUps: [],
        };
        return;
    }

    const vectorArticles = sourceArticles.filter(
        (a): a is RankedArticle & { distance: number } =>
            (a.source === "vector" || a.source === "both") && a.distance !== null,
    );
    const avgDistance: number | null =
        vectorArticles.length > 0
            ? vectorArticles.reduce((s, a) => s + a.distance, 0) / vectorArticles.length
            : null;
    const avgRerankerScore =
        sourceArticles.reduce((s, a) => s + a.relevanceScore, 0) /
        sourceArticles.length;
    const confidence = computeConfidence(
        avgDistance,
        sourceArticles.length,
        avgRerankerScore,
    );

    // Same skip-gemini guard as generateAnswer — distant AND weak reranker
    if (
        avgDistance !== null &&
        avgDistance > DIST_WEAK_MATCH &&
        avgRerankerScore < RERANK_TANGENTIAL
    ) {
        yield {
            type: "done",
            answer:
                "I don't have enough information in the archive to answer this question. The articles I found don't seem to be closely related to what you're asking about.",
            citations: [],
            confidence: "low",
            followUps: [],
        };
        return;
    }

    const client = getGeminiClient();
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(
        question,
        sourceArticles,
        opts.conversationContext,
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);

    const combinedSignal = opts.signal
        ? AbortSignal.any([opts.signal, controller.signal])
        : controller.signal;

    // Buffer the full stream before emitting — the model now returns JSON
    // and showing partial JSON tokens to the user would be noise. Perceived
    // progress during loading is handled by the ResearchFeed component.
    let fullText = "";
    // usageMetadata typically lands in the final streamed chunk; record
    // the last non-empty one so our counters reflect the whole call.
    let finalUsageMetadata: import("@google/genai").GenerateContentResponseUsageMetadata | undefined;

    try {
        const stream = await client.models.generateContentStream({
            model: GENERATION_MODEL,
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            config: {
                systemInstruction: systemPrompt,
                maxOutputTokens: MAX_ANSWER_TOKENS,
                temperature: 0.2,
                thinkingConfig: { thinkingBudget: 0 },
                abortSignal: combinedSignal,
            },
        });

        for await (const chunk of stream) {
            if (chunk.usageMetadata) finalUsageMetadata = chunk.usageMetadata;
            const chunkText =
                typeof chunk.text === "string" ? chunk.text : "";
            if (!chunkText) continue;
            fullText += chunkText;
        }

        clearTimeout(timeout);

        void recordUsage(GENERATION_MODEL, finalUsageMetadata, {
            requestId: opts.requestId,
            op: "generate.stream",
        });

        const { answer: parsedAnswer, followUps } = parseAnswerResponse(fullText);

        const preambleStripped = parsedAnswer
            .replace(/^Relevant sources:[^\n]*\n*/, "")
            .trim();
        const maxSource = sourceArticles.length;
        const rawAnswer = preambleStripped
            .replace(/\[Source (\d+)\]/gi, (match, num) =>
                parseInt(num, 10) <= maxSource ? match : "",
            )
            .replace(/\s+([.,;:])/g, "$1")
            .trim();

        if (!rawAnswer) {
            yield {
                type: "done",
                answer:
                    "I wasn't able to generate an answer from the available sources. Please try rephrasing your question.",
                citations: [],
                confidence: "low",
                followUps: [],
            };
            return;
        }

        const citations = parseCitations(parsedAnswer, sourceArticles);
        const hadAnySourceRefs = /\[Source \d+\]/i.test(preambleStripped);
        const validatedConfidence =
            hadAnySourceRefs && citations.length === 0 ? "low" : confidence;

        // Emit the cleaned answer as a single delta immediately before done
        // so consumers get the final text through the same event channel.
        yield { type: "delta", text: rawAnswer };

        yield {
            type: "done",
            answer: rawAnswer,
            citations,
            confidence: validatedConfidence,
            followUps,
        };
    } catch (err) {
        clearTimeout(timeout);

        if (err instanceof Error && err.name === "AbortError") {
            yield {
                type: "done",
                answer:
                    "The answer took too long to generate. Please try a simpler question.",
                citations: [],
                confidence: "low",
                followUps: [],
            };
            return;
        }

        console.error(
            JSON.stringify({
                level: "error",
                route: "/api/ask",
                requestId: opts.requestId,
                stage: "generate",
                msg: "answer stream generation failed",
                err: err instanceof Error ? err.message : String(err),
            }),
        );
        yield {
            type: "done",
            answer:
                "I encountered an error while generating an answer. Please try again.",
            citations: [],
            confidence: "low",
            followUps: [],
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
    avgDistance: number | null,
    articleCount: number,
    avgRerankerScore: number,
): "low" | "medium" | "high" {
    // FTS-only path: no vector results to ground confidence in distance.
    // Use the reranker score as the primary signal instead of inventing a
    // fake "medium" default distance, which used to cap FTS-only confidence
    // at medium even with strong reranker scores.
    if (avgDistance === null) {
        if (avgRerankerScore >= RERANK_CONFIDENT) return "high";
        if (avgRerankerScore >= RERANK_TANGENTIAL) return "medium";
        return "low";
    }

    // Vector-aware path. Thresholds calibrated for gemini-embedding-2-preview
    // distance distribution:
    // - Strong matches: < DIST_STRONG_MATCH (protests, Greek life, cagers)
    // - Good matches: DIST_STRONG_MATCH – DIST_WEAK_MATCH (food, war, general topics)
    // - Weak matches: > DIST_WEAK_MATCH (quantum physics, off-topic)
    //
    // Reranker scores (0-10) provide an independent relevance signal:
    // - RERANK_RELEVANT: reranker is confident articles are relevant
    // - RERANK_TANGENTIAL: somewhat relevant
    // - below RERANK_TANGENTIAL: tangential or worse
    if (avgDistance < DIST_STRONG_MATCH && avgRerankerScore >= RERANK_RELEVANT && articleCount >= 2) return "high";
    if (avgRerankerScore >= RERANK_CONFIDENT && articleCount >= 2) return "high"; // strong reranker rescues mediocre distance
    if (avgDistance < DIST_WEAK_MATCH && avgRerankerScore >= RERANK_TANGENTIAL) return "medium";
    if (avgRerankerScore >= RERANK_MEDIUM) return "medium";
    return "low";
}
