/**
 * Answer Generator
 *
 * Uses Gemini Flash to synthesize a grounded answer from retrieved articles.
 * Every factual claim must cite a source article. If the sources don't contain
 * enough information, the model is instructed to say so honestly.
 */

import { getGeminiClient } from "@/src/lib/gemini-client";
import { recordUsage } from "@/src/lib/cost-tracker";
import { RAG_MODEL_CONFIG } from "@/src/lib/rag-model-config";
import type { RetrievedArticle } from "@/src/lib/db";
import type { RankedArticle } from "@/src/lib/reranker";
import type { Citation } from "@/src/types";

const GENERATION_MODEL = RAG_MODEL_CONFIG.answer.model;
// Thinking tokens share the output-token ceiling. MEDIUM reasoning consumed
// nearly the old 4,096-token limit in a live housing synthesis and truncated
// the JSON envelope, so leave enough room for both reasoning and the answer.
const MAX_ANSWER_TOKENS = 8192;
const GENERATION_TIMEOUT_MS = 15_000;
const MAX_SOURCE_CHARS = 5000;

// Confidence uses verified citations and the model-independent 0–10 reranker
// rubric. Raw cosine thresholds are deliberately excluded because they drift
// when an embedding model or document representation changes.
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
5. Provide thorough, focused answers. Use 1-2 paragraphs for simple questions and multiple paragraphs for complex ones. Synthesize information across sources without repeating the same point.
6. Use past tense when describing historical events.
7. Preserve exact names, dates, and figures from the sources — do not paraphrase numbers or proper nouns.
8. If multiple sources discuss the same topic, synthesize them and cite all relevant sources.
9. Never make up quotes, statistics, or events not explicitly stated in the sources.

IMAGES:
- Some sources list an "Images:" block after their text. Each image has a caption (or "Untitled photo") and a URL.
- When a specific image visually illustrates a point you are making, you MAY embed it inline using markdown: \`![short alt](exact-url-from-source)\`. Place the embed immediately after the first [Source N] citation of that source.
- Use the URL EXACTLY as shown in the Images block — do not modify, shorten, or invent URLs.
- Do not invent captions, subjects, or people that are not stated in the caption or article body.
- Cap inline image embeds at 3 per answer. Do not embed the same image twice.
- If no image meaningfully illustrates the claim, omit the embed and continue in prose.

RESPONSE FORMAT:
Respond with a JSON object with exactly two keys:
{
  "answer": "<your full answer>",
  "follow_ups": ["<question 1>", "<question 2>", "<question 3>"]
}

The "answer" string must contain only the user-facing answer with inline [Source N] citations. Use ## section headers to organize multi-topic answers and paragraph breaks between distinct points. Do not include a hidden source inventory or reasoning preamble. Do not use bullet points or numbered lists.

Markdown rules — the client renderer only understands a strict subset:
- Use ONLY ## for headings — never ### or deeper levels.
- Use **bold** for emphasis; never single-asterisk *italic* (it conflicts with the bullet markers the renderer strips).
- Do not begin any line with "* " or "- ". No bullets, no lists.
- Image embeds \`![alt](url)\` are allowed ONLY when the URL appears verbatim in a source's Images block.

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
{"answer": "Ohio Wesleyan's Battling Bishops competed in football during the fall 1965 season, finishing with a 5-3 record [Source 1]. The university also fielded a basketball team, with tryouts for the 1965-66 season drawing over 30 hopefuls to Branch Rickey Arena [Source 2].", "follow_ups": ["Who coached the 1965 Battling Bishops football team?", "What was the basketball team's record in 1965-66?", "How did Branch Rickey Arena get its name?"]}

Question: "Did OWU have a computer science department?"
Sources: [Source 1] about English department hiring, [Source 2] about library renovations
Good response:
{"answer": "I don't have enough information in the archive to answer this question. The sources I found cover English department hiring and library renovations, but none mention a computer science department.", "follow_ups": []}`;
}

const ANSWER_SCHEMA = {
    type: "object",
    properties: {
        answer: { type: "string", maxLength: 12000 },
        follow_ups: {
            type: "array",
            items: { type: "string", maxLength: 100 },
            maxItems: 3,
        },
    },
    required: ["answer", "follow_ups"],
    additionalProperties: false,
} as const;

