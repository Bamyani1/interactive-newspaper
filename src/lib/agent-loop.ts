/**
 * Agent Loop
 *
 * Constrained Gemini function-calling loop for complex RAG questions.
 * The model iteratively searches the newspaper archive, reads articles,
 * and synthesises a cited answer. Capped at 5 rounds with AbortSignal
 * deadline support.
 */

import type { Content, FunctionDeclaration, Part } from "@google/genai";
import { getGeminiClient } from "@/src/lib/gemini-client";
import { recordUsage } from "@/src/lib/cost-tracker";
import { AGENT_TOOL_DECLARATIONS, executeTool } from "@/src/lib/agent-tools";
import type { Citation } from "@/src/types";

// ─── Constants ──────────────────────────────────────────────────

const AGENT_MODEL = "gemini-3-flash-preview";
const MAX_ROUNDS = 8;
const MAX_OUTPUT_TOKENS = 4096;
const MAX_BODY_CHARS_IN_CONTEXT = 3000;
const MAX_EXCERPT_CHARS_IN_CONTEXT = 300;

const AGENT_SYSTEM_PROMPT = `You are "The Transcript Archive," a research assistant for Ohio Wesleyan University's student newspaper archive (1950-2006).

Plan your research strategy before searching. Use the search_archive tool to find relevant articles. Use read_article to get full text when a headline looks promising. Use list_editions to understand what date ranges have coverage.

RULES:
1. Answer ONLY from retrieved articles. Never use outside knowledge.
2. CITE every factual claim using [Article ID] format (e.g., [1965-03-15-4]).
3. If you cannot find enough information, say so honestly.
4. You may search multiple times with different queries to build a complete answer.
5. For questions spanning multiple eras, issue MULTIPLE search_archive calls in a SINGLE response to search different decades simultaneously. This is critical for efficiency.
6. Use past tense for historical events.
7. Never fabricate quotes or statistics.
8. Aim to gather all sources within 2-3 rounds, then write your answer. Do not spend more than 4 rounds searching.

IMAGES:
- search_archive and read_article results may include imageUrls (array of URLs) and imageCaptions (parallel array of captions, some may be null).
- When a specific image visually illustrates a point you are making, you MAY embed it inline in your answer with markdown \`![short alt](exact-url)\` immediately after the first [Article ID] citation of that article.
- Use the URL EXACTLY as returned by the tool — never modify, shorten, or invent URLs.
- Do not invent captions or describe image content not grounded in the caption or article body.
- Cap inline image embeds at 3 per answer. Never embed the same image twice.
- If no image meaningfully illustrates a claim, omit the embed and continue in prose.

MARKDOWN: Use \`##\` for headings (never deeper), \`**bold**\` for emphasis, no bullets or lists, and \`![alt](url)\` ONLY with URLs returned by the tools.`;

// ─── Types ──────────────────────────────────────────────────────

export interface ArticleMeta {
    headline: string;
    editionDate: string;
    category: string;
    summary: string;
    byline: string | null;
    bodySnippet: string;
    imageUrls: string[];
    imageCaptions: (string | null)[];
}

export interface AgentResult {
    answer: string;
    citations: Citation[];
    confidence: "low" | "medium" | "high";
    toolCallCount: number;
    rounds: number;
    articleMeta: Map<string, ArticleMeta>;
}

export interface AgentProgressEvent {
    type: "tool_call" | "tool_result";
    tool: string;
    round: number;
    args?: Record<string, unknown>;
    summary?: string;
}

// ─── Citation Parsing ───────────────────────────────────────────

const CITATION_RE = /\[(\d{4}-\d{2}-\d{2}-\d+)\]/g;

export function parseCitations(
    text: string,
    articleLookup: Map<string, ArticleMeta>,
): Citation[] {
    const seen = new Set<string>();
    const citations: Citation[] = [];

    let match;
    while ((match = CITATION_RE.exec(text)) !== null) {
        const articleId = match[1];
        if (seen.has(articleId)) continue;
        seen.add(articleId);

        const meta = articleLookup.get(articleId);
        citations.push({
            articleId,
            headline: meta?.headline ?? articleId,
            editionDate: meta?.editionDate ?? articleId.slice(0, 10),
        });
    }

    return citations;
}

// ─── Confidence Scoring ─────────────────────────────────────────

export function scoreConfidence(
    answer: string,
    citations: Citation[],
    toolCallCount: number,
): "low" | "medium" | "high" {
    if (toolCallCount === 0) return "low";
    if (/don[''\u2019]t have enough information/i.test(answer)) return "low";
    if (citations.length >= 3) return "high";
    if (citations.length >= 1) return "medium";
    return "low";
}

