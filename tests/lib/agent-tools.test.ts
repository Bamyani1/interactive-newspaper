import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchArticleForRagMock, queryEditionsMock, searchAndRankArchiveMock } =
  vi.hoisted(() => ({
    fetchArticleForRagMock: vi.fn(),
    queryEditionsMock: vi.fn(),
    searchAndRankArchiveMock: vi.fn(),
  }));

vi.mock("@/src/lib/db", () => ({
  fetchArticleForRag: fetchArticleForRagMock,
  queryEditions: queryEditionsMock,
}));
vi.mock("@/src/lib/retrieval", () => ({
  searchAndRankArchive: searchAndRankArchiveMock,
}));

import { executeTool } from "@/src/lib/agent-tools";

const article = {
  id: "1965-03-15-4",
  headline: "Test Headline",
  editionDate: "1965-03-15",
  category: "News",
  summary: "Test summary",
  bodyPlain: "Full article body",
  matchedPassages: ["The exact relevant paragraph."],
  imageUrls: [],
  imageCaptions: [],
  distance: 0.2,
  source: "both" as const,
  byline: null,
  relevanceScore: 8,
};

describe("agent-tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchAndRankArchiveMock.mockResolvedValue({
      articles: [article],
      candidates: 12,
      method: "hybrid",
      mode: "text",
      retrievalTimeMs: 25,
    });
  });

  it("rejects unknown tools", async () => {
    await expect(executeTool("unknown", {})).resolves.toEqual({
      error: "Unknown tool: unknown",
    });
  });

  it("runs the canonical search pipeline with validated filters", async () => {
    const controller = new AbortController();
    const result = await executeTool(
      "search_archive",
      {
        query: "football 1960s",
        startDate: "1960-01-01",
        endDate: "1969-12-31",
        category: "Sports",
        limit: 5,
      },
      { signal: controller.signal, requestId: "req-1" },
    );

    expect(searchAndRankArchiveMock).toHaveBeenCalledWith({
      question: "football 1960s",
      filters: {
        startDate: "1960-01-01",
        endDate: "1969-12-31",
        category: "Sports",
      },
      maxArticles: 5,
      signal: controller.signal,
      requestId: "req-1",
    });
    expect(result).toEqual({
      results: [
        {
          id: article.id,
          headline: article.headline,
          editionDate: article.editionDate,
          category: article.category,
          summary: article.summary,
          byline: null,
          relevantPassages: ["The exact relevant paragraph."],
          excerpt: "The exact relevant paragraph.",
          relevanceScore: 8,
          imageUrls: [],
          imageCaptions: [],
        },
      ],
      retrieval: {
        candidates: 12,
        method: "hybrid",
        mode: "text",
        elapsedMs: 25,
      },
    });
  });

  it("intersects tool dates with enforced request filters", async () => {
    await executeTool(
      "search_archive",
      {
        query: "football",
        startDate: "1960-01-01",
        endDate: "1990-12-31",
        category: "News",
      },
      {
        filters: {
          startDate: "1970-01-01",
          endDate: "1979-12-31",
          category: "Sports",
        },
      },
    );
    expect(searchAndRankArchiveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: {
          startDate: "1970-01-01",
          endDate: "1979-12-31",
          category: "Sports",
        },
      }),
    );
  });

  it.each([
    [0, 1],
    [undefined, 10],
    [99, 20],
  ])("clamps search limit %s to %s", async (input, expected) => {
    await executeTool("search_archive", { query: "test", limit: input });
    expect(searchAndRankArchiveMock).toHaveBeenCalledWith(
      expect.objectContaining({ maxArticles: expected }),
    );
  });

  it("returns complete matched evidence and URL-safe images", async () => {
    const longPassage = "x".repeat(2000);
    searchAndRankArchiveMock.mockResolvedValue({
      articles: [
        {
          ...article,
          matchedPassages: [longPassage],
          imageUrls: ["https://cdn/Page 3.webp"],
          imageCaptions: ["Photo"],
        },
      ],
      candidates: 1,
      method: "hybrid",
      mode: "visual",
      retrievalTimeMs: 10,
    });
    const result = await executeTool("search_archive", { query: "show photo" });
    const item = (result.results as Array<Record<string, unknown>>)[0];
    expect(item.excerpt).toBe(longPassage);
    expect(item.imageUrls).toEqual(["https://cdn/Page%203.webp"]);
  });

  it.each([
    [{}, "query is required"],
    [{ query: "x", startDate: "1965" }, "startDate must use YYYY-MM-DD"],
    [{ query: "x", startDate: "1965-02-30" }, "startDate is not a real date"],
    [
      { query: "x", startDate: "1966-01-01", endDate: "1965-01-01" },
      "startDate must not be after endDate",
    ],
    [{ query: "x", category: "Classified" }, "category is not supported"],
    [{ query: "x", limit: 2.5 }, "limit must be an integer"],
  ])("validates search arguments", async (args, message) => {
    await expect(executeTool("search_archive", args)).resolves.toEqual({
      error: message,
      kind: "invalid_arguments",
    });
    expect(searchAndRankArchiveMock).not.toHaveBeenCalled();
  });

  it("returns a complete article with URL-safe images", async () => {
    fetchArticleForRagMock.mockResolvedValue({
      ...article,
      imageUrls: ["https://cdn/Page 3.webp"],
      imageCaptions: null,
    });
    const result = await executeTool("read_article", {
      articleId: "1965-03-15-4",
    });
    expect(result).toMatchObject({
      id: "1965-03-15-4",
      bodyPlain: "Full article body",
      imageUrls: ["https://cdn/Page%203.webp"],
      imageCaptions: [],
    });
  });

  it("distinguishes an invalid article ID from a missing valid ID", async () => {
    expect(await executeTool("read_article", { articleId: "bad" })).toEqual({
      error: "articleId has an invalid format",
      kind: "invalid_arguments",
    });
    fetchArticleForRagMock.mockResolvedValue(null);
    expect(
      await executeTool("read_article", { articleId: "1965-03-15-99" }),
    ).toEqual({ error: "Article not found" });
  });

  it("does not let read_article escape enforced filters", async () => {
    fetchArticleForRagMock.mockResolvedValue(article);
    await expect(
      executeTool(
        "read_article",
        { articleId: article.id },
        { filters: { startDate: "1970-01-01" } },
      ),
    ).resolves.toEqual({ error: "Article falls outside the enforced archive filters" });
  });

  it("lists editions with bounded pagination", async () => {
    queryEditionsMock.mockResolvedValue({
      editions: [{ date: "1965-03-15", articleCount: 12 }],
      pagination: { offset: 10, limit: 100, hasMore: false },
    });
    const controller = new AbortController();
    const result = await executeTool(
      "list_editions",
      { startDate: "1965-01-01", endDate: "1965-12-31", offset: 10, limit: 500 },
      { signal: controller.signal },
    );
    expect(queryEditionsMock).toHaveBeenCalledWith({
      startDate: "1965-01-01",
      endDate: "1965-12-31",
      offset: 10,
      limit: 100,
      signal: controller.signal,
    });
    expect(result).toEqual({
      editions: [{ date: "1965-03-15", articleCount: 12 }],
      pagination: { offset: 10, limit: 100, hasMore: false },
    });
  });
});
