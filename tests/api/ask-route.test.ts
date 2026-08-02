import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Re-declare QuotaExhaustedError shape inside the mock so tests can throw
// it without dragging in the real module. vi.hoisted ensures the class is
// defined when the hoisted vi.mock factory runs.
const { MockQuotaExhaustedError, MockDbTimeoutError } = vi.hoisted(() => {
  class MockQuotaExhaustedError extends Error {
    readonly op: string;
    readonly cause?: unknown;
    constructor(op: string, cause?: unknown) {
      super(`Gemini API quota exhausted (${op})`);
      this.name = "QuotaExhaustedError";
      this.op = op;
      this.cause = cause;
    }
  }
  class MockDbTimeoutError extends Error {
    readonly op: string;
    readonly timeoutMs: number;
    constructor(op: string, timeoutMs: number) {
      super(`Database operation timed out: ${op} after ${timeoutMs}ms`);
      this.name = "DbTimeoutError";
      this.op = op;
      this.timeoutMs = timeoutMs;
    }
  }
  return { MockQuotaExhaustedError, MockDbTimeoutError };
});

vi.mock("@/src/lib/embeddings", () => ({
  embedQuery: vi.fn(),
  QuotaExhaustedError: MockQuotaExhaustedError,
}));

vi.mock("@/src/lib/db", () => ({
  DbTimeoutError: MockDbTimeoutError,
  hybridSearch: vi.fn(),
  queryArticlesByEmbedding: vi.fn(),
  searchArticlesForRag: vi.fn(),
  queryArchiveCoverage: vi.fn(),
  fuseArticleResults: vi.fn(
    (
      vectorResults: Array<Record<string, unknown>>,
      ftsResults: Array<Record<string, unknown>>,
      options: { limit: number },
    ) => {
      const merged = new Map<string, Record<string, unknown>>();
      for (const article of vectorResults) {
        merged.set(String(article.id), article);
      }
      for (const article of ftsResults) {
        const id = String(article.id);
        const previous = merged.get(id);
        merged.set(
          id,
          previous ? { ...previous, source: "both" } : article,
        );
      }
      return [...merged.values()].slice(0, options.limit);
    },
  ),
}));

