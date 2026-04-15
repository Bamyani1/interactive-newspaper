import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Re-declare QuotaExhaustedError shape inside the mock so tests can throw
// it without dragging in the real module. vi.hoisted ensures the class is
// defined when the hoisted vi.mock factory runs.
const { MockQuotaExhaustedError } = vi.hoisted(() => {
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
  return { MockQuotaExhaustedError };
});

vi.mock("@/src/lib/embeddings", () => ({
  embedQuery: vi.fn(),
  QuotaExhaustedError: MockQuotaExhaustedError,
}));

vi.mock("@/src/lib/db", () => ({
  hybridSearch: vi.fn(),
  queryArticlesByEmbedding: vi.fn(),
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

import {
  POST,
  _setGlobalDeadlineForTests,
  _setRetrievalTimeoutForTests,
  _clearAskDedupForTests,
  _askDedupInternalsForTests,
} from "@/src/app/api/ask/route";
import type { NextResponse } from "next/server";
import { embedQuery } from "@/src/lib/embeddings";
import { hybridSearch, queryArticlesByEmbedding } from "@/src/lib/db";
import { generateAnswer, generateAnswerStream } from "@/src/lib/answer-generator";
import { reformulateQuery } from "@/src/lib/query-reformulator";
import { rerankArticles } from "@/src/lib/reranker";

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
};

describe("POST /api/ask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _clearAskDedupForTests();
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

  it("returns 502 when embedding fails", async () => {
    (embedQuery as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("API key missing"));

    const response = await POST(makeRequest({ question: "What happened?" }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toBe("Failed to process question. Please try again.");
  });

  it("returns 429 + Retry-After when embedQuery throws QuotaExhaustedError", async () => {
    (embedQuery as ReturnType<typeof vi.fn>).mockRejectedValue(
      new MockQuotaExhaustedError("embedQuery", { code: 429 }),
    );

    const response = await POST(makeRequest({ question: "What happened?" }));
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error).toMatch(/quota/i);
    expect(body.cause).toBe("quota_exhausted");
    expect(body.stage).toBe("embed");
    expect(typeof body.requestId).toBe("string");
    expect(body.requestId.length).toBeGreaterThan(0);
    expect(response.headers.get("Retry-After")).toBe("3600");
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

  it("502 embed failure includes stage='embed' and requestId", async () => {
    (embedQuery as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network error"),
    );

    const response = await POST(makeRequest({ question: "What happened?" }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.stage).toBe("embed");
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
    expect(hybridSearch).toHaveBeenCalledWith(
      "OWU OR Ohio Wesleyan",
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
    (hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValue(retrieved);
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

  // Retrieval timeout should fire BEFORE the global deadline when
  // hybridSearch hangs — the inner 10s budget must win over the outer
  // 30s budget. Uses short deadlines so the test runs in real wall time.
  it("retrieval timeout fires before the global deadline (stage=retrieve, not deadline)", async () => {
    _setGlobalDeadlineForTests(2000);
    _setRetrievalTimeoutForTests(150);
    try {
      // Both hybrid AND the vector-only fallback hang; the inner retrieval
      // timeout should fire for hybrid, return 504 with stage=retrieve.
      (hybridSearch as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise(() => {}),
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
    expect(hybridSearch).toHaveBeenCalledTimes(1);
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

  it("streaming: happy path emits stage*4 → metadata → delta*2 → done", async () => {
    const response = await POST(
      makeRequest({ question: "streaming happy path" }, { stream: true }),
    );
    const events = await readSseEvents(response);

    const types = events.map((e) => e.type);
    // Order matters: reformulate → embed → retrieve → rerank stages,
    // then metadata (needs reranked source articles), then deltas from
    // generateAnswerStream, then the final done event.
    expect(types).toEqual([
      "stage",
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
      "embed",
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

  it("streaming: embed quota → error with cause=quota_exhausted", async () => {
    (embedQuery as ReturnType<typeof vi.fn>).mockRejectedValue(
      new MockQuotaExhaustedError("embedQuery", { code: 429 }),
    );

    const response = await POST(
      makeRequest({ question: "err embed quota" }, { stream: true }),
    );
    const events = await readSseEvents(response);

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.stage).toBe("embed");
    expect(errorEvent!.cause).toBe("quota_exhausted");
    expect(errorEvent!.message).toMatch(/quota/i);
  });

  it("streaming: embed generic failure → error with stage=embed", async () => {
    (embedQuery as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network failed"),
    );

    const response = await POST(
      makeRequest({ question: "err embed generic" }, { stream: true }),
    );
    const events = await readSseEvents(response);

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.stage).toBe("embed");
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

  it("returns 502 with stage='embed' when embed throws a Gemini 503-style error", async () => {
    // Gemini SERVICE_UNAVAILABLE (503) is not a QuotaExhaustedError and
    // not a timeout — it's a transient 5xx. Today the route collapses
    // all non-quota embed failures into a generic 502. This test pins
    // that behavior so a future change that surfaces 503 distinctly
    // (e.g., a dedicated 503 passthrough) breaks this test on purpose
    // and forces explicit migration instead of silent drift.
    const serviceUnavailable = Object.assign(
      new Error("Gemini API error: 503 SERVICE_UNAVAILABLE upstream connect error"),
      { status: "UNAVAILABLE", code: 503 },
    );
    (embedQuery as ReturnType<typeof vi.fn>).mockRejectedValue(serviceUnavailable);

    const response = await POST(
      makeRequest({ question: "Kennedy visit to Ohio" }),
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.stage).toBe("embed");
    expect(body.error).toBe("Failed to process question. Please try again.");
    expect(typeof body.requestId).toBe("string");
    expect(body.requestId.length).toBeGreaterThan(0);
    // Retry-After header is NOT set for generic 502 (only for quota 429)
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
    expect(errorEvent?.message).toMatch(/Gemini stream interrupted/);
    expect(typeof errorEvent?.requestId).toBe("string");
    expect((errorEvent?.requestId as string).length).toBeGreaterThan(0);

    // No 'done' event should be emitted when the stream errors out — the
    // client differentiates by receiving 'error' instead.
    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeUndefined();
  });
});
