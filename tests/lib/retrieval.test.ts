import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  embedQueryMock,
  fuseArticleResultsMock,
  queryArticlesByEmbeddingMock,
  reformulateQueryMock,
  rerankArticlesMock,
  searchArticlesForRagMock,
} = vi.hoisted(() => ({
  embedQueryMock: vi.fn(),
  fuseArticleResultsMock: vi.fn(),
  queryArticlesByEmbeddingMock: vi.fn(),
  reformulateQueryMock: vi.fn(),
  rerankArticlesMock: vi.fn(),
  searchArticlesForRagMock: vi.fn(),
}));

vi.mock("@/src/lib/db", () => ({
  fuseArticleResults: fuseArticleResultsMock,
  queryArticlesByEmbedding: queryArticlesByEmbeddingMock,
  searchArticlesForRag: searchArticlesForRagMock,
}));
vi.mock("@/src/lib/embeddings", () => ({ embedQuery: embedQueryMock }));
vi.mock("@/src/lib/query-reformulator", () => ({
  reformulateQuery: reformulateQueryMock,
}));
vi.mock("@/src/lib/reranker", () => ({ rerankArticles: rerankArticlesMock }));

import {
  rerankWithCorrectiveRetry,
  RetrievalSignalsUnavailableError,
  retrieveCandidates,
  searchAndRankArchive,
} from "@/src/lib/retrieval";

const ftsCandidate = {
  id: "1965-03-15-4",
  editionDate: "1965-03-15",
  category: "Sports",
  headline: "Bishops Win",
  summary: "Summary",
  byline: null,
  bodyPlain: "Body",
  distance: null,
  source: "fts" as const,
  imageUrls: [],
  imageCaptions: [],
  matchedPassages: ["Lexical evidence"],
};

const vectorCandidate = {
  ...ftsCandidate,
  distance: 0.2,
  source: "vector" as const,
  matchedPassages: [],
};

function candidateParams(overrides: Record<string, unknown> = {}) {
  return {
    embeddingQuery: "semantic",
    ftsQuery: "keywords",
    limit: 20,
    vectorWeight: 0.6,
    onlyWithImages: false,
    ...overrides,
  };
}

