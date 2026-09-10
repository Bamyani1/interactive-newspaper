import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  embedQueryMock,
  fuseArticleResultsMock,
  queryArticlesByEmbeddingMock,
  reformulateQueryMock,
  rerankArticlesMock,
  searchArticlesForRagMock,
  MockQuotaExhaustedError,
} = vi.hoisted(() => {
  // A real class, because retrieval.ts branches on QuotaExhaustedError by
  // identity to let quota errors past its stage tagging.
  class MockQuotaExhaustedError extends Error {
    constructor(op: string) {
      super(`Gemini API quota exhausted (${op})`);
      this.name = "QuotaExhaustedError";
    }
  }
  return {
    embedQueryMock: vi.fn(),
    fuseArticleResultsMock: vi.fn(),
    queryArticlesByEmbeddingMock: vi.fn(),
    reformulateQueryMock: vi.fn(),
    rerankArticlesMock: vi.fn(),
    searchArticlesForRagMock: vi.fn(),
    MockQuotaExhaustedError,
  };
});

vi.mock("@/src/lib/db", () => ({
  fuseArticleResults: fuseArticleResultsMock,
  queryArticlesByEmbedding: queryArticlesByEmbeddingMock,
  searchArticlesForRag: searchArticlesForRagMock,
}));
vi.mock("@/src/lib/embeddings", () => ({
  embedQuery: embedQueryMock,
  QuotaExhaustedError: MockQuotaExhaustedError,
}));
vi.mock("@/src/lib/query-reformulator", () => ({
  reformulateQuery: reformulateQueryMock,
}));
vi.mock("@/src/lib/reranker", () => ({ rerankArticles: rerankArticlesMock }));

import {
  agentCandidateLimitFor,
  rerankWithCorrectiveRetry,
  RetrievalSignalsUnavailableError,
  RetrievalStageError,
  retrieveCandidates,
  searchAndRankArchive,
} from "@/src/lib/retrieval";
import { RAG_EMBEDDING_MODEL, RAG_TEXT_EMBEDDING_INPUT_VERSION } from "@/src/lib/rag-model-config";

type LogEntry = Record<string, unknown>;
type LogSpy = { mock: { calls: unknown[][] } };

function parsedLogs(spy: LogSpy): LogEntry[] {
  return spy.mock.calls.map((call) => JSON.parse(String(call[0])) as LogEntry);
}

/** The most recent "retrieval completed" telemetry line. */
function lastRetrievalLog(spy: LogSpy): LogEntry {
  const entries = parsedLogs(spy).filter((entry) => entry.msg === "retrieval completed");
  expect(entries.length).toBeGreaterThan(0);
  return entries[entries.length - 1];
}

function darkVectorWarning(spy: LogSpy): LogEntry | undefined {
  return parsedLogs(spy).find((entry) =>
    String(entry.msg).startsWith("vector signal returned 0 rows")
  );
}

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

function retryParams(overrides: Record<string, unknown> = {}) {
  return {
    question: "How did the team change?",
    articles: [ftsCandidate],
    mode: "text" as const,
    maxArticles: 5,
    retrievalLimit: 20,
    vectorWeight: 0.6,
    onlyWithImages: false,
    ...overrides,
  };
}

function resetHappyPath() {
  embedQueryMock.mockResolvedValue([0.1, 0.2]);
  searchArticlesForRagMock.mockResolvedValue([ftsCandidate]);
  queryArticlesByEmbeddingMock.mockResolvedValue([vectorCandidate]);
  fuseArticleResultsMock.mockReturnValue([{ ...ftsCandidate, source: "both" as const }]);
  reformulateQueryMock.mockResolvedValue({
    embeddingQuery: "semantic terms",
    ftsQuery: "keyword terms",
    mode: "text",
    complexity: "simple",
  });
  rerankArticlesMock.mockResolvedValue([{ ...ftsCandidate, relevanceScore: 8 }]);
}