vi.mock("@/src/lib/answer-generator", () => ({
  generateAnswer: vi.fn(),
  generateAnswerStream: vi.fn(),
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

vi.mock("@/src/lib/agent-loop", () => ({
  runAgentLoop: vi.fn(),
}));

vi.mock("@/src/lib/conversation-store", () => ({
  getConversationHistory: vi.fn(() => []),
  addConversationTurn: vi.fn(),
  newSessionId: vi.fn(() => "test-session-id"),
  formatHistoryForPrompt: vi.fn(() => ""),
}));

import {
  POST,
  _setGlobalDeadlineForTests,
  _setRetrievalTimeoutForTests,
  _clearAskDedupForTests,
  _askDedupInternalsForTests,
} from "@/src/app/api/ask/route";
import type { NextResponse } from "next/server";
import { embedQuery } from "@/src/lib/embeddings";
import {
  hybridSearch,
  queryArticlesByEmbedding,
  searchArticlesForRag,
  queryArchiveCoverage,
} from "@/src/lib/db";
import { generateAnswer, generateAnswerStream } from "@/src/lib/answer-generator";
import { reformulateQuery } from "@/src/lib/query-reformulator";
import { rerankArticles } from "@/src/lib/reranker";
import { runAgentLoop } from "@/src/lib/agent-loop";
import {
  addConversationTurn,
  getConversationHistory,
  formatHistoryForPrompt,
} from "@/src/lib/conversation-store";
import { clearAnswerCache } from "@/src/lib/answer-cache";

function makeRequest(
  body: Record<string, unknown>,
  opts: { stream?: boolean } = {},
): NextRequest {
  const url = opts.stream
    ? "http://localhost:3000/api/ask?stream=1"
    : "http://localhost:3000/api/ask";
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Helper: consume an SSE ReadableStream and return the parsed events in order.
// Each SSE frame is `data: {json}\n\n`; split on `\n\n` and JSON.parse each.
async function readSseEvents(
  response: Response | NextResponse,
): Promise<Array<Record<string, unknown>>> {
  const body = response.body;
  if (!body) throw new Error("Response has no body");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events: Array<Record<string, unknown>> = [];
  while (true) {
    const { done, value } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: true });
    if (done) break;
  }
  buf += decoder.decode();
  for (const frame of buf.split("\n\n")) {
    const trimmed = frame.trim();
    if (!trimmed) continue;
    const dataMatch = trimmed.match(/^data:\s*(.*)$/s);
    if (!dataMatch) continue;
    try {
      events.push(JSON.parse(dataMatch[1]) as Record<string, unknown>);
    } catch {
      // skip malformed
    }
  }
  return events;
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
  imageCaptions: [],
};

// Every describe block inherits a clean, healthy retrieval baseline. Vitest's
// clearAllMocks intentionally preserves implementations, which previously let
// an FTS rejection from one block leak into unrelated route tests.
beforeEach(() => {
  (embedQuery as ReturnType<typeof vi.fn>)
    .mockReset()
    .mockResolvedValue(new Array(768).fill(0));
  (hybridSearch as ReturnType<typeof vi.fn>)
    .mockReset()
    .mockResolvedValue([mockArticle]);
  (queryArticlesByEmbedding as ReturnType<typeof vi.fn>)
    .mockReset()
    .mockResolvedValue([mockArticle]);
  (searchArticlesForRag as ReturnType<typeof vi.fn>)
    .mockReset()
    .mockResolvedValue([{ ...mockArticle, source: "fts" as const }]);
  (queryArchiveCoverage as ReturnType<typeof vi.fn>)
    .mockReset()
    .mockResolvedValue({
      editionCount: 351,
      articleCount: 11_705,
      earliestEditionDate: "1950-01-01",
      latestEditionDate: "2006-12-31",
      retrievalTarget: "legacy",
    });
  (reformulateQuery as ReturnType<typeof vi.fn>)
    .mockReset()
    .mockResolvedValue({
      embeddingQuery: "What happened at OWU?",
      ftsQuery: "What happened at OWU?",
      mode: "text",
      complexity: "simple",
      coverageIntent: "none",
    });
  (rerankArticles as ReturnType<typeof vi.fn>)
    .mockReset()
    .mockResolvedValue([{ ...mockArticle, relevanceScore: 8 }]);
  (generateAnswer as ReturnType<typeof vi.fn>)
    .mockReset()
    .mockResolvedValue({
      answer: "Test answer [Source 1]",
      citations: [
        {
          articleId: mockArticle.id,
          headline: mockArticle.headline,
          editionDate: mockArticle.editionDate,
        },
      ],
      confidence: "high",
      followUps: [],
    });
  (generateAnswerStream as ReturnType<typeof vi.fn>)
    .mockReset()
    .mockImplementation(() =>
      (async function* () {
        yield { type: "delta", text: "Stream answer." };
        yield {
          type: "done",
          answer: "Stream answer.",
          citations: [],
          confidence: "medium",
          followUps: [],
        };
      })(),
    );
  (runAgentLoop as ReturnType<typeof vi.fn>).mockReset();
  (getConversationHistory as ReturnType<typeof vi.fn>)
    .mockReset()
    .mockResolvedValue([]);
  (addConversationTurn as ReturnType<typeof vi.fn>)
    .mockReset()
    .mockResolvedValue(undefined);
  (formatHistoryForPrompt as ReturnType<typeof vi.fn>)
    .mockReset()
    .mockReturnValue("");
});

describe("POST /api/ask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _clearAskDedupForTests();
    clearAnswerCache();
    (reformulateQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      embeddingQuery: "What happened at OWU?",
      ftsQuery: "What happened at OWU?",
      mode: "text",
      complexity: "simple",
      coverageIntent: "none",
    });
    (queryArchiveCoverage as ReturnType<typeof vi.fn>).mockResolvedValue({
      editionCount: 351,
      articleCount: 11_705,
      earliestEditionDate: "1950-01-01",
      latestEditionDate: "2006-12-31",
      retrievalTarget: "legacy",
    });
    (embedQuery as ReturnType<typeof vi.fn>).mockResolvedValue(new Array(768).fill(0));
    (hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValue([mockArticle]);
    (queryArticlesByEmbedding as ReturnType<typeof vi.fn>).mockResolvedValue([
      mockArticle,
    ]);
    (searchArticlesForRag as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...mockArticle, source: "fts" as const },
    ]);
    (rerankArticles as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...mockArticle, relevanceScore: 8 },
    ]);
    (generateAnswer as ReturnType<typeof vi.fn>).mockResolvedValue({
      answer: "Test answer [Source 1]",
      citations: [
        { articleId: "1960-01-07-0", headline: "Test Headline", editionDate: "1960-01-07" },
      ],
      confidence: "high",
      followUps: [],
    });
    // Default streaming mock: yields 2 deltas then a done event
    (generateAnswerStream as ReturnType<typeof vi.fn>).mockImplementation(() =>
      (async function* () {
        yield { type: "delta", text: "Stream " };
        yield { type: "delta", text: "answer." };
        yield {
          type: "done",
          answer: "Stream answer.",
          citations: [
            {
              articleId: "1960-01-07-0",
              headline: "Test Headline",
              editionDate: "1960-01-07",
            },
          ],
          confidence: "high",
          followUps: [],
        };
      })(),
    );
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

  it("continues with full-text retrieval when embedding fails", async () => {
    (embedQuery as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("API key missing"));

    const response = await POST(makeRequest({ question: "What happened?" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.meta.method).toBe("fts");
    expect(searchArticlesForRag).toHaveBeenCalledTimes(1);
    expect(queryArticlesByEmbedding).not.toHaveBeenCalled();
  });

  it("continues with full-text retrieval when vector quota is exhausted", async () => {
    (embedQuery as ReturnType<typeof vi.fn>).mockRejectedValue(
      new MockQuotaExhaustedError("embedQuery", { code: 429 }),
    );

    const response = await POST(makeRequest({ question: "What happened?" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.meta.method).toBe("fts");
    expect(response.headers.get("Retry-After")).toBeNull();
  });

  it("tags reformulator errors with stage='reformulate'", async () => {
    (reformulateQuery as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("reformulator unexpected crash"),
    );

    const response = await POST(makeRequest({ question: "What happened?" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.stage).toBe("reformulate");
    expect(body.requestId).toMatch(/^[a-z0-9]+$/);
  });

  it("tags reranker errors with stage='rerank'", async () => {
    (rerankArticles as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("reranker crashed"),
    );

    const response = await POST(makeRequest({ question: "What happened?" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.stage).toBe("rerank");
    expect(body.requestId).toBeDefined();
  });

  it("tags answer-gen errors with stage='generate'", async () => {
    (generateAnswer as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("generation crashed"),
    );

    const response = await POST(makeRequest({ question: "What happened?" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.stage).toBe("generate");
    expect(body.requestId).toBeDefined();
  });

  it("returns a typed retrieval error when both retrieval signals fail", async () => {
    (embedQuery as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network error"),
    );
    (searchArticlesForRag as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("database unavailable"),
    );

    const response = await POST(makeRequest({ question: "What happened?" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.stage).toBe("retrieve");
    expect(body.requestId).toBeDefined();
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

  it("persists a revision-pinned citation snapshot with the conversation turn", async () => {
    await POST(makeRequest({ question: "What happened?" }));

    const call = (addConversationTurn as ReturnType<typeof vi.fn>).mock.calls[0];
    const snapshots = call[4] as Array<Record<string, unknown>>;
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      articleId: mockArticle.id,
      headline: mockArticle.headline,
      editionDate: mockArticle.editionDate,
      evidenceSnippet: mockArticle.bodyPlain,
    });
    expect(snapshots[0].contentRevisionId).toMatch(
      /^legacy-sha256:[a-f0-9]{64}$/,
    );
  });

  it("falls back to vector-only search when full-text retrieval fails", async () => {
    (searchArticlesForRag as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("FTS index unavailable"),
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

    // Short body should not have ellipsis — clear cache so second POST
    // re-runs the pipeline (answer cache would otherwise replay first hit).
    clearAnswerCache();

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

    // Step 3 added an optional { signal } second param to propagate the
    // global deadline. Existing assertions must tolerate the extra arg.
    expect(reformulateQuery).toHaveBeenCalledWith(
      "What happened at OWU?",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(embedQuery).toHaveBeenCalledWith(
      "expanded OWU query",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(searchArticlesForRag).toHaveBeenCalledWith(
      "OWU OR Ohio Wesleyan",
      expect.objectContaining({ limit: 20, signal: expect.any(AbortSignal) }),
    );
    expect(queryArticlesByEmbedding).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ limit: 20, signal: expect.any(AbortSignal) }),
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
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("calls rerankArticles between retrieval and generation", async () => {
    const retrieved = [mockArticle, { ...mockArticle, id: "1960-01-07-1" }];
    const reranked = [{ ...mockArticle, relevanceScore: 9 }];
    (queryArticlesByEmbedding as ReturnType<typeof vi.fn>).mockResolvedValue(retrieved);
    (searchArticlesForRag as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (rerankArticles as ReturnType<typeof vi.fn>).mockResolvedValue(reranked);

    await POST(makeRequest({ question: "Test?" }));

    expect(rerankArticles).toHaveBeenCalledWith(
      "Test?",
      retrieved,
      expect.objectContaining({
        maxArticles: 10,
        minScore: 4,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(generateAnswer).toHaveBeenCalledWith(
      "Test?",
      reranked,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
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

  it("returns 504 when the global deadline fires", async () => {
    // Shrink the deadline so we can exercise the hang-forever path in
    // real wall time (~150ms instead of 30s). Vitest mocks ignore the
    // AbortSignal so the outer Promise.race is what actually cuts off.
    _setGlobalDeadlineForTests(150);
    try {
      (reformulateQuery as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise(() => {}),
      );

      const start = Date.now();
      const response = await POST(makeRequest({ question: "Hangs forever" }));
      const elapsed = Date.now() - start;
      const body = await response.json();

      expect(response.status).toBe(504);
      expect(body.error).toMatch(/took too long/i);
      expect(body.stage).toBe("deadline");
      expect(body.requestId).toBeDefined();
      // Must return within roughly the deadline budget, not hang
      expect(elapsed).toBeLessThan(600);
      expect(elapsed).toBeGreaterThanOrEqual(140);
    } finally {
      _setGlobalDeadlineForTests(null);
    }
  });

  it("global deadline does not fire for normal fast requests", async () => {
    _setGlobalDeadlineForTests(5000);
    try {
      const response = await POST(makeRequest({ question: "Fast happy path?" }));
      expect(response.status).toBe(200);
    } finally {
      _setGlobalDeadlineForTests(null);
    }
  });

  // Retrieval timeout should fire BEFORE the global deadline when both
  // independent retrieval signals time out — the inner budget must win over the outer
  // 30s budget. Uses short deadlines so the test runs in real wall time.
  it("retrieval timeout fires before the global deadline (stage=retrieve, not deadline)", async () => {
    _setGlobalDeadlineForTests(2000);
    _setRetrievalTimeoutForTests(150);
    try {
      // The mocked DB layer surfaces the same typed timeout that the real
      // AbortSignal-aware Neon wrapper emits at its local budget.
      const rejectAtRetrievalBudget = () =>
        new Promise((_, reject) => {
          setTimeout(
            () => reject(new MockDbTimeoutError("retrieval", 150)),
            150,
          );
        });
      (searchArticlesForRag as ReturnType<typeof vi.fn>).mockImplementation(
        rejectAtRetrievalBudget,
      );
      (queryArticlesByEmbedding as ReturnType<typeof vi.fn>).mockImplementation(
        () =>
          rejectAtRetrievalBudget(),
      );

      const start = Date.now();
      const response = await POST(makeRequest({ question: "Retrieval hang test" }));
      const elapsed = Date.now() - start;
      const body = await response.json();

      expect(response.status).toBe(504);
      // Critical: stage must be "retrieve", NOT "deadline"
      expect(body.stage).toBe("retrieve");
      expect(body.error).toMatch(/retrieval took too long/i);
      expect(body.requestId).toBeDefined();
      // Must fire near the 150ms retrieval budget, well before the 2s deadline
      expect(elapsed).toBeLessThan(600);
      expect(elapsed).toBeGreaterThanOrEqual(140);
    } finally {
      _setGlobalDeadlineForTests(null);
      _setRetrievalTimeoutForTests(null);
    }
  });

  // Concurrent request dedup (Step 10)
  // Two identical concurrent POSTs should coalesce so the pipeline only
  // calls reformulator/embed/rerank/answer-gen once total. This saves
  // the expensive Gemini calls on rapid duplicate clicks.

  it("dedups two concurrent identical requests — pipeline runs once", async () => {
    const responses = await Promise.all([
      POST(makeRequest({ question: "Same question?" })),
      POST(makeRequest({ question: "Same question?" })),
    ]);

    expect(responses[0].status).toBe(200);
    expect(responses[1].status).toBe(200);

    const bodies = await Promise.all(responses.map((r) => r.json()));
    // Both responses should have the same answer (came from same pipeline run)
    expect(bodies[0].answer).toBe(bodies[1].answer);

    // Critical: each pipeline stage was called exactly ONCE total
    expect(reformulateQuery).toHaveBeenCalledTimes(1);
    expect(embedQuery).toHaveBeenCalledTimes(1);
    expect(searchArticlesForRag).toHaveBeenCalledTimes(1);
    expect(queryArticlesByEmbedding).toHaveBeenCalledTimes(1);
    expect(rerankArticles).toHaveBeenCalledTimes(1);
    expect(generateAnswer).toHaveBeenCalledTimes(1);
  });

  it("dedups three concurrent identical requests — pipeline runs once", async () => {
    const [a, b, c] = await Promise.all([
      POST(makeRequest({ question: "Triple-fire" })),
      POST(makeRequest({ question: "Triple-fire" })),
      POST(makeRequest({ question: "Triple-fire" })),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(c.status).toBe(200);
    expect(reformulateQuery).toHaveBeenCalledTimes(1);
    expect(generateAnswer).toHaveBeenCalledTimes(1);
  });

  it("does NOT dedup distinct questions from the same IP", async () => {
    await Promise.all([
      POST(makeRequest({ question: "Question one" })),
      POST(makeRequest({ question: "Question two" })),
    ]);

    expect(reformulateQuery).toHaveBeenCalledTimes(2);
    expect(generateAnswer).toHaveBeenCalledTimes(2);
  });

  it("does NOT dedup same question with different filters", async () => {
    await Promise.all([
      POST(
        makeRequest({
          question: "Same question",
          filters: { category: "News" },
        }),
      ),
      POST(
        makeRequest({
          question: "Same question",
          filters: { category: "Sports" },
        }),
      ),
    ]);

    expect(reformulateQuery).toHaveBeenCalledTimes(2);
  });

  it("applies dates inferred from an explicit decade to retrieval", async () => {
    (reformulateQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      embeddingQuery: "football season",
      ftsQuery: "football season",
      mode: "text",
      complexity: "simple",
      startDate: "1970-01-01",
      endDate: "1979-12-31",
    });
    await POST(makeRequest({ question: "football in the 1970s" }));
    expect(searchArticlesForRag).toHaveBeenCalledWith(
      "football season",
      expect.objectContaining({
        startDate: "1970-01-01",
        endDate: "1979-12-31",
      }),
    );
    expect(queryArticlesByEmbedding).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        startDate: "1970-01-01",
        endDate: "1979-12-31",
      }),
    );
  });

  it("keeps explicit API dates authoritative over inferred dates", async () => {
    (reformulateQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      embeddingQuery: "football",
      ftsQuery: "football",
      mode: "text",
      complexity: "simple",
      startDate: "1970-01-01",
      endDate: "1979-12-31",
    });
    await POST(makeRequest({
      question: "football",
      filters: { startDate: "1980-01-01", endDate: "1980-12-31" },
    }));
    expect(searchArticlesForRag).toHaveBeenCalledWith(
      "football",
      expect.objectContaining({
        startDate: "1980-01-01",
        endDate: "1980-12-31",
      }),
    );
    expect(queryArticlesByEmbedding).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        startDate: "1980-01-01",
        endDate: "1980-12-31",
      }),
    );
  });

  it("loads deterministic coverage only for absence/count/exhaustive intent", async () => {
    (reformulateQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      embeddingQuery: "computer science department",
      ftsQuery: "computer science",
      mode: "text",
      complexity: "simple",
      coverageIntent: "absence",
      startDate: "1960-01-01",
      endDate: "1969-12-31",
    });

    const response = await POST(
      makeRequest({ question: "Did OWU ever mention computer science in the 1960s?" }),
    );
    const body = await response.json();

    expect(queryArchiveCoverage).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: "1960-01-01",
        endDate: "1969-12-31",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(generateAnswer).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        coverage: expect.objectContaining({
          intent: "absence",
          editionCount: 351,
          articleCount: 11_705,
        }),
      }),
    );
    expect(body.meta.coverage).toMatchObject({
      intent: "absence",
      editionCount: 351,
      articleCount: 11_705,
      requestedStartDate: "1960-01-01",
      requestedEndDate: "1969-12-31",
    });
  });

  it("does NOT dedup same question with different sessionIds (bug_018)", async () => {
    // Two different users on the same NAT'd IP asking the same question:
    // if dedup ignored sessionId, the piggybacker's addConversationTurn
    // would never fire and their follow-up history would be lost.
    await Promise.all([
      POST(makeRequest({ question: "Shared question", sessionId: "sess-A" })),
      POST(makeRequest({ question: "Shared question", sessionId: "sess-B" })),
    ]);

    // Both requests ran the pipeline — no dedup across sessions.
    expect(reformulateQuery).toHaveBeenCalledTimes(2);
    expect(generateAnswer).toHaveBeenCalledTimes(2);

    // Each session got its own conversation-store write.
    const addTurnCalls = (addConversationTurn as ReturnType<typeof vi.fn>).mock.calls;
    const sessionsWritten = new Set(addTurnCalls.map((c) => c[0]));
    expect(sessionsWritten.has("sess-A")).toBe(true);
    expect(sessionsWritten.has("sess-B")).toBe(true);
  });

  it("falls through if the in-flight pipeline rejects", async () => {
    // First call rejects, second call should run its own pipeline successfully
    let callCount = 0;
    (reformulateQuery as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error("first call boom");
      return {
        embeddingQuery: "x",
        ftsQuery: "x",
        mode: "text",
      };
    });

    // Fire serially so the second call sees the first as already-rejected
    const r1 = await POST(makeRequest({ question: "Recover?" }));
    const r2 = await POST(makeRequest({ question: "Recover?" }));

    expect(r1.status).toBe(500);
    // Second one falls through and runs its own pipeline
    expect(r2.status).toBe(200);
    expect(reformulateQuery).toHaveBeenCalledTimes(2);
  });

  // Direct-unit test for the dedup body re-consumption race fix.
  // The old impl cached only the settled value, so concurrent waiters past
  // the second check could both call response.clone().json() in parallel.
  // The new impl caches the extraction promise itself, guaranteeing one
  // response.clone() call regardless of concurrency.
  it("getOrExtract shares extraction across concurrent waiters — response.clone called exactly once", async () => {
    const jsonSpy = vi.fn().mockResolvedValue({ answer: "shared", confidence: "high" });
    const cloneSpy = vi.fn(() => ({ json: jsonSpy }));
    const mockResponse = {
      clone: cloneSpy,
      status: 200,
      headers: {
        forEach: (cb: (v: string, k: string) => void) => {
          cb("application/json", "content-type");
        },
      },
    } as unknown as NextResponse;

    const entry = _askDedupInternalsForTests.makeEntry(mockResponse);

    const [a, b, c] = await Promise.all([
      _askDedupInternalsForTests.getOrExtract(entry),
      _askDedupInternalsForTests.getOrExtract(entry),
      _askDedupInternalsForTests.getOrExtract(entry),
    ]);

    // Critical: clone and json were each called exactly ONCE total
    expect(cloneSpy).toHaveBeenCalledTimes(1);
    expect(jsonSpy).toHaveBeenCalledTimes(1);

    // All three waiters received the same extracted shape
    expect(a.body).toEqual({ answer: "shared", confidence: "high" });
    expect(a.status).toBe(200);
    expect(a.headers).toEqual({ "content-type": "application/json" });
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  // ── Streaming (SSE) path ─────────────────────────────────
  // ?stream=1 returns a text/event-stream response with typed events:
  // stage → stage → stage → metadata → delta(s) → done
  //
  // Errors mid-stream become `error` events (status 200 already sent).

  it("streaming: returns text/event-stream content type for ?stream=1", async () => {
    const response = await POST(makeRequest({ question: "stream ct" }, { stream: true }));
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-cache");
    // Drain the body so the test doesn't leak resources
    await readSseEvents(response);
  });

  it("streaming: happy path emits stage*3 → metadata → delta*2 → done", async () => {
    const response = await POST(
      makeRequest({ question: "streaming happy path" }, { stream: true }),
    );
    const events = await readSseEvents(response);

    const types = events.map((e) => e.type);
    // Order matters: reformulate → retrieve → rerank stages,
    // then metadata (needs reranked source articles), then deltas from
    // generateAnswerStream, then the final done event.
    expect(types).toEqual([
      "stage",
      "stage",
      "stage",
      "metadata",
      "delta",
      "delta",
      "done",
    ]);

    const stageEvents = events.filter((e) => e.type === "stage");
    expect(stageEvents.map((e) => e.name)).toEqual([
      "reformulate",
      "retrieve",
      "rerank",
    ]);
    for (const stage of stageEvents) {
      expect(typeof stage.elapsedMs).toBe("number");
    }

    const metadata = events.find((e) => e.type === "metadata");
    expect(metadata).toBeDefined();
    expect(Array.isArray(metadata!.sourceArticles)).toBe(true);
    expect((metadata!.sourceArticles as unknown[]).length).toBe(1);
    expect(metadata!.mode).toBe("text");
    expect(metadata!.question).toBe("streaming happy path");

    const deltas = events.filter((e) => e.type === "delta");
    expect(deltas.map((e) => e.text)).toEqual(["Stream ", "answer."]);

    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    expect(done!.answer).toBe("Stream answer.");
    expect(done!.confidence).toBe("high");
    expect(Array.isArray(done!.citations)).toBe(true);
    expect((done!.citations as unknown[]).length).toBe(1);
    const doneMeta = done!.meta as Record<string, unknown>;
    expect(typeof doneMeta.retrievalTimeMs).toBe("number");
    expect(typeof doneMeta.generationTimeMs).toBe("number");
    expect(typeof doneMeta.totalTimeMs).toBe("number");
    expect(doneMeta.method).toBe("hybrid");
    expect(doneMeta.articlesSearched).toBe(1);
  });

  it("streaming: metadata event appears BEFORE any delta event (sidebar renders first)", async () => {
    const response = await POST(
      makeRequest({ question: "metadata ordering" }, { stream: true }),
    );
    const events = await readSseEvents(response);
    const metadataIdx = events.findIndex((e) => e.type === "metadata");
    const firstDeltaIdx = events.findIndex((e) => e.type === "delta");
    expect(metadataIdx).toBeGreaterThanOrEqual(0);
    expect(firstDeltaIdx).toBeGreaterThan(metadataIdx);
  });

  it("streaming: reformulate error → error event with stage=reformulate", async () => {
    (reformulateQuery as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("reformulator boom"),
    );

    const response = await POST(
      makeRequest({ question: "err reformulate" }, { stream: true }),
    );
    const events = await readSseEvents(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.stage).toBe("reformulate");
    expect(typeof errorEvent!.requestId).toBe("string");
    expect(events.find((e) => e.type === "done")).toBeUndefined();
  });

  it("streaming: both signals unavailable surfaces vector quota at retrieve", async () => {
    (embedQuery as ReturnType<typeof vi.fn>).mockRejectedValue(
      new MockQuotaExhaustedError("embedQuery", { code: 429 }),
    );
    (searchArticlesForRag as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("database unavailable"),
    );

    const response = await POST(
      makeRequest({ question: "err embed quota" }, { stream: true }),
    );
    const events = await readSseEvents(response);

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.stage).toBe("retrieve");
    expect(errorEvent!.cause).toBe("quota_exhausted");
    expect(errorEvent!.message).toMatch(/quota/i);
  });

  it("streaming: both generic signal failures report stage=retrieve", async () => {
    (embedQuery as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network failed"),
    );
    (searchArticlesForRag as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("database unavailable"),
    );

    const response = await POST(
      makeRequest({ question: "err embed generic" }, { stream: true }),
    );
    const events = await readSseEvents(response);

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.stage).toBe("retrieve");
    expect(errorEvent!.cause).toBeUndefined();
  });

  it("streaming: rerank error → error with stage=rerank", async () => {
    (rerankArticles as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("reranker boom"),
    );

    const response = await POST(
      makeRequest({ question: "err rerank" }, { stream: true }),
    );
    const events = await readSseEvents(response);

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.stage).toBe("rerank");
  });

  it("streaming: deltas received as emitted (preserves order + text)", async () => {
    (generateAnswerStream as ReturnType<typeof vi.fn>).mockImplementation(() =>
      (async function* () {
        yield { type: "delta", text: "First " };
        yield { type: "delta", text: "second " };
        yield { type: "delta", text: "third." };
        yield {
          type: "done",
          answer: "First second third.",
          citations: [],
          confidence: "medium",
          followUps: [],
        };
      })(),
    );

    const response = await POST(
      makeRequest({ question: "delta order" }, { stream: true }),
    );
    const events = await readSseEvents(response);

    const deltas = events.filter((e) => e.type === "delta");
    expect(deltas.map((e) => e.text)).toEqual(["First ", "second ", "third."]);
  });

  it("streaming: does NOT invoke dedup (concurrent streams both run the pipeline)", async () => {
    const [r1, r2] = await Promise.all([
      POST(makeRequest({ question: "no dedup streaming" }, { stream: true })),
      POST(makeRequest({ question: "no dedup streaming" }, { stream: true })),
    ]);

    await readSseEvents(r1);
    await readSseEvents(r2);

    // Pipeline ran TWICE (dedup is bypassed for streaming)
    expect(reformulateQuery).toHaveBeenCalledTimes(2);
    expect(embedQuery).toHaveBeenCalledTimes(2);
  });

  it("getOrExtract returns cached extraction for sequential waiters too", async () => {
    const jsonSpy = vi.fn().mockResolvedValue({ answer: "cached" });
    const cloneSpy = vi.fn(() => ({ json: jsonSpy }));
    const mockResponse = {
      clone: cloneSpy,
      status: 200,
      headers: { forEach: (cb: (v: string, k: string) => void) => cb("application/json", "content-type") },
    } as unknown as NextResponse;

    const entry = _askDedupInternalsForTests.makeEntry(mockResponse);

    const first = await _askDedupInternalsForTests.getOrExtract(entry);
    const second = await _askDedupInternalsForTests.getOrExtract(entry);
    const third = await _askDedupInternalsForTests.getOrExtract(entry);

    expect(cloneSpy).toHaveBeenCalledTimes(1);
    expect(jsonSpy).toHaveBeenCalledTimes(1);
    expect(first.body).toEqual({ answer: "cached" });
    expect(second).toBe(first); // same cached object reference
    expect(third).toBe(first);
  });

  // ── Coverage gaps identified during the RAG health review ─────────────
  // The three tests below cover failure modes that were previously
  // uncovered: reranker filtering everything below minScore, Gemini
  // 503-class errors during embed, and a streaming generator that throws
  // mid-delta. See the master plan in warm-soaring-willow.md.

  it("returns low-confidence 'not enough info' when reranker filters all articles", async () => {
    // Retrieval succeeds with 2 articles, but reranker drops them all
    // (everything scored below minScore=5). route.ts passes the empty
    // array to generateAnswer, which returns the canned insufficient-info
    // response with confidence=low. Previously this path had no explicit
    // test — coverage reached via golden suite only.
    (hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValue([
      mockArticle,
      { ...mockArticle, id: "1960-01-07-1" },
    ]);
    (rerankArticles as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (generateAnswer as ReturnType<typeof vi.fn>).mockResolvedValue({
      answer:
        "I don't have enough information in the archive to answer this question.",
      citations: [],
      confidence: "low",
      followUps: [],
    });

    const response = await POST(
      makeRequest({ question: "something totally off-topic" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.confidence).toBe("low");
    expect(body.citations).toEqual([]);
    expect(body.answer).toMatch(/don.?t have enough information/i);
    // sourceArticles should be empty because nothing survived reranking
    expect(body.sourceArticles).toEqual([]);
    // generateAnswer must still be called with the empty array so the
    // canned low-confidence response path is reachable from the route
    expect(generateAnswer).toHaveBeenCalledWith(
      "something totally off-topic",
      [],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("uses full-text retrieval when embedding has a transient 503", async () => {
    const serviceUnavailable = Object.assign(
      new Error("Gemini API error: 503 SERVICE_UNAVAILABLE upstream connect error"),
      { status: "UNAVAILABLE", code: 503 },
    );
    (embedQuery as ReturnType<typeof vi.fn>).mockRejectedValue(serviceUnavailable);

    const response = await POST(
      makeRequest({ question: "Kennedy visit to Ohio" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.meta.method).toBe("fts");
    expect(response.headers.get("Retry-After")).toBeNull();
  });

  it("emits delta events then an error event when generateAnswerStream throws mid-stream", async () => {
    // The streaming path yields deltas as they arrive from Gemini, then
    // yields a final 'done' event. If the underlying model call fails
    // after producing some output, the client should still receive the
    // partial deltas AND a subsequent error event so the UI can clean up
    // gracefully instead of hanging.
    //
    // Both the streaming and non-streaming paths tag generation errors
    // with stage="generate" so operators can grep logs by a single stage
    // value. Streaming wraps the for-await loop in a dedicated try/catch
    // (route.ts) to achieve this.
    (generateAnswerStream as ReturnType<typeof vi.fn>).mockImplementation(() =>
      (async function* () {
        yield { type: "delta", text: "Partial " };
        yield { type: "delta", text: "answer before crash" };
        throw new Error("Gemini stream interrupted");
      })(),
    );

    const response = await POST(
      makeRequest({ question: "What happened?" }, { stream: true }),
    );
    const events = await readSseEvents(response);

    // Expect at least the two delta events we yielded before the throw,
    // then an error event carrying requestId. Ordering matters — deltas
    // must come first so the client can render them.
    const deltas = events.filter((e) => e.type === "delta");
    expect(deltas.length).toBeGreaterThanOrEqual(2);
    expect(deltas[0]).toMatchObject({ type: "delta", text: "Partial " });
    expect(deltas[1]).toMatchObject({
      type: "delta",
      text: "answer before crash",
    });

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    // Streaming generation errors tag stage="generate", matching the
    // non-streaming path's wrapStage("generate", ...) behavior.
    expect(errorEvent?.stage).toBe("generate");
    expect(errorEvent?.message).toMatch(/error occurred during answer generation/);
    expect(typeof errorEvent?.requestId).toBe("string");
    expect((errorEvent?.requestId as string).length).toBeGreaterThan(0);

    // No 'done' event should be emitted when the stream errors out — the
    // client differentiates by receiving 'error' instead.
    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeUndefined();
  });
});

describe("Complexity routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _clearAskDedupForTests();
    clearAnswerCache();
    (embedQuery as ReturnType<typeof vi.fn>).mockResolvedValue(new Array(768).fill(0));
    (hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValue([mockArticle]);
    (rerankArticles as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...mockArticle, relevanceScore: 8 },
    ]);
    (generateAnswer as ReturnType<typeof vi.fn>).mockResolvedValue({
      answer: "Pipeline answer",
      citations: [],
      confidence: "medium",
      followUps: [],
    });
  });

  it("routes to agent when complexity=complex (JSON path)", async () => {
    (reformulateQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      embeddingQuery: "evolution of Greek life",
      ftsQuery: "Greek life fraternity sorority",
      mode: "text",
      complexity: "complex",
    });
    (runAgentLoop as ReturnType<typeof vi.fn>).mockResolvedValue({
      answer: "Greek life changed significantly [1965-03-15-4].",
      citations: [
        { articleId: "1965-03-15-4", headline: "Greek Life Review", editionDate: "1965-03-15" },
      ],
      confidence: "high",
      toolCallCount: 3,
      rounds: 2,
      articleMeta: new Map([
        ["1965-03-15-4", {
          headline: "Greek Life Review",
          editionDate: "1965-03-15",
          category: "Campus News",
          summary: "A review of Greek life",
          byline: "Staff",
          bodySnippet: "Fraternities and sororities...",
          imageUrls: [],
          imageCaptions: [],
        }],
      ]),
    });

    const response = await POST(makeRequest({ question: "How did Greek life evolve from 1960 to 2000?" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(runAgentLoop).toHaveBeenCalledTimes(1);
    expect(embedQuery).not.toHaveBeenCalled();
    expect(body.answer).toContain("Greek life changed");
    expect(body.meta.complexity).toBe("complex");
    expect(body.meta.agentSteps).toBe(2);
    expect(body.meta.agentToolCalls).toBe(3);
  });

  it("passes deterministic count scope into the complex agent path", async () => {
    (reformulateQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      embeddingQuery: "homecoming parades",
      ftsQuery: "homecoming parade",
      mode: "text",
      complexity: "complex",
      coverageIntent: "count",
    });
    (queryArchiveCoverage as ReturnType<typeof vi.fn>).mockResolvedValue({
      editionCount: 351,
      articleCount: 11_705,
      earliestEditionDate: "1950-01-01",
      latestEditionDate: "2006-12-31",
      retrievalTarget: "legacy",
    });
    (runAgentLoop as ReturnType<typeof vi.fn>).mockResolvedValue({
      answer: "The cited evidence identified two parades [1965-03-15-4].",
      citations: [
        { articleId: "1965-03-15-4", headline: "Parades", editionDate: "1965-03-15" },
      ],
      confidence: "medium",
      toolCallCount: 1,
      rounds: 1,
      articleMeta: new Map(),
      retrievalTimeMs: 10,
      generationTimeMs: 20,
      retrievalMethod: "fts",
    });

    const response = await POST(makeRequest({ question: "How many homecoming parades were covered?" }));
    const body = await response.json();

    expect(runAgentLoop).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        coverage: expect.objectContaining({
          intent: "count",
          editionCount: 351,
        }),
      }),
    );
    expect(body.meta.coverage.intent).toBe("count");
    expect(body.meta.method).toBe("fts");
  });

  it("populates sourceArticles from agent metadata", async () => {
    (reformulateQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      embeddingQuery: "test",
      ftsQuery: "test",
      mode: "text",
      complexity: "complex",
    });
    (runAgentLoop as ReturnType<typeof vi.fn>).mockResolvedValue({
      answer: "Answer [1965-03-15-4].",
      citations: [
        { articleId: "1965-03-15-4", headline: "Test", editionDate: "1965-03-15" },
      ],
      confidence: "high",
      toolCallCount: 1,
      rounds: 1,
      articleMeta: new Map([
        ["1965-03-15-4", {
          headline: "Test",
          editionDate: "1965-03-15",
          category: "News",
          summary: "Summary",
          byline: "Author",
          bodySnippet: "Snippet",
          imageUrls: ["img.jpg"],
          imageCaptions: ["A photo caption"],
        }],
      ]),
    });

    const response = await POST(makeRequest({ question: "complex question" }));
    const body = await response.json();

    expect(body.sourceArticles).toHaveLength(1);
    expect(body.sourceArticles[0].id).toBe("1965-03-15-4");
    expect(body.sourceArticles[0].category).toBe("News");
    expect(body.sourceArticles[0].bodySnippet).toBe("Snippet");
    expect(body.sourceArticles[0].imageUrls).toEqual(["img.jpg"]);
  });

  it("uses pipeline when complexity=simple", async () => {
    (reformulateQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      embeddingQuery: "homecoming 1965",
      ftsQuery: "homecoming 1965",
      mode: "text",
      complexity: "simple",
    });

    const response = await POST(makeRequest({ question: "What was the 1965 homecoming like?" }));
    expect(response.status).toBe(200);
    expect(runAgentLoop).not.toHaveBeenCalled();
    expect(embedQuery).toHaveBeenCalled();
  });

  it("stores conversation turn for agent path", async () => {
    (reformulateQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      embeddingQuery: "test",
      ftsQuery: "test",
      mode: "text",
      complexity: "complex",
    });
    (runAgentLoop as ReturnType<typeof vi.fn>).mockResolvedValue({
      answer: "Agent answer.",
      citations: [{ articleId: "a1", headline: "H", editionDate: "1960-01-01" }],
      confidence: "high",
      toolCallCount: 1,
      rounds: 1,
      articleMeta: new Map(),
    });

    await POST(makeRequest({ question: "complex q" }));
    expect(addConversationTurn).toHaveBeenCalledWith(
      "test-session-id",
      "complex q",
      "Agent answer.",
      ["a1"],
      expect.any(Array),
    );
  });
});

describe("CRAG retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _clearAskDedupForTests();
    clearAnswerCache();
    (reformulateQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      embeddingQuery: "obscure topic",
      ftsQuery: "obscure topic",
      mode: "text",
      complexity: "simple",
    });
    (embedQuery as ReturnType<typeof vi.fn>).mockResolvedValue(new Array(768).fill(0));
    (hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValue([mockArticle]);
  });

  it("retries with broader query when reranker filters all articles", async () => {
    (rerankArticles as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...mockArticle, relevanceScore: 5 }]);
    (generateAnswer as ReturnType<typeof vi.fn>).mockResolvedValue({
      answer: "Found on retry.",
      citations: [],
      confidence: "medium",
      followUps: [],
    });

    const response = await POST(makeRequest({ question: "obscure topic" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(reformulateQuery).toHaveBeenCalledTimes(2);
    expect(rerankArticles).toHaveBeenCalledTimes(2);
    expect(body.answer).toBe("Found on retry.");
  });

  it("returns low confidence when retry also yields no articles", async () => {
    (rerankArticles as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    (generateAnswer as ReturnType<typeof vi.fn>).mockResolvedValue({
      answer: "Not enough information.",
      citations: [],
      confidence: "low",
      followUps: [],
    });

    const response = await POST(makeRequest({ question: "obscure topic" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.confidence).toBe("low");
  });
});

describe("CRAG retry (streaming)", () => {
  // Regression coverage for merged_bug_003: the retry previously existed
  // only in the non-streaming branch, so real users (who always stream)
  // saw "I don't have enough information" instead of the broadened retry.
  beforeEach(() => {
    vi.clearAllMocks();
    _clearAskDedupForTests();
    clearAnswerCache();
    (reformulateQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      embeddingQuery: "obscure topic",
      ftsQuery: "obscure topic",
      mode: "text",
      complexity: "simple",
    });
    (embedQuery as ReturnType<typeof vi.fn>).mockResolvedValue(new Array(768).fill(0));
    (hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValue([mockArticle]);
    (generateAnswerStream as ReturnType<typeof vi.fn>).mockImplementation(() =>
      (async function* () {
        yield { type: "delta", text: "Found via retry." };
        yield {
          type: "done",
          answer: "Found via retry.",
          citations: [],
          confidence: "medium",
          followUps: [],
        };
      })(),
    );
  });

  it("retries with broader query when streaming rerank filters all articles", async () => {
    (rerankArticles as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...mockArticle, relevanceScore: 5 }]);

    const response = await POST(
      makeRequest({ question: "obscure topic" }, { stream: true }),
    );
    const events = await readSseEvents(response);

    // Retry fires: both reformulate and rerank ran twice.
    expect(reformulateQuery).toHaveBeenCalledTimes(2);
    expect(rerankArticles).toHaveBeenCalledTimes(2);

    // Final done event carries the retry's answer (not an error).
    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    expect(done?.answer).toBe("Found via retry.");

    // No error event was emitted.
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeUndefined();
  });

  it("maps retry-stage quota exhaustion to SSE error with stage tag", async () => {
    (rerankArticles as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    // Primary embed succeeds; retry embed throws quota-exhausted. Order
    // matters: the pipeline calls embedQuery twice — once before retrieve,
    // once inside the retry. The first call must succeed so rerank runs
    // and filters to zero, triggering the retry that then fails.
    (embedQuery as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new Array(768).fill(0))
      .mockRejectedValueOnce(new MockQuotaExhaustedError("embedQuery"));
    (searchArticlesForRag as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ ...mockArticle, source: "fts" as const }])
      .mockRejectedValueOnce(new Error("database unavailable"));

    const response = await POST(
      makeRequest({ question: "obscure topic" }, { stream: true }),
    );
    const events = await readSseEvents(response);

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.message).toMatch(/quota/i);
    // Stage reflects the combined retry retrieval operation.
    expect(errorEvent?.stage).toBe("retrieve-retry");
  });
});

describe("Streaming + agent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _clearAskDedupForTests();
    clearAnswerCache();
    (embedQuery as ReturnType<typeof vi.fn>).mockResolvedValue(new Array(768).fill(0));
    (hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValue([mockArticle]);
    (rerankArticles as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...mockArticle, relevanceScore: 8 },
    ]);
    (generateAnswerStream as ReturnType<typeof vi.fn>).mockImplementation(() =>
      (async function* () {
        yield { type: "delta", text: "Answer." };
        yield { type: "done", answer: "Answer.", citations: [], confidence: "medium", followUps: [] };
      })(),
    );
  });

  it("routes streaming complex questions to agent with SSE events", async () => {
    (reformulateQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      embeddingQuery: "Greek life evolution",
      ftsQuery: "Greek life",
      mode: "text",
      complexity: "complex",
    });
    (runAgentLoop as ReturnType<typeof vi.fn>).mockResolvedValue({
      answer: "Agent streaming answer.",
      citations: [{ articleId: "1965-03-15-4", headline: "GL", editionDate: "1965-03-15" }],
      confidence: "high",
      toolCallCount: 2,
      rounds: 1,
      articleMeta: new Map(),
    });

    const response = await POST(makeRequest({ question: "How did Greek life evolve?" }, { stream: true }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");

    const events = await readSseEvents(response);
    const stageEvents = events.filter((e) => e.type === "stage");
    expect(stageEvents.some((e) => e.name === "agent")).toBe(true);

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    expect(doneEvent?.answer).toBe("Agent streaming answer.");
    expect((doneEvent?.meta as Record<string, unknown>)?.complexity).toBe("complex");
    expect((doneEvent?.meta as Record<string, unknown>)?.agentSteps).toBe(1);
  });

  it("stores conversation turn in streaming agent path", async () => {
    (reformulateQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      embeddingQuery: "test",
      ftsQuery: "test",
      mode: "text",
      complexity: "complex",
    });
    (runAgentLoop as ReturnType<typeof vi.fn>).mockResolvedValue({
      answer: "Streaming agent answer.",
      citations: [],
      confidence: "medium",
      toolCallCount: 1,
      rounds: 1,
      articleMeta: new Map(),
    });

    const response = await POST(makeRequest({ question: "streaming complex q" }, { stream: true }));
    await readSseEvents(response);

    expect(addConversationTurn).toHaveBeenCalledWith(
      "test-session-id",
      "streaming complex q",
      "Streaming agent answer.",
      [],
      expect.any(Array),
    );
  });

  it("includes complexity in streaming pipeline done event", async () => {
    (reformulateQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      embeddingQuery: "simple question",
      ftsQuery: "simple question",
      mode: "text",
      complexity: "simple",
    });

    const response = await POST(makeRequest({ question: "simple question" }, { stream: true }));
    const events = await readSseEvents(response);

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    expect((doneEvent?.meta as Record<string, unknown>)?.complexity).toBe("simple");
  });

  it("threads verified coverage through the streaming pipeline", async () => {
    (reformulateQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      embeddingQuery: "all housing examples",
      ftsQuery: "housing",
      mode: "text",
      complexity: "simple",
      coverageIntent: "exhaustive",
    });
    (queryArchiveCoverage as ReturnType<typeof vi.fn>).mockResolvedValue({
      editionCount: 50,
      articleCount: 1_500,
      earliestEditionDate: "1960-01-01",
      latestEditionDate: "1970-12-31",
      retrievalTarget: "legacy",
    });

    const response = await POST(
      makeRequest({ question: "List all housing examples" }, { stream: true }),
    );
    const events = await readSseEvents(response);

    expect(generateAnswerStream).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        coverage: expect.objectContaining({
          intent: "exhaustive",
          editionCount: 50,
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "stage", name: "coverage" }),
    );
    const doneEvent = events.find((event) => event.type === "done");
    expect(
      ((doneEvent?.meta as Record<string, unknown>)?.coverage as Record<string, unknown>)?.intent,
    ).toBe("exhaustive");
  });

  it("emits generic error for streaming agent failure", async () => {
    (reformulateQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      embeddingQuery: "test",
      ftsQuery: "test",
      mode: "text",
      complexity: "complex",
    });
    (runAgentLoop as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Gemini API key invalid"),
    );

    const response = await POST(makeRequest({ question: "fail question" }, { stream: true }));
    const events = await readSseEvents(response);

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.stage).toBe("agent");
    expect(errorEvent?.message).not.toContain("Gemini API key");
    expect(errorEvent?.message).toContain("error occurred");
  });

  it("stores conversation turn in streaming pipeline path", async () => {
    (reformulateQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      embeddingQuery: "simple pipeline",
      ftsQuery: "simple pipeline",
      mode: "text",
      complexity: "simple",
    });

    const response = await POST(makeRequest({ question: "pipeline streaming q" }, { stream: true }));
    await readSseEvents(response);

    expect(addConversationTurn).toHaveBeenCalledWith(
      "test-session-id",
      "pipeline streaming q",
      "Answer.",
      [],
      expect.any(Array),
    );
  });
});

