import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  DbTimeoutErrorMock,
  embedQueryMock,
  hybridSearchMock,
  queryArticlesByEmbeddingMock,
  reformulateQueryMock,
  rerankArticlesMock,
} = vi.hoisted(() => {
  class DbTimeoutErrorMock extends Error {
    constructor(
      public readonly op: string,
      public readonly timeoutMs: number,
    ) {
      super(`${op} timed out after ${timeoutMs}ms`);
      this.name = "DbTimeoutError";
    }
  }
  return {
    DbTimeoutErrorMock,
    embedQueryMock: vi.fn(),
    hybridSearchMock: vi.fn(),
    queryArticlesByEmbeddingMock: vi.fn(),
    reformulateQueryMock: vi.fn(),
    rerankArticlesMock: vi.fn(),
  };
});

vi.mock("@/src/lib/db", () => ({
  DbTimeoutError: DbTimeoutErrorMock,
  hybridSearch: hybridSearchMock,
  queryArticlesByEmbedding: queryArticlesByEmbeddingMock,
}));
vi.mock("@/src/lib/embeddings", () => ({ embedQuery: embedQueryMock }));
vi.mock("@/src/lib/query-reformulator", () => ({
  reformulateQuery: reformulateQueryMock,
}));
vi.mock("@/src/lib/reranker", () => ({ rerankArticles: rerankArticlesMock }));

import {
  rerankWithCorrectiveRetry,
  retrieveCandidates,
  searchAndRankArchive,
} from "@/src/lib/retrieval";

const candidate = {
  id: "1965-03-15-4",
  editionDate: "1965-03-15",
  category: "Sports",
  headline: "Bishops Win",
  summary: "Summary",
  byline: null,
  bodyPlain: "Body",
  distance: 0.2,
  source: "both" as const,
  imageUrls: [],
  imageCaptions: [],
};

