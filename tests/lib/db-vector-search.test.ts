/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock setup ────────────────────────────────────────────────────────
// vi.hoisted ensures mockSql is available when vi.mock (which is hoisted) runs.
const { mockSql } = vi.hoisted(() => {
  const fn = vi.fn() as ReturnType<typeof vi.fn> & { transaction: ReturnType<typeof vi.fn> };
  fn.transaction = vi.fn();
  return { mockSql: fn };
});
vi.mock("@neondatabase/serverless", () => ({
  neon: vi.fn(() => mockSql),
}));

import {
  queryArticlesByEmbedding,
  searchArticlesForRag,
  hybridSearch,
  DbTimeoutError,
  _clearHybridSearchCacheForTests,
  _setRagV2TablesAvailableForTests,
  _setRagIndexBuildReadyForTests,
  legacyContentRevisionId,
} from "@/src/lib/db";

// ── Helpers ───────────────────────────────────────────────────────────

function makeVectorRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "1960-01-07-0",
    edition_date: "1960-01-07",
    category: "News",
    headline: "Test Headline",
    summary: "Test summary",
    byline: "Test Author",
    body_plain: "Test body",
    image_urls: [],
    image_captions: [],
    distance: "0.2500",
    ...overrides,
  };
}

function makeFtsRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "1960-01-07-1",
    edition_date: "1960-01-07",
    category: "Sports",
    headline: "Game Results",
    summary: "Sports summary",
    byline: null,
    body_plain: "Sports body",
    image_urls: [],
    image_captions: [],
    rank: "0.8500",
    ...overrides,
  };
}

const DUMMY_EMBEDDING = Array.from({ length: 3 }, (_, i) => i * 0.1);

beforeEach(() => {
  vi.unstubAllEnvs();
  _setRagIndexBuildReadyForTests(null);
});

// ── queryArticlesByEmbedding ──────────────────────────────────────────