/**
 * Parses the LLM's JSON response into `{ answer, followUps }`. Handles:
 *   - Bare JSON: `{"answer": "...", "follow_ups": [...]}`
 *   - Fenced JSON: \`\`\`json\\n{...}\\n\`\`\`
 *   - Truncated JSON after a complete answer field: recovers that answer
 *   - Plain legacy text: returns the text as the answer
 *   - Malformed structured output: returns an empty answer, never raw JSON
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
        const recoveredAnswer = extractCompleteJsonStringProperty(
            stripped,
            "answer",
        );
        const looksStructured = stripped.startsWith("{") || stripped.startsWith("[");
        console.warn(
            JSON.stringify({
                level: "warn",
                route: "/api/ask",
                stage: "generate",
                msg: recoveredAnswer
                    ? "recovered answer from incomplete JSON envelope"
                    : looksStructured
                      ? "discarded malformed structured answer"
                      : "received legacy plain-text answer",
                err: err instanceof Error ? err.message : String(err),
            }),
        );
        return {
            answer: recoveredAnswer ?? (looksStructured ? "" : rawText.trim()),
            followUps: [],
        };
    }
}

/** Extract one complete JSON string property without accepting partial text. */
function extractCompleteJsonStringProperty(
    json: string,
    property: string,
): string | null {
    const marker = new RegExp(`"${property}"\\s*:\\s*"`).exec(json);
    if (!marker) return null;
    const openingQuote = marker.index + marker[0].length - 1;
    let escaped = false;
    for (let i = openingQuote + 1; i < json.length; i += 1) {
        const char = json[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === "\\\\") {
            escaped = true;
            continue;
        }
        if (char !== '"') continue;
        try {
            const decoded = JSON.parse(json.slice(openingQuote, i + 1));
            return typeof decoded === "string" && decoded.length > 0
                ? decoded
                : null;
        } catch {
            return null;
        }
    }
    return null;
}

// R2 keys can contain spaces (e.g. "0003_Page 3_img1.webp"), which browsers
// accept in <img src> but CommonMark rejects inside `![](...)`. Idempotent
// space→%20 escape keeps the URL parseable without double-encoding existing
// %-escapes.
function mdSafeUrl(url: string): string {
    return url.replace(/ /g, "%20");
}

function formatImagesBlock(a: RetrievedArticle): string {
    if (!a.imageUrls || a.imageUrls.length === 0) return "";
    const lines = a.imageUrls.map((url, idx) => {
        const caption = a.imageCaptions?.[idx] ?? null;
        const label = caption && caption.trim().length > 0
            ? `[${caption.trim()}]`
            : "[Untitled photo]";
        return `  ${idx + 1}. ${label} — ${mdSafeUrl(url)}`;
    });
    return `\nImages:\n${lines.join("\n")}`;
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
${sourceEvidenceText(a)}${formatImagesBlock(a)}`,
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

USER QUESTION (JSON string): ${JSON.stringify(question)}`;
}

function sourceEvidenceText(article: RetrievedArticle): string {
    if (article.matchedPassages && article.matchedPassages.length > 0) {
        return article.matchedPassages
            .map((passage, index) => `[Relevant passage ${index + 1}]\n${passage}`)
            .join("\n\n");
    }

    const body = article.bodyPlain || "";
    if (body.length <= MAX_SOURCE_CHARS) return body;

    // Legacy fallback while chunk embeddings are being backfilled: retain
    // both ends instead of silently discarding every paragraph after 5k.
    const half = Math.floor((MAX_SOURCE_CHARS - 80) / 2);
    return `${body.slice(0, half)}\n\n[…middle omitted until chunk backfill…]\n\n${body.slice(-half)}`;
}