describe("canonical RAG retrieval", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    resetHappyPath();
  });

  it("starts lexical and embedding/vector branches independently", async () => {
    const controller = new AbortController();
    const result = await retrieveCandidates(
      candidateParams({
        filters: { category: "Sports" },
        timeoutMs: 5000,
        signal: controller.signal,
        requestId: "req-1",
      })
    );

    expect(searchArticlesForRagMock).toHaveBeenCalledWith("keywords", {
      limit: 20,
      category: "Sports",
      startDate: undefined,
      endDate: undefined,
      onlyWithImages: false,
      timeoutMs: 5000,
      signal: controller.signal,
      retrievalTarget: "legacy",
      temporalStratify: false,
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
      temporalStratify: false,
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

  it("stratifies across months for wide date ranges but not narrow ones", async () => {
    await retrieveCandidates(
      candidateParams({
        filters: { startDate: "1986-01-01", endDate: "1986-12-31" },
      })
    );
    expect(queryArticlesByEmbeddingMock).toHaveBeenLastCalledWith(
      [0.1, 0.2],
      expect.objectContaining({ temporalStratify: true })
    );

    await retrieveCandidates(
      candidateParams({
        filters: { startDate: "1986-03-01", endDate: "1986-03-31" },
      })
    );
    expect(queryArticlesByEmbeddingMock).toHaveBeenLastCalledWith(
      [0.1, 0.2],
      expect.objectContaining({ temporalStratify: false })
    );
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
      (vector: (typeof vectorCandidate)[], fts: (typeof ftsCandidate)[]) => [...fts, ...vector]
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
    expect(result.articles).toEqual([{ ...ftsCandidate, source: "both" }]);
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

  it("reports method 'none' when both signals succeed with zero rows", async () => {
    searchArticlesForRagMock.mockResolvedValue([]);
    queryArticlesByEmbeddingMock.mockResolvedValue([]);
    fuseArticleResultsMock.mockReturnValue([]);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await retrieveCandidates(candidateParams());

    expect(result.method).toBe("none");
    expect(result.articles).toEqual([]);
    expect(result.signals.fts).toEqual({ status: "success", count: 0 });
    expect(result.signals.vector).toEqual({ status: "success", count: 0 });
    expect(lastRetrievalLog(info).method).toBe("none");
    info.mockRestore();
  });

  it("labels config-derived log fields as configured, not as served-table facts", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await retrieveCandidates(candidateParams());

    const entry = lastRetrievalLog(info);
    expect(entry.configuredEmbeddingModel).toBe(RAG_EMBEDDING_MODEL);
    expect(entry.configuredTextEmbeddingInputVersion).toBe(RAG_TEXT_EMBEDDING_INPUT_VERSION);
    // The old names read as facts about the served table; they must be gone.
    expect(entry).not.toHaveProperty("embeddingModel");
    expect(entry).not.toHaveProperty("textEmbeddingInputVersion");
    info.mockRestore();
  });

  it("warns with the literal serving filter when the vector leg goes dark", async () => {
    vi.stubEnv("RAG_RETRIEVAL_MODE", "versioned");
    vi.stubEnv("RAG_ACTIVE_INDEX_BUILD_ID", "build-live");
    queryArticlesByEmbeddingMock.mockResolvedValue([]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await retrieveCandidates(candidateParams());

    expect(darkVectorWarning(warn)).toMatchObject({
      level: "warn",
      route: "/api/ask",
      stage: "retrieve",
      signal: "vector",
      msg: "vector signal returned 0 rows while full-text returned rows; run npm run rag:health",
      servedTable: "article_chunks",
      vectorFilter: {
        indexBuildId: "build-live",
        embeddingModel: RAG_EMBEDDING_MODEL,
        embeddingInputVersion: RAG_TEXT_EMBEDDING_INPUT_VERSION,
      },
    });
    warn.mockRestore();
  });

  it("names the legacy served table when legacy retrieval's vector leg goes dark", async () => {
    queryArticlesByEmbeddingMock.mockResolvedValue([]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await retrieveCandidates(candidateParams());

    expect(darkVectorWarning(warn)).toMatchObject({
      servedTable: "articles",
      vectorFilter: { indexBuildId: null },
    });
    warn.mockRestore();
  });

  it("stays quiet when the vector leg returns rows, or when neither leg does", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await retrieveCandidates(candidateParams());
    expect(darkVectorWarning(warn)).toBeUndefined();

    searchArticlesForRagMock.mockResolvedValue([]);
    queryArticlesByEmbeddingMock.mockResolvedValue([]);
    fuseArticleResultsMock.mockReturnValue([]);
    await retrieveCandidates(candidateParams());
    // Both legs empty is an ordinary empty-result question, not a dark leg.
    expect(darkVectorWarning(warn)).toBeUndefined();
    warn.mockRestore();
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
      RetrievalSignalsUnavailableError
    );
  });

  it("performs exactly one broader corrective retry through the same service", async () => {
    rerankArticlesMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...ftsCandidate, relevanceScore: 7 }]);
    const result = await rerankWithCorrectiveRetry(retryParams());

    expect(reformulateQueryMock).toHaveBeenCalledTimes(1);
    expect(searchArticlesForRagMock).toHaveBeenCalledTimes(1);
    expect(embedQueryMock).toHaveBeenCalledTimes(1);
    expect(rerankArticlesMock).toHaveBeenCalledTimes(2);
    expect(result[0].relevanceScore).toBe(7);
  });

  it("falls back to fused order at score 5 when both rerank passes keep nothing", async () => {
    rerankArticlesMock.mockResolvedValue([]);
    const result = await rerankWithCorrectiveRetry(
      retryParams({ question: "what happened in 1965?" })
    );

    expect(rerankArticlesMock).toHaveBeenCalledTimes(2);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].relevanceScore).toBe(5);
  });

  // Unjudged photos in fused order answered "protests on campus" with a
  // march in Washington. A twice-vetoed photo search has nothing to show.
  it("returns no photos when both visual rerank passes keep nothing", async () => {
    rerankArticlesMock.mockResolvedValue([]);
    const result = await rerankWithCorrectiveRetry(
      retryParams({ question: "Show me photos of protests on campus", mode: "visual" })
    );

    expect(rerankArticlesMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual([]);
  });

  // The ask route re-tags these onto its own StageError to name the failing
  // step in an error response, so each stage must be distinguishable here.
  it("tags a first-pass rerank failure with stage 'rerank'", async () => {
    rerankArticlesMock.mockRejectedValue(new Error("reranker crashed"));

    const error = await rerankWithCorrectiveRetry(retryParams()).catch((e) => e);
    expect(error).toBeInstanceOf(RetrievalStageError);
    expect(error).toMatchObject({
      stage: "rerank",
      message: "reranker crashed",
    });
    expect(reformulateQueryMock).not.toHaveBeenCalled();
  });

  it("tags each corrective-retry step with its own stage", async () => {
    const cases: Array<[string, () => void]> = [
      [
        "reformulate-retry",
        () => reformulateQueryMock.mockRejectedValue(new Error("reformulator down")),
      ],
      [
        "retrieve-retry",
        () => {
          searchArticlesForRagMock.mockRejectedValue(new Error("fts down"));
          embedQueryMock.mockRejectedValue(new Error("embed down"));
        },
      ],
      [
        "rerank-retry",
        () =>
          rerankArticlesMock
            .mockResolvedValueOnce([])
            .mockRejectedValueOnce(new Error("retry reranker crashed")),
      ],
    ];

    for (const [stage, arrange] of cases) {
      vi.clearAllMocks();
      resetHappyPath();
      // Empty first pass is what triggers the retry at all.
      rerankArticlesMock.mockResolvedValue([]);
      arrange();

      await expect(rerankWithCorrectiveRetry(retryParams())).rejects.toMatchObject({
        name: "RetrievalStageError",
        stage,
      });
    }
  });

  it("lets a quota error past untagged so callers can still map it to 429", async () => {
    const quota = new MockQuotaExhaustedError("rerankArticles");
    rerankArticlesMock.mockRejectedValue(quota);

    await expect(rerankWithCorrectiveRetry(retryParams())).rejects.toBe(quota);
  });

  it("carries the retrieval failure's own error as the retrieve-retry cause", async () => {
    rerankArticlesMock.mockResolvedValue([]);
    searchArticlesForRagMock.mockRejectedValue(new Error("fts down"));
    const quota = new MockQuotaExhaustedError("embedQuery");
    embedQueryMock.mockRejectedValue(quota);

    // Both legs failed, so retrieveCandidates throws the typed aggregate; the
    // stage wrapper must preserve it rather than flattening to a message.
    const error = await rerankWithCorrectiveRetry(retryParams()).catch((e) => e);
    expect(error).toMatchObject({
      name: "RetrievalStageError",
      stage: "retrieve-retry",
    });
    expect(error.cause).toBeInstanceOf(RetrievalSignalsUnavailableError);
    expect(error.cause.vectorError).toBe(quota);
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
      expect.objectContaining({ limit: agentCandidateLimitFor("visual"), onlyWithImages: true })
    );
    expect(rerankArticlesMock).toHaveBeenCalledWith(
      "Show homecoming photos",
      expect.any(Array),
      expect.objectContaining({ maxArticles: 7, minScore: 3 })
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
      })
    );
  });
});
