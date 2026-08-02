import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    runAgentLoop,
    parseCitations,
    scoreConfidence,
    accumulateArticleMeta,
} from "@/src/lib/agent-loop";
import type { AgentProgressEvent, ArticleMeta } from "@/src/lib/agent-loop";

const mockGenerateContentFn = vi.fn();

vi.mock("@/src/lib/gemini-client", () => ({
    getGeminiClient: vi.fn(() => ({
        models: {
            generateContent: mockGenerateContentFn,
        },
    })),
}));

vi.mock("@/src/lib/agent-tools", () => ({
    AGENT_TOOL_DECLARATIONS: [],
    executeTool: vi.fn(),
}));

vi.mock("@/src/lib/cost-tracker", () => ({ recordUsage: vi.fn() }));

import { executeTool } from "@/src/lib/agent-tools";

function mockGenerateContent(
    ...responses: Array<{
        text?: string;
        functionCalls?: Array<{ name: string; id?: string; args?: Record<string, unknown> }>;
        parts?: Array<Record<string, unknown>>;
    }>
) {
    for (const resp of responses) {
        mockGenerateContentFn.mockResolvedValueOnce({
            text: resp.text,
            functionCalls: resp.functionCalls,
            candidates: resp.parts
                ? [{ content: { parts: resp.parts } }]
                : resp.functionCalls
                  ? [{ content: { parts: resp.functionCalls.map((c) => ({ functionCall: c })) } }]
                  : [{ content: { parts: [{ text: resp.text }] } }],
        });
    }
}

