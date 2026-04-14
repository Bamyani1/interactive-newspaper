/**
 * Answer Generator
 *
 * Uses Gemini Flash to synthesize a grounded answer from retrieved articles.
 * Every factual claim must cite a source article. If the sources don't contain
 * enough information, the model is instructed to say so honestly.
 */

import { getGeminiClient } from "@/src/lib/gemini-client";
import type { RetrievedArticle } from "@/src/lib/db";
import type { RankedArticle } from "@/src/lib/reranker";
import type { Citation } from "@/src/types";

const GENERATION_MODEL = "gemini-3-flash-preview";
const MAX_ANSWER_TOKENS = 4096;
const GENERATION_TIMEOUT_MS = 15_000;
const MAX_SOURCE_CHARS = 5000;

// ─── Types ───────────────────────────────────────────────────────

export interface GeneratedAnswer {
    answer: string;
    citations: Citation[];
    confidence: "low" | "medium" | "high";
}

/**
 * Stream events yielded by `generateAnswerStream`. A stream produces zero
 * or more `delta` events (partial token text, already stripped of the
 * "Relevant sources:" preamble) followed by exactly one `done` event with
 * the final cleaned answer, citations, and confidence. Consumers should
 * accumulate deltas for immediate UI feedback and then replace the full
 * answer with `done.answer` when it arrives (server strips out-of-range
 * citations and normalizes whitespace that may have been visible in the
 * streamed deltas).
 */
export type AnswerStreamEvent =
    | { type: "delta"; text: string }
    | {
          type: "done";
          answer: string;
          citations: Citation[];
          confidence: "low" | "medium" | "high";
      };

// ─── System Prompt ───────────────────────────────────────────────

function buildSystemPrompt(): string {
    return `You are "The Transcript Archive," a research assistant for The Transcript Archive — Ohio Wesleyan University's student newspaper, with archived editions from 1960 through 2000.

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
Then write a blank line, followed by your answer with inline [Source N] citations.
Use ## section headers to organize the answer by topic when covering multiple subjects. Use paragraph breaks between distinct points. Do not use bullet points or numbered lists.

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

<user_question>${question}</user_question>`;
}

// ─── Generation ──────────────────────────────────────────────────