describe("queryArticlesByEmbedding", () => {
  beforeEach(() => {
    mockSql.mockReset();
    mockSql.transaction.mockReset();
    _setRagV2TablesAvailableForTests(false);
  });

  it("returns mapped results with correct fields and source 'vector'", async () => {
    const rows = [
      makeVectorRow({ id: "1960-01-07-0", distance: "0.2500" }),
      makeVectorRow({ id: "1960-01-07-1", headline: "Second Article", distance: "0.4000" }),
    ];
    // sql.transaction returns [SET_LOCAL_result, SELECT_result]
    mockSql.transaction.mockResolvedValueOnce([[], rows]);

    const results = await queryArticlesByEmbedding(DUMMY_EMBEDDING);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      id: "1960-01-07-0",
      editionDate: "1960-01-07",
      category: "News",
      headline: "Test Headline",
      summary: "Test summary",
      byline: "Test Author",
      bodyPlain: "Test body",
      distance: 0.25,
      source: "vector",
      imageUrls: [],
      imageCaptions: [],
      contentRevisionId: expect.stringMatching(/^legacy-sha256:[a-f0-9]{64}$/),
      matchedPassages: [],
    });
    expect(results[1].headline).toBe("Second Article");
    expect(results[1].distance).toBe(0.4);
    expect(results[1].source).toBe("vector");
  });

  it("uses a deterministic legacy revision that changes with article content", () => {
    const article = {
      id: "1960-01-07-0",
      editionDate: "1960-01-07",
      category: "News",
      headline: "Headline",
      summary: "Summary",
      byline: null,
      bodyPlain: "Original body",
      imageUrls: [],
      imageCaptions: [],
    };
    expect(legacyContentRevisionId(article)).toBe(legacyContentRevisionId(article));
    expect(
      legacyContentRevisionId({ ...article, bodyPlain: "Revised body" }),
    ).not.toBe(legacyContentRevisionId(article));
  });

  it("respects the limit option", async () => {
    mockSql.transaction.mockResolvedValueOnce([[], []]);

    await queryArticlesByEmbedding(DUMMY_EMBEDDING, { limit: 5 });

    expect(mockSql.transaction).toHaveBeenCalledTimes(1);
  });

  it("never compares a stable query vector with an old-model article vector", async () => {
    mockSql.transaction.mockResolvedValueOnce([[], []]);
    await queryArticlesByEmbedding(DUMMY_EMBEDDING);
    const renderedSql = mockSql.mock.calls
      .map((call) => Array.isArray(call[0]) ? call[0].join(" ") : "")
      .join(" ");
    expect(renderedSql).toContain("a.embedding_model =");
  });

  it("returns empty array when no rows match", async () => {
    mockSql.transaction.mockResolvedValueOnce([[], []]);

    const results = await queryArticlesByEmbedding(DUMMY_EMBEDDING);

    expect(results).toEqual([]);
  });

  it("handles null byline correctly", async () => {
    const rows = [makeVectorRow({ byline: null })];
    mockSql.transaction.mockResolvedValueOnce([[], rows]);

    const results = await queryArticlesByEmbedding(DUMMY_EMBEDDING);

    expect(results[0].byline).toBeNull();
  });

  it("coalesces null distance to null (not NaN) — issue 0006", async () => {
    const rows = [makeVectorRow({ distance: null })];
    mockSql.transaction.mockResolvedValueOnce([[], rows]);

    const results = await queryArticlesByEmbedding(DUMMY_EMBEDDING);

    expect(results[0].distance).toBeNull();
    expect(Number.isNaN(results[0].distance)).toBe(false);
  });

  it("coalesces undefined distance to null (not NaN) — issue 0006", async () => {
    const rows = [makeVectorRow({ distance: undefined })];
    mockSql.transaction.mockResolvedValueOnce([[], rows]);

    const results = await queryArticlesByEmbedding(DUMMY_EMBEDDING);

    expect(results[0].distance).toBeNull();
  });

  it("coalesces 'NaN' string distance to null — issue 0006", async () => {
    const rows = [makeVectorRow({ distance: "NaN" })];
    mockSql.transaction.mockResolvedValueOnce([[], rows]);

    const results = await queryArticlesByEmbedding(DUMMY_EMBEDDING);

    expect(results[0].distance).toBeNull();
  });

  it("coalesces non-numeric distance string to null — issue 0006", async () => {
    const rows = [makeVectorRow({ distance: "not a number" })];
    mockSql.transaction.mockResolvedValueOnce([[], rows]);

    const results = await queryArticlesByEmbedding(DUMMY_EMBEDDING);

    expect(results[0].distance).toBeNull();
  });

  it("preserves valid decimal distance", async () => {
    const rows = [makeVectorRow({ distance: "0.1234" })];
    mockSql.transaction.mockResolvedValueOnce([[], rows]);

    const results = await queryArticlesByEmbedding(DUMMY_EMBEDDING);

    expect(results[0].distance).toBeCloseTo(0.1234, 4);
  });

  // Signal + timeout handling (Step 2 / senior-engineer review fix)
  // The vector-only fallback path in /api/ask was calling
  // queryArticlesByEmbedding without a signal, so a hung DB call would
  // orphan until the global deadline fired. Now the function has its
  // own early-exit + raceWithTimeout guard.

  it("throws DbTimeoutError immediately if signal is pre-aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      queryArticlesByEmbedding(DUMMY_EMBEDDING, {
        signal: controller.signal,
        timeoutMs: 5000,
      }),
    ).rejects.toBeInstanceOf(DbTimeoutError);

    // Must NOT have touched sql.transaction — we short-circuited
    expect(mockSql.transaction).not.toHaveBeenCalled();
  });

  it("throws DbTimeoutError when sql.transaction hangs past the timeout", async () => {
    mockSql.transaction.mockImplementationOnce(
      () => new Promise<never>(() => {}),
    );

    const start = Date.now();
    await expect(
      queryArticlesByEmbedding(DUMMY_EMBEDDING, { timeoutMs: 100 }),
    ).rejects.toBeInstanceOf(DbTimeoutError);
    const elapsed = Date.now() - start;

    // Must fire near the budget, not hang on the fake transaction
    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(400);
  });

  it("DbTimeoutError from queryArticlesByEmbedding carries op name + budget", async () => {
    const controller = new AbortController();
    controller.abort();

    try {
      await queryArticlesByEmbedding(DUMMY_EMBEDDING, {
        signal: controller.signal,
        timeoutMs: 3000,
      });
      throw new Error("expected DbTimeoutError");
    } catch (err) {
      expect(err).toBeInstanceOf(DbTimeoutError);
      if (err instanceof DbTimeoutError) {
        expect(err.op).toBe("queryArticlesByEmbedding");
        expect(err.timeoutMs).toBe(3000);
      }
    }
  });
});