describe("Answer cache (streaming)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _clearAskDedupForTests();
    clearAnswerCache();
    (reformulateQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      embeddingQuery: "cache test",
      ftsQuery: "cache test",
      mode: "text",
      complexity: "simple",
    });
    (embedQuery as ReturnType<typeof vi.fn>).mockResolvedValue(new Array(768).fill(0));
    (hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValue([mockArticle]);
    (rerankArticles as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...mockArticle, relevanceScore: 8 },
    ]);
    (generateAnswerStream as ReturnType<typeof vi.fn>).mockImplementation(() =>
      (async function* () {
        yield { type: "delta", text: "Cached answer." };
        yield {
          type: "done",
          answer: "Cached answer.",
          citations: [
            {
              articleId: "1960-01-07-0",
              headline: "Test Headline",
              editionDate: "1960-01-07",
            },
          ],
          confidence: "high",
          followUps: ["Tell me more?", "Any sources?"],
        };
      })(),
    );
  });

  it("replays the cached response with meta.cacheHit:true on the second streaming POST", async () => {
    // First request populates the cache
    const first = await POST(
      makeRequest({ question: "cache test" }, { stream: true }),
    );
    const firstEvents = await readSseEvents(first);
    const firstDone = firstEvents.find((e) => e.type === "done");
    expect(firstDone).toBeDefined();
    expect((firstDone?.meta as Record<string, unknown>)?.cacheHit).toBeUndefined();
    expect(generateAnswerStream).toHaveBeenCalledTimes(1);
    expect(embedQuery).toHaveBeenCalledTimes(1);

    // Second request hits the cache — skips embed/retrieve/rerank/generate
    const second = await POST(
      makeRequest({ question: "cache test" }, { stream: true }),
    );
    const secondEvents = await readSseEvents(second);
    const secondDone = secondEvents.find((e) => e.type === "done");
    expect(secondDone).toBeDefined();
    expect((secondDone?.meta as Record<string, unknown>)?.cacheHit).toBe(true);
    expect(secondDone?.answer).toBe("Cached answer.");
    expect(secondDone?.followUpQuestions).toEqual(["Tell me more?", "Any sources?"]);
    // Cache hit must not re-invoke the downstream pipeline
    expect(generateAnswerStream).toHaveBeenCalledTimes(1);
    expect(embedQuery).toHaveBeenCalledTimes(1);
    expect(rerankArticles).toHaveBeenCalledTimes(1);
  });

  it("emits a delta with the full cached answer before the done event on cache hit", async () => {
    await readSseEvents(
      await POST(makeRequest({ question: "cache test" }, { stream: true })),
    );
    const cached = await POST(
      makeRequest({ question: "cache test" }, { stream: true }),
    );
    const events = await readSseEvents(cached);
    const deltas = events.filter((e) => e.type === "delta");
    expect(deltas.length).toBeGreaterThan(0);
    const concatenated = deltas.map((d) => d.text).join("");
    expect(concatenated).toBe("Cached answer.");
  });

  it("does not cache agent-path (complexity=complex) answers", async () => {
    (reformulateQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      embeddingQuery: "complex q",
      ftsQuery: "complex q",
      mode: "text",
      complexity: "complex",
    });
    (runAgentLoop as ReturnType<typeof vi.fn>).mockResolvedValue({
      answer: "Agent answer.",
      citations: [],
      confidence: "high",
      toolCallCount: 1,
      rounds: 1,
      articleMeta: new Map(),
    });

    // Two identical agent-path requests
    await readSseEvents(
      await POST(makeRequest({ question: "complex q" }, { stream: true })),
    );
    await readSseEvents(
      await POST(makeRequest({ question: "complex q" }, { stream: true })),
    );
    // Agent path ran twice; cache didn't short-circuit
    expect(runAgentLoop).toHaveBeenCalledTimes(2);
  });

  it("skips cache read when conversation history is present (follow-up)", async () => {
    // Session with one prior turn — simulates a follow-up question where
    // the generator would bake history into its answer. We must not serve
    // any cached bare-question answer nor write one that could leak later.
    (getConversationHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        question: "Who played basketball?",
        answer: "The 1961 Bishops.",
        citedArticleIds: ["1961-03-01-0"],
        timestamp: Date.now(),
      },
    ]);

    // First POST with sessionId: pipeline runs.
    await readSseEvents(
      await POST(
        makeRequest(
          { question: "cache test", sessionId: "sess-A" },
          { stream: true },
        ),
      ),
    );
    expect(generateAnswerStream).toHaveBeenCalledTimes(1);

    // Second POST, same sessionId + question: should re-run pipeline
    // rather than reading from cache.
    const second = await POST(
      makeRequest(
        { question: "cache test", sessionId: "sess-A" },
        { stream: true },
      ),
    );
    const secondEvents = await readSseEvents(second);
    const secondDone = secondEvents.find((e) => e.type === "done");
    expect((secondDone?.meta as Record<string, unknown>)?.cacheHit).toBeUndefined();
    expect(generateAnswerStream).toHaveBeenCalledTimes(2);
  });

  it("skips cache write when conversation history is present", async () => {
    // First POST — with history — should run the pipeline but NOT cache.
    (getConversationHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        question: "Who played basketball?",
        answer: "The 1961 Bishops.",
        citedArticleIds: ["1961-03-01-0"],
        timestamp: Date.now(),
      },
    ]);
    await readSseEvents(
      await POST(
        makeRequest(
          { question: "cache test", sessionId: "sess-A" },
          { stream: true },
        ),
      ),
    );
    expect(generateAnswerStream).toHaveBeenCalledTimes(1);

    // Second POST — fresh session, no history. Because the first call
    // was not cached, this one must still run the pipeline.
    (getConversationHistory as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const second = await POST(
      makeRequest(
        { question: "cache test", sessionId: "sess-B" },
        { stream: true },
      ),
    );
    const secondEvents = await readSseEvents(second);
    const secondDone = secondEvents.find((e) => e.type === "done");
    expect((secondDone?.meta as Record<string, unknown>)?.cacheHit).toBeUndefined();
    expect(generateAnswerStream).toHaveBeenCalledTimes(2);
  });
});