describe("agent-loop", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("runAgentLoop", () => {
        it("returns text answer on first round (no tool calls)", async () => {
            mockGenerateContent({
                text: "The answer is 42.",
            });

            const result = await runAgentLoop("What is the answer?");
            expect(result.answer).toBe("The answer is 42.");
            expect(result.rounds).toBe(0);
            expect(result.toolCallCount).toBe(0);
            const call = mockGenerateContentFn.mock.calls[0][0];
            expect(call.model).toBe("gemini-3.5-flash-lite");
            expect(call.config.thinkingConfig.thinkingLevel).toBe("MEDIUM");
            expect(call.config).not.toHaveProperty("temperature");
        });

        it("executes tool calls and returns answer on second round", async () => {
            (executeTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
                results: [
                    { id: "1965-03-15-4", headline: "Test Article", editionDate: "1965-03-15", category: "News", summary: "Summary", excerpt: "Excerpt text" },
                ],
            });

            mockGenerateContent(
                {
                    functionCalls: [{ name: "search_archive", args: { query: "test" } }],
                    parts: [{ functionCall: { name: "search_archive", args: { query: "test" } } }],
                },
                {
                    text: "Based on [1965-03-15-4], the answer is yes.",
                },
            );

            const result = await runAgentLoop("test question");
            expect(result.answer).toBe("Based on [1965-03-15-4], the answer is yes.");
            expect(result.rounds).toBe(1);
            expect(result.toolCallCount).toBe(1);
            expect(result.citations).toHaveLength(1);
            expect(result.citations[0].articleId).toBe("1965-03-15-4");
            expect(result.citations[0].headline).toBe("Test Article");
        });

        it("executes multiple tool calls in parallel", async () => {
            (executeTool as ReturnType<typeof vi.fn>)
                .mockResolvedValueOnce({
                    results: [{ id: "1960-01-01-1", headline: "H1", editionDate: "1960-01-01", category: "News", summary: "S1", excerpt: "E1" }],
                })
                .mockResolvedValueOnce({
                    results: [{ id: "1970-01-01-1", headline: "H2", editionDate: "1970-01-01", category: "Sports", summary: "S2", excerpt: "E2" }],
                });

            mockGenerateContent(
                {
                    functionCalls: [
                        { name: "search_archive", args: { query: "60s" } },
                        { name: "search_archive", args: { query: "70s" } },
                    ],
                    parts: [
                        { functionCall: { name: "search_archive", args: { query: "60s" } } },
                        { functionCall: { name: "search_archive", args: { query: "70s" } } },
                    ],
                },
                { text: "Found in [1960-01-01-1] and [1970-01-01-1]." },
            );

            const result = await runAgentLoop("Compare 60s and 70s");
            expect(result.toolCallCount).toBe(2);
            expect(result.citations).toHaveLength(2);
            expect(executeTool).toHaveBeenCalledTimes(2);
        });

        it("forces a no-tools synthesis call after three tool rounds", async () => {
            (executeTool as ReturnType<typeof vi.fn>).mockResolvedValue({
                results: [],
            });

            for (let i = 0; i < 3; i++) {
                mockGenerateContent({
                    functionCalls: [{ name: "search_archive", args: { query: `attempt ${i}` } }],
                    parts: [{ functionCall: { name: "search_archive", args: { query: `attempt ${i}` } } }],
                });
            }
            mockGenerateContent({ text: "I don't have enough information in the retrieved evidence." });

            const result = await runAgentLoop("impossible question");
            expect(result.rounds).toBe(3);
            expect(result.answer).toContain("don't have enough information");
            expect(result.confidence).toBe("low");
            expect(mockGenerateContentFn).toHaveBeenCalledTimes(4);
            const finalCall = mockGenerateContentFn.mock.calls[3][0];
            expect(finalCall.config.tools).toBeUndefined();
            expect(finalCall.config.toolConfig.functionCallingConfig.mode).toBe(
                "NONE",
            );
            expect(finalCall.config.systemInstruction).toContain(
                "The research phase is complete",
            );
            expect(finalCall.config.systemInstruction).toContain(
                "do not request, describe, or emit a function call",
            );
            expect(finalCall.config.systemInstruction).not.toContain(
                "Use the search_archive tool",
            );
            expect(finalCall.contents).toHaveLength(1);
            expect(finalCall.contents[0].role).toBe("user");
            expect(finalCall.contents[0].parts[0].text).toContain(
                "ARCHIVE EVIDENCE",
            );
        });

        it("uses partial tool-round text if forced synthesis is empty", async () => {
            (executeTool as ReturnType<typeof vi.fn>).mockResolvedValue({
                results: [],
            });

            for (let i = 0; i < 3; i++) {
                mockGenerateContent({
                    functionCalls: [{ name: "search_archive", args: { query: `q${i}` } }],
                    parts: [
                        { text: i === 2 ? "Partial answer so far" : undefined },
                        { functionCall: { name: "search_archive", args: { query: `q${i}` } } },
                    ],
                });
            }
            mockGenerateContent({ text: "" });

            const result = await runAgentLoop("hard question");
            expect(result.rounds).toBe(3);
            expect(result.answer).toContain("Partial answer so far");
            expect(result.answer).toContain("incomplete");
        });

        it("synthesizes from a fresh deduplicated evidence packet", async () => {
            (executeTool as ReturnType<typeof vi.fn>).mockResolvedValue({
                results: [
                    {
                        id: "1968-01-31-28",
                        headline: "Student Demonstrations Increase",
                        editionDate: "1968-01-31",
                        category: "Campus News",
                        summary: "Anti-war demonstrations",
                        relevantPassages: ["Students staged a campus demonstration."],
                        excerpt: "Students staged a campus demonstration.",
                        relevanceScore: 8,
                    },
                ],
            });
            for (let i = 0; i < 3; i++) {
                mockGenerateContent({
                    functionCalls: [{ name: "search_archive", args: { query: `q${i}` } }],
                    parts: [
                        { functionCall: { name: "search_archive", args: { query: `q${i}` } } },
                    ],
                });
            }
            mockGenerateContent({
                text: "Students demonstrated [1968-01-31-28].",
            });

            const result = await runAgentLoop("Compare the protests");
            const finalPrompt = mockGenerateContentFn.mock.calls[3][0]
                .contents[0].parts[0].text as string;
            expect(finalPrompt).toContain("Students staged a campus demonstration.");
            expect(finalPrompt.match(/--- Article 1968-01-31-28 ---/g)).toHaveLength(1);
            expect(result.citations.map((citation) => citation.articleId)).toEqual([
                "1968-01-31-28",
            ]);
        });

        it("returns timeout response when signal is already aborted", async () => {
            const controller = new AbortController();
            controller.abort();

            const result = await runAgentLoop("test", { signal: controller.signal });
            expect(result.answer).toContain("timed out");
            expect(result.confidence).toBe("low");
            expect(result.rounds).toBe(0);
        });

        it("catches AbortError during API call", async () => {
            const abortErr = new Error("Aborted");
            abortErr.name = "AbortError";
            mockGenerateContentFn.mockRejectedValueOnce(abortErr);

            const result = await runAgentLoop("test");
            expect(result.answer).toContain("timed out");
            expect(result.confidence).toBe("low");
        });

        it("catches unexpected errors gracefully", async () => {
            mockGenerateContentFn.mockRejectedValueOnce(new Error("Network failure"));

            const result = await runAgentLoop("test");
            expect(result.answer).toContain("encountered an error");
            expect(result.confidence).toBe("low");
        });

        it("logs warning when tool returns error", async () => {
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            (executeTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
                error: "Article not found",
            });

            mockGenerateContent(
                {
                    functionCalls: [{ name: "read_article", args: { articleId: "bad-id" } }],
                    parts: [{ functionCall: { name: "read_article", args: { articleId: "bad-id" } } }],
                },
                { text: "Could not find the article." },
            );

            await runAgentLoop("read bad article", { requestId: "test-req" });
            const toolErrorLog = warnSpy.mock.calls.find((call) => {
                const parsed = JSON.parse(call[0] as string);
                return parsed.msg?.includes("tool read_article returned error");
            });
            expect(toolErrorLog).toBeDefined();
            warnSpy.mockRestore();
        });

        it("prepends conversation context to user message", async () => {
            mockGenerateContentFn.mockResolvedValueOnce({
                text: "Follow-up answer.",
                functionCalls: undefined,
                candidates: [{ content: { parts: [{ text: "Follow-up answer." }] } }],
            });

            await runAgentLoop("Tell me more", {
                conversationContext: "[Turn 1] Q: What about sports?\nA: Football was popular.",
            });

            const call = mockGenerateContentFn.mock.calls[0][0];
            const userText = call.contents[0].parts[0].text;
            expect(userText).toContain("[Turn 1] Q: What about sports?");
            expect(userText).toContain("Tell me more");
        });

        it("passes enforced filters to every tool call", async () => {
            (executeTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ results: [] });
            mockGenerateContent(
                {
                    functionCalls: [{ name: "search_archive", args: { query: "football" } }],
                    parts: [{ functionCall: { name: "search_archive", args: { query: "football" } } }],
                },
                { text: "No result." },
            );

            const filters = { startDate: "1970-01-01", endDate: "1979-12-31" };
            await runAgentLoop("football", { filters });
            expect(executeTool).toHaveBeenCalledWith(
                "search_archive",
                { query: "football" },
                expect.objectContaining({ filters }),
            );
        });

        it("calls onProgress callback for tool calls and results", async () => {
            const events: AgentProgressEvent[] = [];

            (executeTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
                results: [{ id: "a1", headline: "H1", editionDate: "1960-01-01" }],
            });

            mockGenerateContent(
                {
                    functionCalls: [{ name: "search_archive", args: { query: "test" } }],
                    parts: [{ functionCall: { name: "search_archive", args: { query: "test" } } }],
                },
                { text: "Answer." },
            );

            await runAgentLoop("test", {
                onProgress: (e) => events.push(e),
            });

            expect(events).toHaveLength(2);
            expect(events[0].type).toBe("tool_call");
            expect(events[0].tool).toBe("search_archive");
            expect(events[1].type).toBe("tool_result");
            expect(events[1].summary).toContain("Found 1 articles");
        });

        it("returns articleMeta accumulated from tool calls", async () => {
            (executeTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
                results: [
                    { id: "a1", headline: "H1", editionDate: "1960-01-01", category: "News", summary: "S1", excerpt: "E1", imageUrls: ["img.jpg"] },
                ],
            });

            mockGenerateContent(
                {
                    functionCalls: [{ name: "search_archive", args: { query: "test" } }],
                    parts: [{ functionCall: { name: "search_archive", args: { query: "test" } } }],
                },
                { text: "See [a1]." },
            );

            const result = await runAgentLoop("test");
            expect(result.articleMeta.size).toBe(1);
            const meta = result.articleMeta.get("a1")!;
            expect(meta.headline).toBe("H1");
            expect(meta.category).toBe("News");
            expect(meta.imageUrls).toEqual(["img.jpg"]);
            expect(meta.evidenceText).toBe("E1");
        });
    });

    describe("parseCitations", () => {
        const lookup = new Map<string, ArticleMeta>();
        lookup.set("1965-03-15-4", {
            headline: "Test Headline",
            editionDate: "1965-03-15",
            category: "News",
            summary: "",
            byline: null,
            bodySnippet: "",
            imageUrls: [],
            imageCaptions: [],
        });

        it("extracts valid citation IDs", () => {
            const citations = parseCitations("See [1965-03-15-4] for details.", lookup);
            expect(citations).toHaveLength(1);
            expect(citations[0].articleId).toBe("1965-03-15-4");
            expect(citations[0].headline).toBe("Test Headline");
        });

        it("deduplicates repeated citations", () => {
            const citations = parseCitations("[1965-03-15-4] and again [1965-03-15-4].", lookup);
            expect(citations).toHaveLength(1);
        });

        it("returns empty array when no citations found", () => {
            const citations = parseCitations("No citations here.", lookup);
            expect(citations).toHaveLength(0);
        });

        it("rejects citations that were not returned by a tool", () => {
            const citations = parseCitations("[2000-01-01-1] unknown.", lookup);
            expect(citations).toEqual([]);
        });

        it("handles multiple different citations", () => {
            lookup.set("1970-05-20-2", {
                headline: "Another",
                editionDate: "1970-05-20",
                category: "Sports",
                summary: "",
                byline: null,
                bodySnippet: "",
                imageUrls: [],
                imageCaptions: [],
            });
            const citations = parseCitations("[1965-03-15-4] and [1970-05-20-2].", lookup);
            expect(citations).toHaveLength(2);
        });
    });

    describe("scoreConfidence", () => {
        it("returns low when toolCallCount is 0", () => {
            expect(scoreConfidence("answer", [], 0)).toBe("low");
        });

        it("returns low when answer says not enough info", () => {
            expect(scoreConfidence("I don't have enough information", [{ articleId: "a", headline: "h", editionDate: "d" }], 3)).toBe("low");
        });

        it("returns high only with multiple high-relevance verified citations", () => {
            const cits = [
                { articleId: "a1", headline: "h", editionDate: "d" },
                { articleId: "a2", headline: "h", editionDate: "d" },
                { articleId: "a3", headline: "h", editionDate: "d" },
            ];
            const articleLookup = new Map<string, ArticleMeta>(
                cits.map((citation) => [
                    citation.articleId,
                    {
                        headline: "h",
                        editionDate: "d",
                        category: "News",
                        summary: "",
                        byline: null,
                        bodySnippet: "",
                        imageUrls: [],
                        imageCaptions: [],
                        relevanceScore: 8,
                    },
                ]),
            );
            expect(
                scoreConfidence("answer", cits, 2, {
                    articleLookup,
                    successfulSearchCount: 1,
                }),
            ).toBe("high");
        });

        it("does not award high confidence from citation count alone", () => {
            const cits = [
                { articleId: "a1", headline: "h", editionDate: "d" },
                { articleId: "a2", headline: "h", editionDate: "d" },
                { articleId: "a3", headline: "h", editionDate: "d" },
            ];
            expect(scoreConfidence("answer", cits, 2)).toBe("medium");
        });

        it("returns medium with 1-2 citations", () => {
            const cits = [{ articleId: "a1", headline: "h", editionDate: "d" }];
            expect(scoreConfidence("answer", cits, 1)).toBe("medium");
        });

        it("returns low with no citations and some tool calls", () => {
            expect(scoreConfidence("answer", [], 2)).toBe("low");
        });
    });

    describe("accumulateArticleMeta", () => {
        it("accumulates from search_archive results", () => {
            const lookup = new Map<string, ArticleMeta>();
            accumulateArticleMeta("search_archive", {
                results: [
                    { id: "a1", headline: "H1", editionDate: "1960-01-01", category: "News", summary: "S", excerpt: "E", imageUrls: [] },
                ],
            }, lookup);
            expect(lookup.size).toBe(1);
            expect(lookup.get("a1")!.headline).toBe("H1");
            expect(lookup.get("a1")!.category).toBe("News");
            expect(lookup.get("a1")!.evidenceText).toBe("E");
        });

        it("accumulates from read_article result", () => {
            const lookup = new Map<string, ArticleMeta>();
            accumulateArticleMeta("read_article", {
                id: "a2",
                headline: "H2",
                editionDate: "1970-01-01",
                category: "Sports",
                summary: "S2",
                byline: "Author",
                bodyPlain: "Full text here",
                imageUrls: ["img.jpg"],
            }, lookup);
            expect(lookup.size).toBe(1);
            expect(lookup.get("a2")!.headline).toBe("H2");
            expect(lookup.get("a2")!.byline).toBe("Author");
            expect(lookup.get("a2")!.bodySnippet).toBe("Full text here");
            expect(lookup.get("a2")!.evidenceText).toBe("Full text here");
        });

        it("preserves a search relevance score when read_article adds full text", () => {
            const lookup = new Map<string, ArticleMeta>();
            accumulateArticleMeta("search_archive", {
                results: [
                    {
                        id: "a2",
                        headline: "H2",
                        editionDate: "1970-01-01",
                        excerpt: "Matched passage",
                        relevanceScore: 9,
                    },
                ],
            }, lookup);
            accumulateArticleMeta("read_article", {
                id: "a2",
                headline: "H2",
                editionDate: "1970-01-01",
                bodyPlain: "A longer full article body",
            }, lookup);

            expect(lookup.get("a2")!.relevanceScore).toBe(9);
            expect(lookup.get("a2")!.evidenceText).toBe(
                "A longer full article body",
            );
        });

        it("ignores unknown tool names", () => {
            const lookup = new Map<string, ArticleMeta>();
            accumulateArticleMeta("list_editions", { editions: [] }, lookup);
            expect(lookup.size).toBe(0);
        });

        it("handles missing optional fields gracefully", () => {
            const lookup = new Map<string, ArticleMeta>();
            accumulateArticleMeta("search_archive", {
                results: [{ id: "a3", headline: "H3" }],
            }, lookup);
            expect(lookup.get("a3")!.category).toBe("");
            expect(lookup.get("a3")!.byline).toBeNull();
            expect(lookup.get("a3")!.imageUrls).toEqual([]);
        });
    });
});