describe("queryArticlesByEmbedding with RAG v2 tables", () => {
  beforeEach(() => {
    mockSql.mockReset();
    mockSql.transaction.mockReset();
    _setRagV2TablesAvailableForTests(true);
    _setRagIndexBuildReadyForTests(true);
    vi.stubEnv("RAG_RETRIEVAL_MODE", "versioned");
    vi.stubEnv("RAG_ACTIVE_INDEX_BUILD_ID", "test-index-build");
  });

  it("does not activate from table existence while retrieval mode is legacy", async () => {
    vi.stubEnv("RAG_RETRIEVAL_MODE", "legacy");
    mockSql.transaction.mockResolvedValueOnce([[], [makeVectorRow()]]);

    const results = await queryArticlesByEmbedding(DUMMY_EMBEDDING);

    expect(results).toHaveLength(1);
    expect(mockSql.transaction.mock.calls[0][0]).toHaveLength(2);
  });

  it("aggregates multiple matching chunks into article-local evidence", async () => {
    mockSql.transaction.mockResolvedValueOnce([
      [],
      [],
      [
        makeVectorRow({ id: "article-a", chunk_text: "Late paragraph one.", distance: "0.10" }),
        makeVectorRow({ id: "article-a", chunk_text: "Late paragraph two.", distance: "0.12" }),
        makeVectorRow({ id: "article-b", chunk_text: "Another article.", distance: "0.15" }),
      ],
    ]);
    const controller = new AbortController();
    const results = await queryArticlesByEmbedding(DUMMY_EMBEDDING, {
      limit: 2,
      signal: controller.signal,
    });

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("article-a");
    expect(results[0].matchedPassages).toEqual([
      "Late paragraph one.",
      "Late paragraph two.",
    ]);
    expect(mockSql.transaction.mock.calls[0][1]).toEqual({
      readOnly: true,
      fetchOptions: { signal: expect.any(AbortSignal) },
    });
    const renderedSql = mockSql.mock.calls
      .map((call) => (Array.isArray(call[0]) ? call[0].join(" ") : ""))
      .join(" ");
    expect(renderedSql).toContain("PARTITION BY c.article_id");
    expect(renderedSql).toContain("ranked_articles");
    expect(renderedSql).toContain("e.evidence_rank <=");
    expect(renderedSql).toContain("index_build_id =");
    expect(
      mockSql.mock.calls.some((call) => call.includes("test-index-build")),
    ).toBe(true);
  });

  it("fails closed instead of querying an unready configured build", async () => {
    _setRagIndexBuildReadyForTests(false);

    await expect(queryArticlesByEmbedding(DUMMY_EMBEDDING)).rejects.toThrow(
      "not ready",
    );
    expect(mockSql.transaction).not.toHaveBeenCalled();
  });

  it("uses a separately embedded image result and promotes that image", async () => {
    mockSql.transaction.mockResolvedValueOnce([
      [],
      [],
      [
        makeVectorRow({
          id: "visual-a",
          image_urls: ["first.jpg", "matched.jpg"],
          image_captions: ["First", "Matched"],
          matched_image_url: "matched.jpg",
          matched_caption: "Matched",
          distance: "0.08",
        }),
      ],
    ]);
    const [result] = await queryArticlesByEmbedding(DUMMY_EMBEDDING, {
      onlyWithImages: true,
    });
    expect(result.imageUrls).toEqual(["matched.jpg", "first.jpg"]);
    expect(result.imageCaptions).toEqual(["Matched", "First"]);
    expect(result.matchedPassages).toEqual(["Matched"]);
  });
});