describe("persistTurnBounded (conversation-turn race fix)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _clearAskDedupForTests();
    clearAnswerCache();
    (reformulateQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      embeddingQuery: "race-q",
      ftsQuery: "race-q",
      mode: "text",
      complexity: "simple",
    });
    (embedQuery as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Array(768).fill(0),
    );
    (hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValue([mockArticle]);
    (rerankArticles as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...mockArticle, relevanceScore: 8 },
    ]);
    (generateAnswer as ReturnType<typeof vi.fn>).mockResolvedValue({
      answer: "A",
      citations: [
        {
          articleId: "1960-01-07-0",
          headline: "Test Headline",
          editionDate: "1960-01-07",
        },
      ],
      confidence: "high",
      followUps: [],
    });
    (generateAnswerStream as ReturnType<typeof vi.fn>).mockImplementation(() =>
      (async function* () {
        yield { type: "delta", text: "A" };
        yield {
          type: "done",
          answer: "A",
          citations: [
            {
              articleId: "1960-01-07-0",
              headline: "Test Headline",
              editionDate: "1960-01-07",
            },
          ],
          confidence: "high",
          followUps: [],
        };
      })(),
    );
  });

  it("awaits the conversation-turn write before emitting SSE done", async () => {
    let writeResolved = false;
    (addConversationTurn as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            writeResolved = true;
            resolve();
          }, 50);
        }),
    );

    const response = await POST(
      makeRequest(
        { question: "race-q", sessionId: "race-sess-stream" },
        { stream: true },
      ),
    );
    const events = await readSseEvents(response);

    expect(writeResolved).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("awaits the conversation-turn write before returning the non-streaming response", async () => {
    let writeResolved = false;
    (addConversationTurn as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            writeResolved = true;
            resolve();
          }, 50);
        }),
    );

    const response = await POST(
      makeRequest({ question: "race-q", sessionId: "race-sess-json" }),
    );

    expect(response.status).toBe(200);
    expect(writeResolved).toBe(true);
  });

  it("threads conversationContext into generateAnswer on simple-path follow-ups", async () => {
    (getConversationHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        question: "Q1",
        answer: "A1",
        citedArticleIds: ["1960-01-07-0"],
        timestamp: Date.now(),
      },
    ]);
    (formatHistoryForPrompt as ReturnType<typeof vi.fn>).mockReturnValue(
      "[Turn 1] Q: Q1\nA: A1",
    );

    await POST(
      makeRequest({ question: "follow-up", sessionId: "hist-sess" }),
    );

    expect(generateAnswer).toHaveBeenCalledWith(
      "follow-up",
      expect.any(Array),
      expect.objectContaining({
        conversationContext: "[Turn 1] Q: Q1\nA: A1",
      }),
    );
  });

  it("threads conversationContext into generateAnswerStream on simple-path follow-ups", async () => {
    (getConversationHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        question: "Q1",
        answer: "A1",
        citedArticleIds: ["1960-01-07-0"],
        timestamp: Date.now(),
      },
    ]);
    (formatHistoryForPrompt as ReturnType<typeof vi.fn>).mockReturnValue(
      "[Turn 1] Q: Q1\nA: A1",
    );

    await readSseEvents(
      await POST(
        makeRequest(
          { question: "follow-up", sessionId: "hist-sess-stream" },
          { stream: true },
        ),
      ),
    );

    expect(generateAnswerStream).toHaveBeenCalledWith(
      "follow-up",
      expect.any(Array),
      expect.objectContaining({
        conversationContext: "[Turn 1] Q: Q1\nA: A1",
      }),
    );
  });

  it("omits conversationContext when there is no history", async () => {
    (getConversationHistory as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await POST(makeRequest({ question: "fresh-q", sessionId: "fresh-sess" }));

    expect(generateAnswer).toHaveBeenCalledWith(
      "fresh-q",
      expect.any(Array),
      expect.objectContaining({
        conversationContext: undefined,
      }),
    );
  });
});