describe("canonical RAG retrieval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    embedQueryMock.mockResolvedValue([0.1, 0.2]);
    hybridSearchMock.mockResolvedValue([candidate]);
    queryArticlesByEmbeddingMock.mockResolvedValue([candidate]);
    reformulateQueryMock.mockResolvedValue({
      embeddingQuery: "semantic terms",
      ftsQuery: "keyword terms",
      mode: "text",
      complexity: "simple",
    });
    rerankArticlesMock.mockResolvedValue([
      { ...candidate, relevanceScore: 8 },
    ]);
  });

  it("runs one hybrid query with the same request identity and deadline", async () => {
    const controller = new AbortController();
    const result = await retrieveCandidates({
      embeddingQuery: "semantic",
      ftsQuery: "keywords",
      filters: { category: "Sports" },
      limit: 20,
      vectorWeight: 0.6,
      onlyWithImages: false,
      timeoutMs: 5000,
      signal: controller.signal,
      requestId: "req-1",
    });
    expect(embedQueryMock).toHaveBeenCalledWith("semantic", {
      signal: controller.signal,
      requestId: "req-1",
    });
    expect(hybridSearchMock).toHaveBeenCalledWith("keywords", [0.1, 0.2], {
      limit: 20,
      category: "Sports",
      startDate: null,
      endDate: null,
      onlyWithImages: false,
      timeoutMs: 5000,
      signal: controller.signal,
      vectorWeight: 0.6,
    });
    expect(result.method).toBe("hybrid");
  });

  it("uses vector-only fallback for a genuine hybrid query error", async () => {
    hybridSearchMock.mockRejectedValue(new Error("FTS syntax failure"));
    const result = await retrieveCandidates({
      embeddingQuery: "semantic",
      ftsQuery: "keywords",
      limit: 10,
      vectorWeight: 0.6,
      onlyWithImages: false,
    });
    expect(queryArticlesByEmbeddingMock).toHaveBeenCalledTimes(1);
    expect(result.method).toBe("vector");
  });

  it("does not start duplicate DB work after a timeout", async () => {
    hybridSearchMock.mockRejectedValue(new DbTimeoutErrorMock("hybridSearch", 100));
    await expect(
      retrieveCandidates({
        embeddingQuery: "semantic",
        ftsQuery: "keywords",
        limit: 10,
        vectorWeight: 0.6,
        onlyWithImages: false,
      }),
    ).rejects.toBeInstanceOf(DbTimeoutErrorMock);
    expect(queryArticlesByEmbeddingMock).not.toHaveBeenCalled();
  });

  it("does not fall back when the outer request is aborted", async () => {
    const controller = new AbortController();
    hybridSearchMock.mockImplementation(async () => {
      controller.abort();
      throw new Error("aborted");
    });
    await expect(
      retrieveCandidates({
        embeddingQuery: "semantic",
        ftsQuery: "keywords",
        limit: 10,
        vectorWeight: 0.6,
        onlyWithImages: false,
        signal: controller.signal,
      }),
    ).rejects.toThrow("aborted");
    expect(queryArticlesByEmbeddingMock).not.toHaveBeenCalled();
  });

  it("performs exactly one broader corrective retry", async () => {
    rerankArticlesMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...candidate, relevanceScore: 7 }]);
    const result = await rerankWithCorrectiveRetry({
      question: "How did the team change?",
      articles: [candidate],
      mode: "text",
      maxArticles: 5,
      retrievalLimit: 20,
      vectorWeight: 0.6,
      onlyWithImages: false,
    });
    expect(reformulateQueryMock).toHaveBeenCalledTimes(1);
    expect(reformulateQueryMock).toHaveBeenCalledWith(
      "Try broader search terms for: How did the team change?",
      expect.any(Object),
    );
    expect(hybridSearchMock).toHaveBeenCalledTimes(1);
    expect(rerankArticlesMock).toHaveBeenCalledTimes(2);
    expect(result[0].relevanceScore).toBe(7);
  });

  it("uses the same service for agent searches and visual retrieval", async () => {
    reformulateQueryMock.mockResolvedValue({
      embeddingQuery: "homecoming photographs",
      ftsQuery: "homecoming OR parade",
      mode: "visual",
      complexity: "simple",
    });
    const result = await searchAndRankArchive({
      question: "Show homecoming photos",
      maxArticles: 7,
      requestId: "agent-1",
    });
    expect(hybridSearchMock).toHaveBeenCalledWith(
      "homecoming OR parade",
      [0.1, 0.2],
      expect.objectContaining({
        limit: 20,
        vectorWeight: 0.7,
        onlyWithImages: true,
      }),
    );
    expect(rerankArticlesMock).toHaveBeenCalledWith(
      "Show homecoming photos",
      [candidate],
      expect.objectContaining({ maxArticles: 7, minScore: 3 }),
    );
    expect(result.mode).toBe("visual");
  });

  it("applies a model-inferred explicit decade when callers provide no dates", async () => {
    reformulateQueryMock.mockResolvedValue({
      embeddingQuery: "football season results",
      ftsQuery: "football season",
      mode: "text",
      complexity: "simple",
      startDate: "1970-01-01",
      endDate: "1979-12-31",
    });
    await searchAndRankArchive({ question: "football in the 1970s" });
    expect(hybridSearchMock).toHaveBeenCalledWith(
      "football season",
      [0.1, 0.2],
      expect.objectContaining({
        startDate: "1970-01-01",
        endDate: "1979-12-31",
      }),
    );
  });

  it("keeps caller date filters authoritative over inferred dates", async () => {
    reformulateQueryMock.mockResolvedValue({
      embeddingQuery: "football",
      ftsQuery: "football",
      mode: "text",
      complexity: "simple",
      startDate: "1970-01-01",
      endDate: "1979-12-31",
    });
    await searchAndRankArchive({
      question: "football",
      filters: { startDate: "1980-01-01", endDate: "1980-12-31" },
    });
    expect(hybridSearchMock).toHaveBeenCalledWith(
      "football",
      [0.1, 0.2],
      expect.objectContaining({
        startDate: "1980-01-01",
        endDate: "1980-12-31",
      }),
    );
  });
});