describe("searchArticlesForRag with RAG v2 evidence", () => {
  beforeEach(() => {
    mockSql.mockReset();
    mockSql.transaction.mockReset();
    _setRagV2TablesAvailableForTests(true);
    _setRagIndexBuildReadyForTests(true);
    vi.stubEnv("RAG_RETRIEVAL_MODE", "versioned");
    vi.stubEnv("RAG_ACTIVE_INDEX_BUILD_ID", "test-index-build");
  });

  it("deduplicates article rows while retaining bounded evidence", async () => {
    mockSql.transaction.mockResolvedValueOnce([[
      makeFtsRow({
        id: "article-a",
        chunk_text: "Headline evidence.",
      }),
      makeFtsRow({
        id: "article-a",
        chunk_text: "Matching body passage.",
      }),
      makeFtsRow({
        id: "article-b",
        chunk_text: "A different article.",
      }),
    ]]);

    const results = await searchArticlesForRag("campus history", { limit: 2 });

    expect(results.map((result) => result.id)).toEqual(["article-a", "article-b"]);
    expect(results[0].matchedPassages).toEqual([
      "Headline evidence.",
      "Matching body passage.",
    ]);
  });

  it("ranks caption evidence and promotes the exact matched registered image", async () => {
    mockSql.transaction.mockResolvedValueOnce([[
      makeFtsRow({
        id: "visual-a",
        image_urls: ["first.jpg", "matched.jpg"],
        image_captions: ["First", "Matched caption"],
        chunk_text: "Article evidence.",
      }),
      makeFtsRow({
        id: "visual-a",
        image_urls: ["first.jpg", "matched.jpg"],
        image_captions: ["First", "Matched caption"],
        chunk_text: null,
        matched_image_url: "matched.jpg",
        matched_caption: "Matched caption",
      }),
    ]]);

    const [result] = await searchArticlesForRag("matched caption", {
      onlyWithImages: true,
    });

    expect(result.imageUrls).toEqual(["matched.jpg", "first.jpg"]);
    expect(result.imageCaptions).toEqual(["Matched caption", "First"]);
    expect(result.matchedPassages).toEqual([
      "Article evidence.",
      "Matched caption",
    ]);
    const renderedSql = mockSql.mock.calls
      .map((call) => (Array.isArray(call[0]) ? call[0].join(" ") : ""))
      .join(" ");
    expect(renderedSql).toContain("caption_matches");
    expect(renderedSql).toContain("article_images");
    expect(renderedSql).toContain("PARTITION BY e.id");
    expect(renderedSql).toContain("ranked_articles");
    expect(renderedSql).toContain("i.index_build_id =");
    expect(renderedSql).toContain("c.index_build_id =");
    expect(
      mockSql.mock.calls.some((call) => call.includes("test-index-build")),
    ).toBe(true);
  });
});

// ── hybridSearch ──────────────────────────────────────────────────────

