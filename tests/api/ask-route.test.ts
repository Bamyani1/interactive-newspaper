import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/src/lib/embeddings", () => ({
  embedQuery: vi.fn(),
}));

vi.mock("@/src/lib/db", () => ({
  hybridSearch: vi.fn(),
  queryArticlesByEmbedding: vi.fn(),
}));

vi.mock("@/src/lib/answer-generator", () => ({
  generateAnswer: vi.fn(),
}));

vi.mock("@/src/lib/query-reformulator", () => ({
  reformulateQuery: vi.fn(),
}));

vi.mock("@/src/lib/reranker", () => ({
  rerankArticles: vi.fn(),
}));

vi.mock("@/src/lib/rate-limit", () => ({
  createRateLimiter: () => () => ({ allowed: true, resetAt: Date.now() + 60000 }),
  getClientIp: () => "127.0.0.1",
}));

import { POST } from "@/src/app/api/ask/route";
import { embedQuery } from "@/src/lib/embeddings";
import { hybridSearch, queryArticlesByEmbedding } from "@/src/lib/db";
import { generateAnswer } from "@/src/lib/answer-generator";
import { reformulateQuery } from "@/src/lib/query-reformulator";
import { rerankArticles } from "@/src/lib/reranker";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const mockArticle = {
  id: "1960-01-07-0",
  editionDate: "1960-01-07",
  category: "News",
  headline: "Test Headline",
  summary: "Test summary",
  byline: "Test Author",
  bodyPlain: "Test body content for article.",
  distance: 0.25,
  source: "vector" as const,
  imageUrls: [],
};

