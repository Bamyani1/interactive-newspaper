/** @vitest-environment node */
// Uses node env (not jsdom) because embedQuery relies on AbortSignal.any,
// a Node 20+ / Chrome 105+ feature that jsdom's polyfill does not provide.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the shared Gemini client so embedDocuments calls a controllable fake
// instead of hitting the real API. vi.hoisted ensures mockEmbedContent is
// defined when the hoisted vi.mock factory runs.
const { mockEmbedContent } = vi.hoisted(() => ({
  mockEmbedContent: vi.fn(),
}));

vi.mock("@/src/lib/gemini-client", () => ({
  getGeminiClient: () => ({
    models: { embedContent: mockEmbedContent },
  }),
}));

import {
  buildEmbeddingText,
  buildEmbeddingInput,
  embedDocuments,
  embedQuery,
  EmbedTimeoutError,
  QuotaExhaustedError,
} from "@/src/lib/embeddings";

describe("buildEmbeddingText", () => {
  it("builds text with title and body prefix format", () => {
    const text = buildEmbeddingText({
      headline: "Test Headline",
      body_plain: "Some content",
      edition_date: "1960-01-13",
      category: "News",
    });

    expect(text).toContain("title: Test Headline");
    expect(text).toContain("text:");
    expect(text).toContain("Some content");
    expect(text).toContain("1960-01-13");
  });

  it("truncates body when total text exceeds MAX_EMBEDDING_CHARS", () => {
    const longBody = "x".repeat(40_000);
    const text = buildEmbeddingText({
      headline: "Short Headline",
      body_plain: longBody,
      edition_date: "1960-01-13",
      category: "News",
    });

    // Should be capped at 30,000 chars total
    expect(text.length).toBeLessThanOrEqual(30_000);
    // Should still contain the headline and preamble (not truncated from the front)
    expect(text).toContain("title: Short Headline");
    expect(text).toContain("1960-01-13");
  });

  it("does not truncate text under the limit", () => {
    const normalBody = "Normal article content about campus events.";
    const text = buildEmbeddingText({
      headline: "Normal Headline",
      body_plain: normalBody,
      edition_date: "1960-01-13",
      category: "News",
    });

    expect(text).toContain(normalBody);
  });
});

describe("buildEmbeddingInput", () => {
  it("returns text-only input when no image provided", () => {
    const input = buildEmbeddingInput({
      headline: "Test",
      body_plain: "Content",
      edition_date: "1960-01-13",
      category: "News",
    });
    expect(input.text).toContain("title: Test");
    expect(input.imageBase64).toBeUndefined();
  });

  it("includes image data when imageBase64 is provided", () => {
    const input = buildEmbeddingInput({
      headline: "Test",
      body_plain: "Content",
      edition_date: "1960-01-13",
      category: "News",
      imageBase64: "iVBORw0KGgo=",
      imageMimeType: "image/jpeg",
    });
    expect(input.text).toContain("title: Test");
    expect(input.imageBase64).toBe("iVBORw0KGgo=");
    expect(input.imageMimeType).toBe("image/jpeg");
  });
});

// ─── embedDocuments ─────────────────────────────────────────────
// Covers the happy path for text-only batches and the critical timeout
// wrap added for issue 0029's sibling (new latent finding #1).

function makeFakeVector(seed = 0): number[] {
  return Array.from({ length: 768 }, (_, i) => ((i + seed) % 100) / 100);
}