export async function generateAnswer(
    question: string,
    sourceArticles: RankedArticle[],
    opts: { signal?: AbortSignal } = {},
): Promise<GeneratedAnswer> {
    if (sourceArticles.length === 0) {
        return {
            answer:
                "I don't have enough information in the archive to answer this question.",
            citations: [],
            confidence: "low",
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
    if (avgDistance !== null && avgDistance > 0.30 && avgRerankerScore < 5) {
        return {
            answer:
                "I don't have enough information in the archive to answer this question. The articles I found don't seem to be closely related to what you're asking about.",
            citations: [],
            confidence: "low",
        };
    }

    const client = getGeminiClient();
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(question, sourceArticles);

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

        const rawText = response.text?.trim() ?? "";

        // Strip the CoT preamble ("Relevant sources: ...") before user-facing answer
        // Use \n* (zero or more) so missing newline doesn't leave preamble in answer
        const preambleStripped = rawText.replace(/^Relevant sources:[^\n]*\n*/, "").trim();

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
            };
        }

        // Parse citations from the full text (including preamble) so all referenced sources are captured
        const citations = parseCitations(rawText, sourceArticles);

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
    opts: { signal?: AbortSignal } = {},
): AsyncGenerator<AnswerStreamEvent, void, void> {
    if (sourceArticles.length === 0) {
        yield {
            type: "done",
            answer:
                "I don't have enough information in the archive to answer this question.",
            citations: [],
            confidence: "low",
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
    if (avgDistance !== null && avgDistance > 0.30 && avgRerankerScore < 5) {
        yield {
            type: "done",
            answer:
                "I don't have enough information in the archive to answer this question. The articles I found don't seem to be closely related to what you're asking about.",
            citations: [],
            confidence: "low",
        };
        return;
    }

    const client = getGeminiClient();
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(question, sourceArticles);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);

    const combinedSignal = opts.signal
        ? AbortSignal.any([opts.signal, controller.signal])
        : controller.signal;

    let fullText = "";
    // Character offset in fullText past which content has been emitted as
    // deltas. Stays 0 until the preamble decision is resolved, then tracks
    // the end of the preamble + any emitted output.
    let emittedLen = 0;
    // Null = undecided. Number = offset in fullText where the stream
    // content starts (after the preamble, if any).
    let preambleOffset: number | null = null;
    const PREAMBLE_SIGNATURE_MAX = 256;

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
            const chunkText =
                typeof chunk.text === "string" ? chunk.text : "";
            if (!chunkText) continue;
            fullText += chunkText;

            // Resolve the preamble offset as soon as we can. The three
            // resolution cases:
            //   1. fullText matches "Relevant sources: ...\n" → offset = end
            //      of that match. Emit nothing further in this chunk unless
            //      there's content past the match.
            //   2. fullText doesn't start with "Relevant" (case-insensitive)
            //      → there's no preamble. offset = 0.
            //   3. fullText is > PREAMBLE_SIGNATURE_MAX chars but still no
            //      match AND it does start with "Relevant" — the model
            //      produced something weird. Treat as offset=0 and emit.
            if (preambleOffset === null) {
                const match = fullText.match(/^Relevant sources:[^\n]*\n+/i);
                if (match) {
                    preambleOffset = match[0].length;
                } else if (!/^Relevant/i.test(fullText)) {
                    preambleOffset = 0;
                } else if (fullText.length > PREAMBLE_SIGNATURE_MAX) {
                    preambleOffset = 0;
                } else {
                    // Still buffering possible preamble — wait for more tokens
                    continue;
                }
            }

            const visibleLen = fullText.length - preambleOffset;
            if (visibleLen > emittedLen) {
                const delta = fullText.slice(
                    preambleOffset + emittedLen,
                    preambleOffset + visibleLen,
                );
                yield { type: "delta", text: delta };
                emittedLen = visibleLen;
            }
        }

        clearTimeout(timeout);

        // Final cleanup pass — identical to generateAnswer's post-processing.
        const preambleStripped = fullText
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
            };
            return;
        }

        const citations = parseCitations(fullText, sourceArticles);
        const hadAnySourceRefs = /\[Source \d+\]/i.test(preambleStripped);
        const validatedConfidence =
            hadAnySourceRefs && citations.length === 0 ? "low" : confidence;

        yield {
            type: "done",
            answer: rawAnswer,
            citations,
            confidence: validatedConfidence,
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
            };
            return;
        }

        console.error("Answer stream generation failed:", err);
        yield {
            type: "done",
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
    avgDistance: number | null,
    articleCount: number,
    avgRerankerScore: number,
): "low" | "medium" | "high" {
    // FTS-only path: no vector results to ground confidence in distance.
    // Use the reranker score as the primary signal instead of inventing a
    // fake "medium" default distance, which used to cap FTS-only confidence
    // at medium even with strong reranker scores.
    if (avgDistance === null) {
        if (avgRerankerScore >= 8) return "high";
        if (avgRerankerScore >= 5) return "medium";
        return "low";
    }

    // Vector-aware path. Thresholds calibrated for gemini-embedding-2-preview
    // distance distribution:
    // - Strong matches: < 0.24 (protests, Greek life, cagers)
    // - Good matches: 0.24 - 0.30 (food, war, general topics)
    // - Weak matches: > 0.30 (quantum physics, off-topic)
    //
    // Reranker scores (0-10) provide an independent relevance signal:
    // - >=7: reranker is confident articles are relevant
    // - >=5: somewhat relevant
    // - <5: tangential or worse
    if (avgDistance < 0.26 && avgRerankerScore >= 7 && articleCount >= 2) return "high";
    if (avgRerankerScore >= 8 && articleCount >= 2) return "high"; // strong reranker rescues mediocre distance
    if (avgDistance < 0.30 && avgRerankerScore >= 5) return "medium";
    if (avgRerankerScore >= 6) return "medium";
    return "low";
}