describe("typed AskError response body", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _clearAskDedupForTests();
    clearAnswerCache();
    (reformulateQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      embeddingQuery: "q",
      ftsQuery: "q",
      mode: "text",
    });
    (embedQuery as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Array(768).fill(0),
    );
    (hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValue([mockArticle]);
    (rerankArticles as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...mockArticle, relevanceScore: 8 },
    ]);
    (generateAnswer as ReturnType<typeof vi.fn>).mockResolvedValue({
      answer: "A",
      citations: [
        {
          articleId: "1960-01-07-0",
          headline: "Test",
          editionDate: "1960-01-07",
        },
      ],
      confidence: "high",
      followUps: [],
    });
  });

  it("400 bad_request for missing question", async () => {
    const response = await POST(makeRequest({}));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.kind).toBe("bad_request");
    expect(body.message).toBe("Missing required field: question");
    expect(body.error).toBe(body.message);
  });

  it("400 bad_request for empty question", async () => {
    const response = await POST(makeRequest({ question: "  " }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.kind).toBe("bad_request");
  });

  it("400 bad_request for too-long question", async () => {
    const response = await POST(
      makeRequest({ question: "a".repeat(1001) }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.kind).toBe("bad_request");
  });

  it("429 budget when vector quota and full-text retrieval both fail", async () => {
    (embedQuery as ReturnType<typeof vi.fn>).mockRejectedValue(
      new MockQuotaExhaustedError("embedQuery", { code: 429 }),
    );
    (searchArticlesForRag as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("database unavailable"),
    );

    const response = await POST(makeRequest({ question: "q" }));
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.kind).toBe("budget");
    expect(body.retryAfterSec).toBe(3600);
    expect(body.cause).toBe("quota_exhausted");
    expect(body.stage).toBe("retrieve");
    expect(response.headers.get("Retry-After")).toBe("3600");
  });

  it("500 server when both retrieval signals fail generically", async () => {
    (embedQuery as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network error"),
    );
    (searchArticlesForRag as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("database unavailable"),
    );

    const response = await POST(makeRequest({ question: "q" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.kind).toBe("server");
    expect(body.stage).toBe("retrieve");
    expect(body.requestId).toBeDefined();
  });

  it("500 server on unexpected reranker error", async () => {
    (rerankArticles as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("reranker crashed"),
    );

    const response = await POST(makeRequest({ question: "q" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.kind).toBe("server");
    expect(body.stage).toBe("rerank");
  });
});