function logNonStopFinishReason(
    finishReason: string | undefined,
    requestId: string | undefined,
    op: "generate" | "generate.stream",
): void {
    if (!finishReason || finishReason === "STOP") return;
    console.warn(
        JSON.stringify({
            level: "warn",
            route: "/api/ask",
            requestId,
            stage: "generate",
            op,
            msg: "model response ended without a normal stop",
            finishReason,
        }),
    );
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

    if (avgRerankerScore < RERANK_TANGENTIAL) {
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
                thinkingConfig: {
                    thinkingLevel: RAG_MODEL_CONFIG.answer.thinkingLevel,
                },
                responseMimeType: "application/json",
                responseJsonSchema: ANSWER_SCHEMA,
                abortSignal: combinedSignal,
            },
        });

        clearTimeout(timeout);

        void recordUsage(GENERATION_MODEL, response.usageMetadata, {
            requestId: opts.requestId,
            op: "generate",
        });
        logNonStopFinishReason(
            response.candidates?.[0]?.finishReason,
            opts.requestId,
            "generate",
        );

        const rawText = response.text?.trim() ?? "";
        const { answer: parsedAnswer, followUps } = parseAnswerResponse(rawText);

        // Backward compatibility for responses recorded before structured output
        // removed the non-user-facing source inventory.
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

        // Only visible inline references count. A source mentioned solely in a
        // discarded preamble can no longer pollute the citation list.
        const citations = parseCitations(rawAnswer, sourceArticles);
        const validatedConfidence = confidenceForCitations(
            rawAnswer,
            sourceArticles,
            citations,
            confidence,
        );

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

    if (avgRerankerScore < RERANK_TANGENTIAL) {
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
    let finalFinishReason: string | undefined;

    try {
        const stream = await client.models.generateContentStream({
            model: GENERATION_MODEL,
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            config: {
                systemInstruction: systemPrompt,
                maxOutputTokens: MAX_ANSWER_TOKENS,
                thinkingConfig: {
                    thinkingLevel: RAG_MODEL_CONFIG.answer.thinkingLevel,
                },
                responseMimeType: "application/json",
                responseJsonSchema: ANSWER_SCHEMA,
                abortSignal: combinedSignal,
            },
        });

        for await (const chunk of stream) {
            if (chunk.usageMetadata) finalUsageMetadata = chunk.usageMetadata;
            const finishReason = chunk.candidates?.[0]?.finishReason;
            if (finishReason) finalFinishReason = finishReason;
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
        logNonStopFinishReason(
            finalFinishReason,
            opts.requestId,
            "generate.stream",
        );

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

        const citations = parseCitations(rawAnswer, sourceArticles);
        const validatedConfidence = confidenceForCitations(
            rawAnswer,
            sourceArticles,
            citations,
            confidence,
        );

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

function confidenceForCitations(
    answer: string,
    sourceArticles: RankedArticle[],
    citations: Citation[],
    retrievalConfidence: "low" | "medium" | "high",
): "low" | "medium" | "high" {
    if (/don['’]t have enough information/i.test(answer)) return "low";
    if (citations.length === 0) return "low";

    const citedIds = new Set(citations.map((citation) => citation.articleId));
    const citedArticles = sourceArticles.filter((article) => citedIds.has(article.id));
    if (citedArticles.length !== citations.length) return "low";

    const averageRerankerScore =
        citedArticles.reduce((sum, article) => sum + article.relevanceScore, 0) /
        citedArticles.length;
    const vectorArticles = citedArticles.filter(
        (article): article is RankedArticle & { distance: number } =>
            article.distance !== null &&
            (article.source === "vector" || article.source === "both"),
    );
    const averageDistance =
        vectorArticles.length > 0
            ? vectorArticles.reduce((sum, article) => sum + article.distance, 0) /
              vectorArticles.length
            : null;
    const citedConfidence = computeConfidence(
        averageDistance,
        citedArticles.length,
        averageRerankerScore,
    );

    const rank = { low: 0, medium: 1, high: 2 } as const;
    const lower =
        rank[citedConfidence] < rank[retrievalConfidence]
            ? citedConfidence
            : retrievalConfidence;

    // One verified source can support a useful answer, but not broad
    // high-confidence synthesis.
    return citations.length === 1 && lower === "high" ? "medium" : lower;
}

// ─── Confidence ──────────────────────────────────────────────────

function computeConfidence(
    _avgDistance: number | null,
    articleCount: number,
    avgRerankerScore: number,
): "low" | "medium" | "high" {
    if (avgRerankerScore >= RERANK_CONFIDENT && articleCount >= 2) return "high";
    if (avgRerankerScore >= RERANK_RELEVANT && articleCount >= 3) return "high";
    if (avgRerankerScore >= RERANK_MEDIUM) return "medium";
    if (avgRerankerScore >= RERANK_TANGENTIAL) return "medium";
    return "low";
}