// ─── Article Lookup Accumulator ─────────────────────────────────

export function accumulateArticleMeta(
    toolName: string,
    result: Record<string, unknown>,
    lookup: Map<string, ArticleMeta>,
): void {
    if (toolName === "search_archive" && Array.isArray(result.results)) {
        for (const r of result.results) {
            const rec = r as Record<string, unknown>;
            if (typeof rec.id === "string" && typeof rec.headline === "string") {
                lookup.set(rec.id, {
                    headline: rec.headline as string,
                    editionDate: (rec.editionDate as string) ?? (rec.id as string).slice(0, 10),
                    category: (rec.category as string) ?? "",
                    summary: (rec.summary as string) ?? "",
                    byline: (rec.byline as string) ?? null,
                    bodySnippet: typeof rec.excerpt === "string" ? (rec.excerpt as string).slice(0, 300) : "",
                    imageUrls: Array.isArray(rec.imageUrls) ? (rec.imageUrls as string[]) : [],
                    imageCaptions: Array.isArray(rec.imageCaptions) ? (rec.imageCaptions as (string | null)[]) : [],
                });
            }
        }
    }

    if (toolName === "read_article" && typeof result.id === "string") {
        lookup.set(result.id as string, {
            headline: (result.headline as string) ?? (result.id as string),
            editionDate: (result.editionDate as string) ?? (result.id as string).slice(0, 10),
            category: (result.category as string) ?? "",
            summary: (result.summary as string) ?? "",
            byline: (result.byline as string) ?? null,
            bodySnippet: typeof result.bodyPlain === "string" ? (result.bodyPlain as string).slice(0, 300) : "",
            imageUrls: Array.isArray(result.imageUrls) ? (result.imageUrls as string[]) : [],
            imageCaptions: Array.isArray(result.imageCaptions) ? (result.imageCaptions as (string | null)[]) : [],
        });
    }
}

// ─── Tool Result Truncation ─────────────────────────────────────

function truncateToolResult(
    toolName: string,
    result: Record<string, unknown>,
): Record<string, unknown> {
    if (toolName === "read_article" && typeof result.bodyPlain === "string") {
        return {
            ...result,
            bodyPlain: (result.bodyPlain as string).slice(0, MAX_BODY_CHARS_IN_CONTEXT),
        };
    }

    if (toolName === "search_archive" && Array.isArray(result.results)) {
        return {
            ...result,
            results: (result.results as Record<string, unknown>[]).map((r) => ({
                ...r,
                excerpt: typeof r.excerpt === "string"
                    ? (r.excerpt as string).slice(0, MAX_EXCERPT_CHARS_IN_CONTEXT)
                    : r.excerpt,
            })),
        };
    }

    return result;
}

// ─── Tool Result Summary (for SSE progress events) ─────────────

function summarizeToolResult(
    toolName: string,
    result: Record<string, unknown>,
): string {
    if (result.error) return `Error: ${result.error}`;
    if (toolName === "search_archive" && Array.isArray(result.results)) {
        return `Found ${result.results.length} articles`;
    }
    if (toolName === "read_article" && typeof result.headline === "string") {
        return `Read: ${result.headline}`;
    }
    if (toolName === "list_editions" && Array.isArray(result.editions)) {
        return `${result.editions.length} editions`;
    }
    return "Done";
}

// ─── Structured Logging Helper ──────────────────────────────────

function logWarn(requestId: string | undefined, msg: string, extra?: Record<string, unknown>): void {
    console.warn(JSON.stringify({
        level: "warn",
        route: "/api/ask",
        requestId,
        stage: "agent",
        msg,
        ...extra,
    }));
}

function logError(requestId: string | undefined, msg: string, err: unknown): void {
    console.error(JSON.stringify({
        level: "error",
        route: "/api/ask",
        requestId,
        stage: "agent",
        msg,
        err: err instanceof Error ? err.message : String(err),
    }));
}

// ─── Main Loop ──────────────────────────────────────────────────