describe("POST /api/ask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (reformulateQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      embeddingQuery: "What happened at OWU?",
      ftsQuery: "What happened at OWU?",
      mode: "text",
    });
    (embedQuery as ReturnType<typeof vi.fn>).mockResolvedValue(new Array(768).fill(0));
    (hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValue([mockArticle]);
    (rerankArticles as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...mockArticle, relevanceScore: 8 },
    ]);
    (generateAnswer as ReturnType<typeof vi.fn>).mockResolvedValue({
      answer: "Test answer [Source 1]",
      citations: [
        { articleId: "1960-01-07-0", headline: "Test Headline", editionDate: "1960-01-07" },
      ],
      confidence: "high",
    });
  });

  it("returns 400 when question field is missing", async () => {
    const response = await POST(makeRequest({}));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Missing required field: question");
  });

  it("returns 400 when question is empty after trim", async () => {
    const response = await POST(makeRequest({ question: "   " }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Question cannot be empty");
  });

  it("returns 400 when question exceeds 1000 characters", async () => {
    const longQuestion = "a".repeat(1001);
    const response = await POST(makeRequest({ question: longQuestion }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("Question too long");
    expect(body.error).toContain("1001 chars");
  });

  it("returns 502 when embedding fails", async () => {
    (embedQuery as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("API key missing"));

    const response = await POST(makeRequest({ question: "What happened?" }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toBe("Failed to process question. Please try again.");
  });

  it("returns 200 with correct response structure on success", async () => {
    const response = await POST(makeRequest({ question: "What happened at OWU?" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.question).toBe("What happened at OWU?");
    expect(body.answer).toBe("Test answer [Source 1]");
    expect(body.citations).toEqual([
      { articleId: "1960-01-07-0", headline: "Test Headline", editionDate: "1960-01-07" },
    ]);
    expect(body.confidence).toBe("high");
    expect(body.sourceArticles).toHaveLength(1);
    expect(body.sourceArticles[0].id).toBe("1960-01-07-0");
    expect(body.sourceArticles[0].headline).toBe("Test Headline");
    expect(body.sourceArticles[0].editionDate).toBe("1960-01-07");
    expect(body.sourceArticles[0].category).toBe("News");
    expect(body.meta).toBeDefined();
    expect(body.meta.method).toBe("hybrid");
  });

  it("falls back to vector-only search when hybridSearch throws", async () => {
    (hybridSearch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("FTS index unavailable")
    );
    (queryArticlesByEmbedding as ReturnType<typeof vi.fn>).mockResolvedValue([mockArticle]);

    const response = await POST(makeRequest({ question: "Tell me about sports" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.meta.method).toBe("vector");
    expect(queryArticlesByEmbedding).toHaveBeenCalled();
  });

  it("includes bodySnippet in sourceArticles (truncated with ellipsis if > 300 chars)", async () => {
    const longBody = "x".repeat(400);
    const articleWithLongBody = { ...mockArticle, bodyPlain: longBody, relevanceScore: 8 };
    (hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValue([articleWithLongBody]);
    (rerankArticles as ReturnType<typeof vi.fn>).mockResolvedValue([articleWithLongBody]);

    const response = await POST(makeRequest({ question: "What happened?" }));
    const body = await response.json();

    const snippet = body.sourceArticles[0].bodySnippet;
    expect(snippet).toHaveLength(301); // 300 chars + 1 ellipsis character
    expect(snippet.endsWith("\u2026")).toBe(true);
    expect(snippet.slice(0, 300)).toBe("x".repeat(300));

    // Short body should not have ellipsis
    const shortArticle = { ...mockArticle, bodyPlain: "Short body", relevanceScore: 8 };
    (hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValue([shortArticle]);
    (rerankArticles as ReturnType<typeof vi.fn>).mockResolvedValue([shortArticle]);

    const response2 = await POST(makeRequest({ question: "What happened?" }));
    const body2 = await response2.json();

    expect(body2.sourceArticles[0].bodySnippet).toBe("Short body");
  });

  it("includes timing metadata in response", async () => {
    const response = await POST(makeRequest({ question: "What happened?" }));
    const body = await response.json();

    expect(typeof body.meta.retrievalTimeMs).toBe("number");
    expect(typeof body.meta.generationTimeMs).toBe("number");
    expect(typeof body.meta.totalTimeMs).toBe("number");
    expect(body.meta.articlesSearched).toBe(1);
    expect(body.meta.retrievalTimeMs).toBeGreaterThanOrEqual(0);
    expect(body.meta.generationTimeMs).toBeGreaterThanOrEqual(0);
    expect(body.meta.totalTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("calls reformulateQuery before embedding", async () => {
    (reformulateQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      embeddingQuery: "expanded OWU query",
      ftsQuery: "OWU OR Ohio Wesleyan",
      mode: "text",
    });

    await POST(makeRequest({ question: "What happened at OWU?" }));

    expect(reformulateQuery).toHaveBeenCalledWith("What happened at OWU?");
    expect(embedQuery).toHaveBeenCalledWith("expanded OWU query");
    expect(hybridSearch).toHaveBeenCalledWith(
      "OWU OR Ohio Wesleyan",
      expect.any(Array),
      expect.objectContaining({ limit: 8 }),
    );
  });

  it("passes original question (not reformulated) to generateAnswer", async () => {
    (reformulateQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      embeddingQuery: "reformulated for embedding",
      ftsQuery: "reformulated for fts",
      mode: "text",
    });

    await POST(makeRequest({ question: "Original question?" }));

    expect(generateAnswer).toHaveBeenCalledWith(
      "Original question?",
      expect.any(Array),
    );
  });

  it("calls rerankArticles between retrieval and generation", async () => {
    const retrieved = [mockArticle, { ...mockArticle, id: "1960-01-07-1" }];
    const reranked = [{ ...mockArticle, relevanceScore: 9 }];
    (hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValue(retrieved);
    (rerankArticles as ReturnType<typeof vi.fn>).mockResolvedValue(reranked);

    await POST(makeRequest({ question: "Test?" }));

    expect(rerankArticles).toHaveBeenCalledWith("Test?", retrieved, { maxArticles: 5 });
    expect(generateAnswer).toHaveBeenCalledWith("Test?", reranked);
  });

  it("includes reformulatedQuery in meta when query was reformulated", async () => {
    (reformulateQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      embeddingQuery: "reformulated query",
      ftsQuery: "reformulated fts",
      mode: "text",
    });

    const response = await POST(makeRequest({ question: "What sports existed?" }));
    const body = await response.json();

    expect(body.meta.reformulatedQuery).toBe("reformulated query");
  });

  it("omits reformulatedQuery in meta when query was not changed", async () => {
    const question = "What happened at OWU?";
    (reformulateQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      embeddingQuery: question,
      ftsQuery: question,
      mode: "text",
    });

    const response = await POST(makeRequest({ question }));
    const body = await response.json();

    expect(body.meta.reformulatedQuery).toBeUndefined();
  });
});