describe("embedDocuments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("batches text-only inputs and returns vectors in input order", async () => {
    mockEmbedContent.mockResolvedValueOnce({
      embeddings: [
        { values: makeFakeVector(1) },
        { values: makeFakeVector(2) },
      ],
    });

    const result = await embedDocuments([
      { text: "first" },
      { text: "second" },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(makeFakeVector(1));
    expect(result[1]).toEqual(makeFakeVector(2));
    expect(mockEmbedContent).toHaveBeenCalledTimes(1);
    const call = mockEmbedContent.mock.calls[0][0] as {
      model: string;
      contents: Array<{ parts: Array<{ text: string }> }>;
      config: { outputDimensionality: number; abortSignal?: AbortSignal };
    };
    expect(call.model).toBe("gemini-embedding-2-preview");
    expect(call.contents).toHaveLength(2);
    expect(call.contents[0].parts[0].text).toBe("first");
    // Step 2 wraps the call with AbortController, so the signal must be passed
    expect(call.config.abortSignal).toBeDefined();
  });

  it("throws EmbedTimeoutError when embedContent hangs past the budget", async () => {
    // Mock hangs forever. embedWithTimeout's Promise.race should still fire
    // at timeoutMs even though the mock never honors the signal.
    mockEmbedContent.mockImplementation(
      () => new Promise<never>(() => {}),
    );

    vi.useFakeTimers();
    try {
      // Pre-attach a rejection handler so the rejection is always observed
      // synchronously when timers fire (avoids vitest's unhandled-rejection
      // warning from the brief gap between the timer firing and a later await).
      let caught: unknown;
      const settled = embedDocuments([{ text: "never resolves" }]).catch((err) => {
        caught = err;
      });
      await vi.advanceTimersByTimeAsync(30_100);
      await settled;
      expect(caught).toBeInstanceOf(EmbedTimeoutError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("EmbedTimeoutError carries op name and timeout budget", async () => {
    mockEmbedContent.mockImplementation(
      () => new Promise<never>(() => {}),
    );

    vi.useFakeTimers();
    try {
      let caught: unknown;
      const settled = embedDocuments([{ text: "hung" }]).catch((err) => {
        caught = err;
      });
      await vi.advanceTimersByTimeAsync(30_100);
      await settled;
      expect(caught).toBeInstanceOf(EmbedTimeoutError);
      if (caught instanceof EmbedTimeoutError) {
        expect(caught.op).toBe("embedDocuments.textBatch");
        expect(caught.timeoutMs).toBe(30_000);
        expect(caught.name).toBe("EmbedTimeoutError");
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws on mismatched response length", async () => {
    mockEmbedContent.mockResolvedValueOnce({
      embeddings: [{ values: makeFakeVector(1) }], // only 1 returned
    });

    await expect(
      embedDocuments([{ text: "first" }, { text: "second" }]),
    ).rejects.toThrow(/Embedding response mismatch/);
  });

  it("throws on invalid embedding dimensions", async () => {
    mockEmbedContent.mockResolvedValueOnce({
      embeddings: [{ values: [1, 2, 3] }], // wrong dims
    });

    await expect(embedDocuments([{ text: "first" }])).rejects.toThrow(
      /Invalid embedding dimensions/,
    );
  });

  it("returns empty array for empty input", async () => {
    const result = await embedDocuments([]);
    expect(result).toEqual([]);
    expect(mockEmbedContent).not.toHaveBeenCalled();
  });

  // Multimodal partial-failure atomicity (Step 5)
  // The image branch processes inputs sequentially. If any one throws,
  // embedDocuments must throw the whole batch — never return an array
  // with undefined holes that would silently poison the database.

  it("throws atomically when image #3 of 5 fails partway through", async () => {
    // First call: text-batch (the function processes text-only inputs as one batch)
    // Then 5 sequential image calls; we want the 3rd to throw.
    let imageCallCount = 0;
    mockEmbedContent.mockImplementation(async (params: { contents: Array<{ parts: unknown[] }> }) => {
      // Detect image input by checking for inlineData in parts
      const parts = params.contents[0].parts as Array<{ text?: string; inlineData?: unknown }>;
      const isImage = parts.some((p) => p.inlineData !== undefined);
      if (!isImage) {
        // text batch, return one vector per input
        return {
          embeddings: params.contents.map((_, i) => ({ values: makeFakeVector(i + 100) })),
        };
      }
      // image input
      imageCallCount++;
      if (imageCallCount === 3) {
        throw new Error("simulated image #3 failure");
      }
      return { embeddings: [{ values: makeFakeVector(imageCallCount) }] };
    });

    const inputs = [
      { text: "img1", imageBase64: "AAA", imageMimeType: "image/jpeg" },
      { text: "img2", imageBase64: "BBB", imageMimeType: "image/jpeg" },
      { text: "img3", imageBase64: "CCC", imageMimeType: "image/jpeg" },
      { text: "img4", imageBase64: "DDD", imageMimeType: "image/jpeg" },
      { text: "img5", imageBase64: "EEE", imageMimeType: "image/jpeg" },
    ];

    await expect(embedDocuments(inputs)).rejects.toThrow(
      /Multimodal embedding failed on image 3 of 5/,
    );

    // Critical: subsequent images should NOT have been called (atomic abort)
    expect(imageCallCount).toBe(3);
  });

  it("throws when image branch returns malformed embedding", async () => {
    mockEmbedContent.mockResolvedValueOnce({
      embeddings: [], // empty — malformed for an image call
    });

    await expect(
      embedDocuments([{ text: "x", imageBase64: "AAA" }]),
    ).rejects.toThrow(/Failed to generate multimodal embedding/);
  });

  // QuotaExhaustedError detection (Step 6 / issue 0028)
  // Gemini may surface 429 RESOURCE_EXHAUSTED in several shapes; we detect
  // any of them and rethrow as a typed error so callers can early-abort.

  it("throws QuotaExhaustedError when SDK error has code: 429", async () => {
    const quotaErr = Object.assign(new Error("rate limit"), { code: 429 });
    mockEmbedContent.mockRejectedValueOnce(quotaErr);

    await expect(embedDocuments([{ text: "x" }])).rejects.toBeInstanceOf(
      QuotaExhaustedError,
    );
  });

  it("throws QuotaExhaustedError when SDK error has nested error.code: 429", async () => {
    const quotaErr = Object.assign(new Error("rate limit"), {
      error: { code: 429, status: "RESOURCE_EXHAUSTED" },
    });
    mockEmbedContent.mockRejectedValueOnce(quotaErr);

    await expect(embedDocuments([{ text: "x" }])).rejects.toBeInstanceOf(
      QuotaExhaustedError,
    );
  });

  it("throws QuotaExhaustedError when error message contains RESOURCE_EXHAUSTED", async () => {
    const quotaErr = new Error(
      'Embedding batch error: {"error":{"code":429,"message":"You exceeded your current quota","status":"RESOURCE_EXHAUSTED"}}',
    );
    mockEmbedContent.mockRejectedValueOnce(quotaErr);

    await expect(embedDocuments([{ text: "x" }])).rejects.toBeInstanceOf(
      QuotaExhaustedError,
    );
  });

  it("does NOT classify a generic 500 error as QuotaExhaustedError", async () => {
    const otherErr = Object.assign(new Error("server error"), { code: 500 });
    mockEmbedContent.mockRejectedValueOnce(otherErr);

    const promise = embedDocuments([{ text: "x" }]);
    await expect(promise).rejects.not.toBeInstanceOf(QuotaExhaustedError);
    await expect(promise).rejects.toThrow(/server error/);
  });

  it("QuotaExhaustedError preserves the underlying cause + op name", async () => {
    const quotaErr = Object.assign(new Error("rate limit"), { code: 429 });
    mockEmbedContent.mockRejectedValueOnce(quotaErr);

    try {
      await embedDocuments([{ text: "x" }]);
      throw new Error("expected QuotaExhaustedError");
    } catch (err) {
      expect(err).toBeInstanceOf(QuotaExhaustedError);
      if (err instanceof QuotaExhaustedError) {
        expect(err.op).toBe("embedDocuments.textBatch");
        expect(err.cause).toBe(quotaErr);
        expect(err.name).toBe("QuotaExhaustedError");
      }
    }
  });

  it("succeeds when text and image branches both complete (mixed batch)", async () => {
    let imgCount = 0;
    mockEmbedContent.mockImplementation(async (params: { contents: Array<{ parts: unknown[] }> }) => {
      const parts = params.contents[0].parts as Array<{ text?: string; inlineData?: unknown }>;
      const isImage = parts.some((p) => p.inlineData !== undefined);
      if (!isImage) {
        return {
          embeddings: params.contents.map((_, i) => ({ values: makeFakeVector(i) })),
        };
      }
      imgCount++;
      return { embeddings: [{ values: makeFakeVector(500 + imgCount) }] };
    });

    const inputs = [
      { text: "text1" },
      { text: "img1", imageBase64: "AAA" },
      { text: "text2" },
      { text: "img2", imageBase64: "BBB" },
    ];

    const result = await embedDocuments(inputs);

    expect(result).toHaveLength(4);
    // No undefined holes
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBeDefined();
      expect(result[i]).toHaveLength(768);
    }
    // text1 and text2 came from the text batch (positions 0, 1 in the batch)
    expect(result[0]).toEqual(makeFakeVector(0));
    expect(result[2]).toEqual(makeFakeVector(1));
    // images came from sequential image calls
    expect(result[1]).toEqual(makeFakeVector(501));
    expect(result[3]).toEqual(makeFakeVector(502));
  });
});

// ─── embedQuery ─────────────────────────────────────────────────
// embedQuery has its own error-conversion try/catch separate from
// embedWithTimeout (it rolls its own timer). These tests cover the
// pre-aborted signal short-circuit (Step 3) and the quota-exhaustion
// conversion at the embedQuery call site (Step 5 — previously only
// tested indirectly through ask-route.test.ts's MockQuotaExhaustedError).

describe("embedQuery", () => {
  beforeEach(() => {
    // mockReset clears both history AND any leaked mockImplementation from
    // the embedDocuments block (notably the persistent mixed-batch impl).
    // clearAllMocks only clears history, so queued mockRejectedValueOnce
    // calls would otherwise fall back to a stale impl after one call.
    mockEmbedContent.mockReset();
  });

  it("throws immediately when signal is pre-aborted (no SDK call)", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      embedQuery("step3 abort test query", { signal: controller.signal }),
    ).rejects.toThrow(/signal already aborted/);

    // Must NOT have called the real SDK — short-circuited before dispatch
    expect(mockEmbedContent).not.toHaveBeenCalled();
  });

  it("still runs normally when signal is provided but not aborted", async () => {
    mockEmbedContent.mockResolvedValueOnce({
      embeddings: [{ values: makeFakeVector(42) }],
    });
    const controller = new AbortController();

    const result = await embedQuery("step3 not-aborted query", {
      signal: controller.signal,
    });

    expect(result).toHaveLength(768);
    expect(mockEmbedContent).toHaveBeenCalledTimes(1);
  });

  it("converts 429 Gemini errors into QuotaExhaustedError at the embedQuery call site", async () => {
    const quotaErr = Object.assign(new Error("rate limit hit"), { code: 429 });
    mockEmbedContent.mockRejectedValueOnce(quotaErr);

    try {
      await embedQuery("step5 quota test query");
      throw new Error("expected QuotaExhaustedError");
    } catch (err) {
      expect(err).toBeInstanceOf(QuotaExhaustedError);
      if (err instanceof QuotaExhaustedError) {
        expect(err.op).toBe("embedQuery");
        expect(err.cause).toBe(quotaErr);
      }
    }
  });

  it("converts nested RESOURCE_EXHAUSTED error into QuotaExhaustedError", async () => {
    const quotaErr = Object.assign(new Error("quota"), {
      error: { code: 429, status: "RESOURCE_EXHAUSTED" },
    });
    mockEmbedContent.mockRejectedValueOnce(quotaErr);

    await expect(
      embedQuery("step5 nested-quota test query"),
    ).rejects.toBeInstanceOf(QuotaExhaustedError);
  });

  it("does NOT convert a generic 500 error into QuotaExhaustedError", async () => {
    const otherErr = Object.assign(new Error("server boom"), { code: 500 });
    mockEmbedContent.mockRejectedValueOnce(otherErr);

    const promise = embedQuery("step5 generic-error test query");
    await expect(promise).rejects.not.toBeInstanceOf(QuotaExhaustedError);
    await expect(promise).rejects.toThrow(/server boom/);
  });
});