describe("canonical RAG retrieval", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    embedQueryMock.mockResolvedValue([0.1, 0.2]);
    searchArticlesForRagMock.mockResolvedValue([ftsCandidate]);
    queryArticlesByEmbeddingMock.mockResolvedValue([vectorCandidate]);
    fuseArticleResultsMock.mockReturnValue([
      { ...ftsCandidate, source: "both" as const },
    ]);
    reformulateQueryMock.mockResolvedValue({
      embeddingQuery: "semantic terms",
      ftsQuery: "keyword terms",
      mode: "text",
      complexity: "simple",
    });
    rerankArticlesMock.mockResolvedValue([
      { ...ftsCandidate, relevanceScore: 8 },
    ]);
  });

  it("starts lexical and embedding/vector branches independently", async () => {
    const controller = new AbortController();
    const result = await retrieveCandidates(candidateParams({
      filters: { category: "Sports" },
      timeoutMs: 5000,
      signal: controller.signal,
      requestId: "req-1",
    }));

    expect(searchArticlesForRagMock).toHaveBeenCalledWith("keywords", {
      limit: 20,
      category: "Sports",
      startDate: undefined,
      endDate: undefined,
      onlyWithImages: false,
      timeoutMs: 5000,
      signal: controller.signal,
      retrievalTarget: "legacy",
    });
    expect(embedQueryMock).toHaveBeenCalledWith("semantic", {
      signal: controller.signal,
      requestId: "req-1",
    });
    expect(queryArticlesByEmbeddingMock).toHaveBeenCalledWith([0.1, 0.2], {
      limit: 20,
      category: "Sports",
      startDate: null,
      endDate: null,
      onlyWithImages: false,
      timeoutMs: 5000,
      signal: controller.signal,
      retrievalTarget: "legacy",
    });
    expect(result).toMatchObject({
      method: "hybrid",
      servedTarget: "legacy",
      signals: {
        fts: { status: "success", count: 1 },
        vector: { status: "success", count: 1 },
      },
    });
  });

  it("serves legacy while measuring a versioned shadow with one embedding call", async () => {
    vi.stubEnv("RAG_RETRIEVAL_MODE", "shadow");
    vi.stubEnv("RAG_ACTIVE_INDEX_BUILD_ID", "candidate-a");
    vi.stubEnv("RAG_CORPUS_VERSION", "corpus-a");
    const shadowFts = { ...ftsCandidate, id: "shadow-fts" };
    const shadowVector = { ...vectorCandidate, id: "shadow-vector" };
    searchArticlesForRagMock
      .mockResolvedValueOnce([ftsCandidate])
      .mockResolvedValueOnce([shadowFts]);
    queryArticlesByEmbeddingMock
      .mockResolvedValueOnce([vectorCandidate])
      .mockResolvedValueOnce([shadowVector]);
    fuseArticleResultsMock.mockImplementation(
      (vector: typeof vectorCandidate[], fts: typeof ftsCandidate[]) => [
        ...fts,
        ...vector,
      ],
    );

    const result = await retrieveCandidates(candidateParams());

    expect(result.servedTarget).toBe("legacy");
    expect(result.identity.activeIndexBuildId).toBe("candidate-a");
    expect(result.articles.map((article) => article.id)).toEqual([
      ftsCandidate.id,
      vectorCandidate.id,
    ]);
    expect(result.shadow?.articles.map((article) => article.id)).toEqual([
      "shadow-fts",
      "shadow-vector",
    ]);
    expect(embedQueryMock).toHaveBeenCalledTimes(1);
    expect(searchArticlesForRagMock).toHaveBeenCalledTimes(2);
    expect(queryArticlesByEmbeddingMock).toHaveBeenCalledTimes(2);
    expect(searchArticlesForRagMock.mock.calls[0][1]).toMatchObject({
      retrievalTarget: "legacy",
    });
    expect(searchArticlesForRagMock.mock.calls[1][1]).toMatchObject({
      retrievalTarget: "versioned",
    });
  });

  it("never lets a failed shadow candidate alter the served legacy result", async () => {
    vi.stubEnv("RAG_RETRIEVAL_MODE", "shadow");
    vi.stubEnv("RAG_ACTIVE_INDEX_BUILD_ID", "candidate-a");
    searchArticlesForRagMock
      .mockResolvedValueOnce([ftsCandidate])
      .mockRejectedValueOnce(new Error("candidate FTS unavailable"));
    queryArticlesByEmbeddingMock
      .mockResolvedValueOnce([vectorCandidate])
      .mockRejectedValueOnce(new Error("candidate vector unavailable"));

    const result = await retrieveCandidates(candidateParams());

    expect(result.servedTarget).toBe("legacy");
    expect(result.method).toBe("hybrid");
    expect(result.articles).toEqual([
      { ...ftsCandidate, source: "both" },
    ]);
    expect(result.shadow?.articles).toEqual([]);
    expect(result.shadow?.signals.fts.status).toBe("failed");
    expect(result.shadow?.signals.vector.status).toBe("failed");
  });

  it("returns FTS results when query embedding fails", async () => {
    embedQueryMock.mockRejectedValue(new Error("embedding unavailable"));
    const result = await retrieveCandidates(candidateParams());

    expect(result.method).toBe("fts");
    expect(result.articles).toEqual([ftsCandidate]);
    expect(result.signals.vector.status).toBe("failed");
    expect(queryArticlesByEmbeddingMock).not.toHaveBeenCalled();
  });

  it("returns vector results when FTS fails", async () => {
    searchArticlesForRagMock.mockRejectedValue(new Error("FTS unavailable"));
    const result = await retrieveCandidates(candidateParams());

    expect(result.method).toBe("vector");
    expect(result.articles).toEqual([vectorCandidate]);
    expect(result.signals.fts.status).toBe("failed");
  });

  it("reports FTS truthfully when the configured vector label has no rows", async () => {
    queryArticlesByEmbeddingMock.mockResolvedValue([]);
    const result = await retrieveCandidates(candidateParams());

    expect(result.method).toBe("fts");
    expect(result.rawVector).toEqual([]);
    expect(fuseArticleResultsMock).toHaveBeenCalledWith([], [ftsCandidate], {
      limit: 20,
      vectorWeight: 0.6,
    });
  });

  it("throws a typed error only when neither signal succeeds", async () => {
    searchArticlesForRagMock.mockRejectedValue(new Error("FTS unavailable"));
    embedQueryMock.mockRejectedValue(new Error("embedding unavailable"));

    await expect(retrieveCandidates(candidateParams())).rejects.toMatchObject({
      name: "RetrievalSignalsUnavailableError",
      ftsError: expect.any(Error),
      vectorError: expect.any(Error),
    });
    await expect(retrieveCandidates(candidateParams())).rejects.toBeInstanceOf(
      RetrievalSignalsUnavailableError,
    );
  });

  it("performs exactly one broader corrective retry through the same service", async () => {
    rerankArticlesMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...ftsCandidate, relevanceScore: 7 }]);
    const result = await rerankWithCorrectiveRetry({
      question: "How did the team change?",
      articles: [ftsCandidate],
      mode: "text",
      maxArticles: 5,
      retrievalLimit: 20,
      vectorWeight: 0.6,
      onlyWithImages: false,
    });

    expect(reformulateQueryMock).toHaveBeenCalledTimes(1);
    expect(searchArticlesForRagMock).toHaveBeenCalledTimes(1);
    expect(embedQueryMock).toHaveBeenCalledTimes(1);
    expect(rerankArticlesMock).toHaveBeenCalledTimes(2);
    expect(result[0].relevanceScore).toBe(7);
  });

  it("uses the same service for agent searches and visual retrieval", async () => {
    reformulateQueryMock.mockResolvedValue({
      embeddingQuery: "homecoming photographs",
      ftsQuery: "homecoming parade",
      mode: "visual",
      complexity: "simple",
    });
    const result = await searchAndRankArchive({
      question: "Show homecoming photos",
      maxArticles: 7,
      requestId: "agent-1",
    });

    expect(searchArticlesForRagMock).toHaveBeenCalledWith(
      "homecoming parade",
      expect.objectContaining({ limit: 20, onlyWithImages: true }),
    );
    expect(rerankArticlesMock).toHaveBeenCalledWith(
      "Show homecoming photos",
      expect.any(Array),
      expect.objectContaining({ maxArticles: 7, minScore: 3 }),
    );
    expect(result.mode).toBe("visual");
  });

  it("applies inferred dates but keeps caller filters authoritative", async () => {
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
    expect(searchArticlesForRagMock).toHaveBeenCalledWith(
      "football",
      expect.objectContaining({
        startDate: "1980-01-01",
        endDate: "1980-12-31",
      }),
    );
  });
});
