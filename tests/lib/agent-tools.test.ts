import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeTool } from "@/src/lib/agent-tools";

vi.mock("@/src/lib/embeddings", () => ({
    embedQuery: vi.fn(),
}));

vi.mock("@/src/lib/db", () => ({
    hybridSearch: vi.fn(),
    queryEditions: vi.fn(),
}));

const mockSqlResult = vi.fn();
const mockSqlTagFn = vi.fn((..._args: unknown[]) => mockSqlResult());

vi.mock("@neondatabase/serverless", () => ({
    neon: vi.fn(() => mockSqlTagFn),
}));

import { embedQuery } from "@/src/lib/embeddings";
import { hybridSearch, queryEditions } from "@/src/lib/db";

describe("agent-tools", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.DATABASE_URL = "postgres://test";
    });

    describe("executeTool dispatch", () => {
        it("returns error for unknown tool name", async () => {
            const result = await executeTool("nonexistent_tool", {});
            expect(result).toEqual({ error: "Unknown tool: nonexistent_tool" });
        });

        it("catches exceptions and returns error object", async () => {
            (embedQuery as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
                new Error("Network failure"),
            );
            const result = await executeTool("search_archive", { query: "test" });
            expect(result).toEqual({ error: "Network failure" });
        });
    });

    describe("search_archive", () => {
        const mockEmbedding = [0.1, 0.2, 0.3];
        const mockArticle = {
            id: "1965-03-15-4",
            headline: "Test Headline",
            editionDate: "1965-03-15",
            category: "News",
            summary: "Test summary",
            bodyPlain: "Full article body text here for testing excerpt truncation",
            imageUrls: [],
            imageCaptions: [],
            distance: 0.5,
            source: "both" as const,
            byline: null,
        };

        beforeEach(() => {
            (embedQuery as ReturnType<typeof vi.fn>).mockResolvedValue(mockEmbedding);
            (hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValue([mockArticle]);
        });

        it("calls embedQuery and hybridSearch with correct args", async () => {
            await executeTool("search_archive", {
                query: "football 1960s",
                startDate: "1960-01-01",
                endDate: "1969-12-31",
                category: "Sports",
                limit: 5,
            });

            expect(embedQuery).toHaveBeenCalledWith("football 1960s", { signal: undefined });
            expect(hybridSearch).toHaveBeenCalledWith(
                "football 1960s",
                mockEmbedding,
                expect.objectContaining({
                    limit: 5,
                    startDate: "1960-01-01",
                    endDate: "1969-12-31",
                    category: "Sports",
                }),
            );
        });

        it("clamps limit to range [1, 20]", async () => {
            await executeTool("search_archive", { query: "test", limit: 0 });
            expect(hybridSearch).toHaveBeenCalledWith(
                "test",
                mockEmbedding,
                expect.objectContaining({ limit: 1 }),
            );

            vi.clearAllMocks();
            (embedQuery as ReturnType<typeof vi.fn>).mockResolvedValue(mockEmbedding);
            (hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValue([mockArticle]);

            await executeTool("search_archive", { query: "test", limit: 50 });
            expect(hybridSearch).toHaveBeenCalledWith(
                "test",
                mockEmbedding,
                expect.objectContaining({ limit: 20 }),
            );
        });

        it("defaults limit to 10", async () => {
            await executeTool("search_archive", { query: "test" });
            expect(hybridSearch).toHaveBeenCalledWith(
                "test",
                mockEmbedding,
                expect.objectContaining({ limit: 10 }),
            );
        });

        it("returns correct response shape with excerpt", async () => {
            const result = await executeTool("search_archive", { query: "test" });
            expect(result).toEqual({
                results: [
                    {
                        id: "1965-03-15-4",
                        headline: "Test Headline",
                        editionDate: "1965-03-15",
                        category: "News",
                        summary: "Test summary",
                        excerpt: "Full article body text here for testing excerpt truncation",
                        imageUrls: [],
                        imageCaptions: [],
                    },
                ],
            });
        });

        it("passes through imageUrls and imageCaptions from hybridSearch", async () => {
            (hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValue([
                {
                    ...mockArticle,
                    imageUrls: ["https://cdn/a.webp", "https://cdn/b.webp"],
                    imageCaptions: ["Homecoming 1978", null],
                },
            ]);

            const result = await executeTool("search_archive", { query: "test" });
            const article = (result.results as Array<Record<string, unknown>>)[0];
            expect(article.imageUrls).toEqual(["https://cdn/a.webp", "https://cdn/b.webp"]);
            expect(article.imageCaptions).toEqual(["Homecoming 1978", null]);
        });

        it("URL-encodes spaces so LLM can embed URLs inside markdown `![](...)`", async () => {
            (hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValue([
                {
                    ...mockArticle,
                    imageUrls: ["https://cdn/1986-02-21/images/0003_Page 3_img3.webp"],
                    imageCaptions: ["photo"],
                },
            ]);

            const result = await executeTool("search_archive", { query: "test" });
            const article = (result.results as Array<Record<string, unknown>>)[0];
            expect(article.imageUrls).toEqual([
                "https://cdn/1986-02-21/images/0003_Page%203_img3.webp",
            ]);
        });

        it("truncates excerpt to 500 chars", async () => {
            const longBody = "x".repeat(1000);
            (hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValue([
                { ...mockArticle, bodyPlain: longBody },
            ]);

            const result = await executeTool("search_archive", { query: "test" });
            const article = (result.results as Array<Record<string, unknown>>)[0];
            expect((article.excerpt as string).length).toBe(500);
        });

        it("passes abort signal to embedQuery and hybridSearch", async () => {
            const controller = new AbortController();
            await executeTool(
                "search_archive",
                { query: "test" },
                { signal: controller.signal },
            );

            expect(embedQuery).toHaveBeenCalledWith("test", { signal: controller.signal });
            expect(hybridSearch).toHaveBeenCalledWith(
                "test",
                mockEmbedding,
                expect.objectContaining({ signal: controller.signal }),
            );
        });
    });

    describe("read_article", () => {
        it("returns full article when found", async () => {
            mockSqlResult.mockResolvedValueOnce([
                {
                    id: "1965-03-15-4",
                    edition_date: "1965-03-15",
                    category: "News",
                    headline: "Test",
                    summary: "Summary",
                    byline: "Author Name",
                    body_plain: "Full text",
                    image_urls: ["img.jpg"],
                    image_captions: ["A photo"],
                },
            ]);

            const result = await executeTool("read_article", { articleId: "1965-03-15-4" });

            expect(result).toEqual({
                id: "1965-03-15-4",
                editionDate: "1965-03-15",
                category: "News",
                headline: "Test",
                summary: "Summary",
                byline: "Author Name",
                bodyPlain: "Full text",
                imageUrls: ["img.jpg"],
                imageCaptions: ["A photo"],
            });
        });

        it("URL-encodes spaces in read_article imageUrls", async () => {
            mockSqlResult.mockResolvedValueOnce([
                {
                    id: "1986-02-21-19",
                    edition_date: "1986-02-21",
                    category: "News",
                    headline: "Test",
                    summary: "Summary",
                    byline: null,
                    body_plain: "Full text",
                    image_urls: ["https://cdn/1986-02-21/images/0003_Page 3_img3.webp"],
                    image_captions: ["photo"],
                },
            ]);

            const result = await executeTool("read_article", { articleId: "1986-02-21-19" });
            expect((result as Record<string, unknown>).imageUrls).toEqual([
                "https://cdn/1986-02-21/images/0003_Page%203_img3.webp",
            ]);
        });

        it("defaults imageCaptions to [] when column is null", async () => {
            mockSqlResult.mockResolvedValueOnce([
                {
                    id: "1965-03-15-4",
                    edition_date: "1965-03-15",
                    category: "News",
                    headline: "Test",
                    summary: "Summary",
                    byline: null,
                    body_plain: "Full text",
                    image_urls: [],
                    image_captions: null,
                },
            ]);

            const result = await executeTool("read_article", { articleId: "1965-03-15-4" });
            expect((result as Record<string, unknown>).imageCaptions).toEqual([]);
        });

        it("returns error when article not found", async () => {
            mockSqlResult.mockResolvedValueOnce([]);

            const result = await executeTool("read_article", { articleId: "nonexistent" });
            expect(result).toEqual({ error: "Article not found" });
        });
    });

    describe("list_editions", () => {
        it("passes date filters to queryEditions", async () => {
            (queryEditions as ReturnType<typeof vi.fn>).mockResolvedValue({
                editions: [
                    { date: "1965-03-15", articleCount: 12 },
                    { date: "1965-03-22", articleCount: 8 },
                ],
            });

            const result = await executeTool("list_editions", {
                startDate: "1965-01-01",
                endDate: "1965-12-31",
            });

            expect(queryEditions).toHaveBeenCalledWith({
                startDate: "1965-01-01",
                endDate: "1965-12-31",
                limit: 50,
            });
            expect(result).toEqual({
                editions: [
                    { date: "1965-03-15", articleCount: 12 },
                    { date: "1965-03-22", articleCount: 8 },
                ],
            });
        });

        it("passes undefined dates when not provided", async () => {
            (queryEditions as ReturnType<typeof vi.fn>).mockResolvedValue({
                editions: [],
            });

            await executeTool("list_editions", {});
            expect(queryEditions).toHaveBeenCalledWith({
                startDate: undefined,
                endDate: undefined,
                limit: 50,
            });
        });
    });
});