export async function runAgentLoop(
    question: string,
    opts: {
        signal?: AbortSignal;
        requestId?: string;
        conversationContext?: string;
        onProgress?: (event: AgentProgressEvent) => void;
    } = {},
): Promise<AgentResult> {
    const { signal, requestId, conversationContext, onProgress } = opts;

    const client = getGeminiClient();
    const articleLookup = new Map<string, ArticleMeta>();

    const userText = conversationContext
        ? `${conversationContext}\n\n${question}`
        : question;

    const contents: Content[] = [
        { role: "user", parts: [{ text: userText }] },
    ];

    let round = 0;
    let toolCallCount = 0;
    let answerText = "";

    try {
        while (round < MAX_ROUNDS) {
            if (signal?.aborted) {
                return {
                    answer: "The request timed out before a complete answer could be generated. Please try a simpler question.",
                    citations: [],
                    confidence: "low",
                    toolCallCount,
                    rounds: round,
                    articleMeta: articleLookup,
                };
            }

            const response = await client.models.generateContent({
                model: AGENT_MODEL,
                contents,
                config: {
                    systemInstruction: AGENT_SYSTEM_PROMPT,
                    tools: [{ functionDeclarations: AGENT_TOOL_DECLARATIONS as FunctionDeclaration[] }],
                    maxOutputTokens: MAX_OUTPUT_TOKENS,
                    temperature: 0.2,
                    thinkingConfig: { thinkingBudget: 0 },
                    abortSignal: signal,
                },
            });

            void recordUsage(AGENT_MODEL, response.usageMetadata, {
                requestId,
                op: `agent.round${round}`,
            });

            const functionCalls = response.functionCalls;

            if (functionCalls && functionCalls.length > 0) {
                const results = await Promise.all(
                    functionCalls.map(async (call, idx) => {
                        onProgress?.({
                            type: "tool_call",
                            tool: call.name!,
                            round,
                            args: call.args as Record<string, unknown> | undefined,
                        });

                        const toolResult = await executeTool(
                            call.name!,
                            call.args ?? {},
                            { signal },
                        );

                        accumulateArticleMeta(call.name!, toolResult, articleLookup);

                        if (toolResult.error) {
                            logWarn(requestId, `tool ${call.name} returned error`, {
                                tool: call.name,
                                round,
                                error: toolResult.error,
                            });
                        }

                        const summary = summarizeToolResult(call.name!, toolResult);
                        onProgress?.({
                            type: "tool_result",
                            tool: call.name!,
                            round,
                            summary,
                        });

                        return {
                            id: call.id ?? `${call.name}-${round}-${idx}`,
                            name: call.name!,
                            response: truncateToolResult(call.name!, toolResult),
                        };
                    }),
                );

                const allErrors = results.every((r) =>
                    typeof (r.response as Record<string, unknown>).error === "string",
                );
                if (allErrors) {
                    logError(requestId, "all tools in round returned errors", { round });
                }

                toolCallCount += functionCalls.length;

                // Capture any text the model produced alongside function calls
                const responseText = response.text?.trim();
                if (responseText) {
                    answerText = responseText;
                }

                const modelParts = response.candidates?.[0]?.content?.parts;
                if (modelParts) {
                    contents.push({ role: "model", parts: modelParts });
                }

                contents.push({
                    role: "user",
                    parts: results.map((r) => ({
                        functionResponse: {
                            id: r.id,
                            name: r.name,
                            response: r.response,
                        },
                    })),
                });

                round++;
            } else {
                answerText = response.text?.trim() ?? "";
                break;
            }
        }

        if (!answerText && round >= MAX_ROUNDS) {
            logWarn(requestId, "agent hit MAX_ROUNDS without producing text", { rounds: round, toolCallCount });

            const lastModelContent = [...contents].reverse().find((c) => c.role === "model");
            const partialText = lastModelContent?.parts
                ?.filter((p: Part) => typeof p.text === "string")
                .map((p: Part) => p.text)
                .join("") ?? "";

            answerText = partialText
                ? `${partialText.trim()}\n\n(Note: This answer may be incomplete as the research process was cut short.)`
                : "I was unable to complete my research within the allowed number of steps. Please try rephrasing your question or asking something more specific.";
        }

        const citations = parseCitations(answerText, articleLookup);
        const confidence = scoreConfidence(answerText, citations, toolCallCount);

        return {
            answer: answerText,
            citations,
            confidence,
            toolCallCount,
            rounds: round,
            articleMeta: articleLookup,
        };
    } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
            logWarn(requestId, "agent loop aborted by signal", { rounds: round, toolCallCount });
            return {
                answer: "The request timed out before a complete answer could be generated. Please try a simpler question.",
                citations: [],
                confidence: "low",
                toolCallCount,
                rounds: round,
                articleMeta: articleLookup,
            };
        }

        logError(requestId, "agent loop failed", err);
        return {
            answer: "I encountered an error while researching your question. Please try again.",
            citations: [],
            confidence: "low",
            toolCallCount,
            rounds: round,
            articleMeta: articleLookup,
        };
    }
}