describe("hybridSearch", () => {
  beforeEach(() => {
    mockSql.mockReset();
    mockSql.transaction.mockReset();
    _clearHybridSearchCacheForTests();
    _setRagV2TablesAvailableForTests(false);
  });

  // Both retrieval branches now use read-only Neon transactions so the same
  // AbortSignal reaches the underlying fetch.
  function mockHybridCalls(vectorRows: Record<string, unknown>[], ftsRows: Record<string, unknown>[]) {
    mockSql.mockResolvedValue([]);
    mockSql.transaction.mockImplementation(
      async (queries: unknown[]) =>
        queries.length === 2 ? [[], vectorRows] : [ftsRows],
    );
  }

  it("merges vector and FTS results sorted by RRF score", async () => {
    const vectorRows = [
      makeVectorRow({ id: "vec-1", headline: "Vector Article 1", distance: "0.1000" }),
      makeVectorRow({ id: "vec-2", headline: "Vector Article 2", distance: "0.3000" }),
    ];
    const ftsRows = [
      makeFtsRow({ id: "fts-1", headline: "FTS Article 1", rank: "0.9000" }),
      makeFtsRow({ id: "fts-2", headline: "FTS Article 2", rank: "0.5000" }),
    ];
    mockHybridCalls(vectorRows, ftsRows);

    const results = await hybridSearch("test question", DUMMY_EMBEDDING);

    expect(results.length).toBe(4);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("vec-1");
    expect(ids).toContain("vec-2");
    expect(ids).toContain("fts-1");
    expect(ids).toContain("fts-2");
    expect(results[0].id).toBe("vec-1");
  });

  it("deduplicates articles found by both vector and FTS", async () => {
    const sharedId = "1960-01-07-0";
    const vectorRows = [
      makeVectorRow({ id: sharedId, headline: "Shared Article", distance: "0.1500" }),
      makeVectorRow({ id: "vec-only", headline: "Vector Only", distance: "0.3000" }),
    ];
    const ftsRows = [
      makeFtsRow({ id: sharedId, headline: "Shared Article", rank: "0.9000" }),
      makeFtsRow({ id: "fts-only", headline: "FTS Only", rank: "0.5000" }),
    ];
    mockHybridCalls(vectorRows, ftsRows);

    const results = await hybridSearch("test question", DUMMY_EMBEDDING);

    const sharedOccurrences = results.filter((r) => r.id === sharedId);
    expect(sharedOccurrences).toHaveLength(1);
    expect(results).toHaveLength(3);
    expect(results[0].id).toBe(sharedId);
  });

  it("marks FTS-only articles with source 'fts'", async () => {
    const vectorRows = [makeVectorRow({ id: "vec-1", distance: "0.1000" })];
    const ftsRows = [makeFtsRow({ id: "fts-1", rank: "0.9000" })];
    mockHybridCalls(vectorRows, ftsRows);

    const results = await hybridSearch("test question", DUMMY_EMBEDDING);

    const ftsArticle = results.find((r) => r.id === "fts-1");
    expect(ftsArticle).toBeDefined();
    expect(ftsArticle!.source).toBe("fts");
    expect(ftsArticle!.distance).toBeNull();
  });

  it("marks vector-only articles with source 'vector'", async () => {
    const vectorRows = [makeVectorRow({ id: "vec-1", distance: "0.1000" })];
    const ftsRows = [makeFtsRow({ id: "fts-1", rank: "0.9000" })];
    mockHybridCalls(vectorRows, ftsRows);

    const results = await hybridSearch("test question", DUMMY_EMBEDDING);

    const vectorArticle = results.find((r) => r.id === "vec-1");
    expect(vectorArticle).toBeDefined();
    expect(vectorArticle!.source).toBe("vector");
  });

  it("respects the limit option", async () => {
    const vectorRows = [
      makeVectorRow({ id: "v1", distance: "0.1000" }),
      makeVectorRow({ id: "v2", distance: "0.2000" }),
      makeVectorRow({ id: "v3", distance: "0.3000" }),
    ];
    const ftsRows = [
      makeFtsRow({ id: "f1", rank: "0.9000" }),
      makeFtsRow({ id: "f2", rank: "0.7000" }),
      makeFtsRow({ id: "f3", rank: "0.5000" }),
    ];
    mockHybridCalls(vectorRows, ftsRows);

    const results = await hybridSearch("test question", DUMMY_EMBEDDING, { limit: 3 });

    expect(results.length).toBeLessThanOrEqual(3);
  });

  // Helper: make both underlying calls hang forever so the timeout wrapper
  // is the only thing that can settle the promise. Queues the same three
  // mockSql returns as mockHybridCalls (SET LOCAL + SELECT inside the
  // vector transaction array, FTS query call) plus one sql.transaction.
  function mockHybridHang() {
    const hang = () => new Promise<never>(() => {});
    mockSql.mockResolvedValue([]);
    mockSql.transaction
      .mockImplementationOnce(hang)
      .mockImplementationOnce(hang);
  }

  it("throws DbTimeoutError when sql hangs past the timeout budget", async () => {
    mockHybridHang();

    const start = Date.now();
    await expect(
      hybridSearch("test question", DUMMY_EMBEDDING, { timeoutMs: 100 }),
    ).rejects.toBeInstanceOf(DbTimeoutError);
    const elapsed = Date.now() - start;

    // The promise should reject near the 100ms budget, not block on the hung sql.
    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(400);
  });

  it("DbTimeoutError carries op name and timeout budget for diagnostics", async () => {
    mockHybridHang();

    try {
      await hybridSearch("test question", DUMMY_EMBEDDING, { timeoutMs: 80 });
      throw new Error("expected DbTimeoutError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DbTimeoutError);
      if (err instanceof DbTimeoutError) {
        expect(err.op).toMatch(/queryArticlesByEmbedding|searchArticlesForRag/);
        expect(err.timeoutMs).toBe(80);
        expect(err.name).toBe("DbTimeoutError");
        expect(err.message).toMatch(/queryArticlesByEmbedding|searchArticlesForRag/);
        expect(err.message).toContain("80ms");
      }
    }
  });

  // Hybrid-search result cache (5min TTL, LRU).
  // Repeated identical questions within the same function instance skip
  // the double SQL round trip + RRF merge.

  it("caches results: second identical call skips the SQL round trip", async () => {
    const vectorRows = [makeVectorRow({ id: "cached-v1", distance: "0.1000" })];
    const ftsRows = [makeFtsRow({ id: "cached-f1", rank: "0.9000" })];
    mockHybridCalls(vectorRows, ftsRows);

    // First call populates cache
    const first = await hybridSearch("cache-me", DUMMY_EMBEDDING);
    expect(first.length).toBe(2);
    expect(mockSql.transaction).toHaveBeenCalledTimes(2);

    // Second identical call hits cache — no new sql activity
    const second = await hybridSearch("cache-me", DUMMY_EMBEDDING);
    expect(second).toEqual(first);
    expect(mockSql.transaction).toHaveBeenCalledTimes(2);
  });

  it("cache key distinguishes different questions", async () => {
    mockHybridCalls(
      [makeVectorRow({ id: "v1", distance: "0.1000" })],
      [makeFtsRow({ id: "f1", rank: "0.9" })],
    );
    await hybridSearch("question one", DUMMY_EMBEDDING);
    expect(mockSql.transaction).toHaveBeenCalledTimes(2);

    mockHybridCalls(
      [makeVectorRow({ id: "v2", distance: "0.2000" })],
      [makeFtsRow({ id: "f2", rank: "0.8" })],
    );
    await hybridSearch("question two", DUMMY_EMBEDDING);
    // Different question — cache miss → second SQL round trip
    expect(mockSql.transaction).toHaveBeenCalledTimes(4);
  });

  it("cache key distinguishes different filters for the same question", async () => {
    mockHybridCalls(
      [makeVectorRow({ id: "v1", distance: "0.1000" })],
      [makeFtsRow({ id: "f1", rank: "0.9" })],
    );
    await hybridSearch("same-q", DUMMY_EMBEDDING, { category: "News" });
    expect(mockSql.transaction).toHaveBeenCalledTimes(2);

    mockHybridCalls(
      [makeVectorRow({ id: "v2", distance: "0.2000" })],
      [makeFtsRow({ id: "f2", rank: "0.8" })],
    );
    await hybridSearch("same-q", DUMMY_EMBEDDING, { category: "Sports" });
    // Different filter → cache miss → new SQL round trip
    expect(mockSql.transaction).toHaveBeenCalledTimes(4);
  });

  it("cache is cleared by _clearHybridSearchCacheForTests", async () => {
    mockHybridCalls(
      [makeVectorRow({ id: "v1", distance: "0.1000" })],
      [makeFtsRow({ id: "f1", rank: "0.9" })],
    );
    await hybridSearch("clear-me", DUMMY_EMBEDDING);
    expect(mockSql.transaction).toHaveBeenCalledTimes(2);

    _clearHybridSearchCacheForTests();

    mockHybridCalls(
      [makeVectorRow({ id: "v1", distance: "0.1000" })],
      [makeFtsRow({ id: "f1", rank: "0.9" })],
    );
    await hybridSearch("clear-me", DUMMY_EMBEDDING);
    // Cache cleared → another SQL round trip
    expect(mockSql.transaction).toHaveBeenCalledTimes(4);
  });
});
