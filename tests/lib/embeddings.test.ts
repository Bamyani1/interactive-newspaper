/** @vitest-environment node */
// Uses node env (not jsdom) because embedQuery relies on AbortSignal.any,
// a Node 20+ / Chrome 105+ feature that jsdom's polyfill does not provide.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  buildChunkHeader,
  buildEmbeddingText,
  buildEmbeddingInput,
  embedArticleChunks,
  embedDocuments,
  embedQuery,
  EmbedTimeoutError,
  QuotaExhaustedError,
  _setQuotaRetryDelaysForTests,
  _clearQueryEmbeddingCacheForTests,
  _resetVoyagePaceForTests,
  embeddingInputFingerprint,
  EMBEDDING_INPUT_VERSION,
  IMAGE_EMBEDDING_INPUT_VERSION,
} from "@/src/lib/embeddings";

const mockFetch = vi.fn();

function makeFakeVector(seed: number): number[] {
  return Array.from({ length: 1024 }, (_, i) => (seed + i) / 10_000);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface FetchCall {
  url: string;
  body: Record<string, unknown>;
}

function fetchCalls(): FetchCall[] {
  return mockFetch.mock.calls.map(([url, init]) => ({
    url: String(url),
    body: JSON.parse(String((init as RequestInit).body)),
  }));
}

/** Answers contextualized requests with one vector per chunk, seeded by position. */
function contextualizedEcho(seedBase = 0) {
  let seed = seedBase;
  return async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { inputs: string[][] };
    return jsonResponse({
      data: body.inputs.map((texts, index) => ({
        index,
        data: texts.map((_, chunk) => ({ index: chunk, embedding: makeFakeVector(seed++) })),
      })),
      usage: { total_tokens: 10 },
    });
  };
}

/** Answers multimodal requests with one vector per input, in reverse order. */
function multimodalEcho(seedBase = 0) {
  let seed = seedBase;
  return async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { inputs: unknown[] };
    const data = body.inputs.map((_, index) => ({ index, embedding: makeFakeVector(seed++) }));
    return jsonResponse({
      data: data.reverse(),
      usage: { total_tokens: 10, text_tokens: 10, image_pixels: 1000 },
    });
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
  vi.stubEnv("VOYAGE_API_KEY", "test-key");
  _setQuotaRetryDelaysForTests([]);
  _clearQueryEmbeddingCacheForTests();
  _resetVoyagePaceForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("buildEmbeddingText", () => {
  it("leads with the headline and carries the source line, without Gemini prefixes", () => {
    const text = buildEmbeddingText({
      headline: "Test Headline",
      body_plain: "Some content",
      edition_date: "1960-01-13",
      category: "News",
    });

    expect(text.startsWith("Test Headline\n\n")).toBe(true);
    expect(text).toContain("1960-01-13, News section.");
    expect(text).toContain("Some content");
    expect(text).not.toContain("title:");
  });

  it("caps the text at MAX_EMBEDDING_CHARS, keeping the front", () => {
    const text = buildEmbeddingText({
      headline: "Short Headline",
      body_plain: "x".repeat(40_000),
      edition_date: "1960-01-13",
      category: "News",
    });

    expect(text.length).toBeLessThanOrEqual(30_000);
    expect(text).toContain("Short Headline");
    expect(text).toContain("1960-01-13");
  });
});

describe("buildChunkHeader", () => {
  it("names the paper, date, section, headline and byline", () => {
    expect(
      buildChunkHeader({
        headline: "Kent Hands Swim Team First Defeat",
        byline: "By Bob Reece",
        edition_date: "1953-01-14",
        category: "Sports",
      })
    ).toBe(
      "From The Transcript Archive (Ohio Wesleyan University newspaper), 1953-01-14, Sports section.\n" +
        "Headline: Kent Hands Swim Team First Defeat\n" +
        "Byline: By Bob Reece"
    );
  });
});

describe("buildEmbeddingInput", () => {
  it("returns text-only input when no image provided", () => {
    const input = buildEmbeddingInput({ headline: "Test", body_plain: "Content" });
    expect(input.imageBase64).toBeUndefined();
    expect(input.text).toContain("Content");
  });

  it("includes image data when imageBase64 is provided", () => {
    const input = buildEmbeddingInput({
      headline: "Test",
      body_plain: "Content",
      imageBase64: "base64data",
      imageMimeType: "image/png",
    });
    expect(input.imageBase64).toBe("base64data");
    expect(input.imageMimeType).toBe("image/png");
  });
});

describe("embedArticleChunks", () => {
  it("sends each article as one list led by its header and drops the header's vector", async () => {
    mockFetch.mockImplementation(contextualizedEcho());

    const result = await embedArticleChunks([
      { header: "H1", chunks: ["a1", "a2"] },
      { header: "H2", chunks: ["b1"] },
    ]);

    const [call] = fetchCalls();
    expect(call.url).toBe("https://api.voyageai.com/v1/contextualizedembeddings");
    expect(call.body).toEqual({
      model: "voyage-context-4",
      input_type: "document",
      output_dimension: 1024,
      inputs: [
        ["H1", "a1", "a2"],
        ["H2", "b1"],
      ],
    });
    // Seeds 0 and 3 belong to the headers.
    expect(result).toEqual([[makeFakeVector(1), makeFakeVector(2)], [makeFakeVector(4)]]);
  });

  it("splits a long article into parts that each keep the header", async () => {
    mockFetch.mockImplementation(contextualizedEcho());
    const chunk = "y".repeat(40_000); // ~13K estimated tokens each

    const result = await embedArticleChunks([{ header: "H", chunks: [chunk, chunk, chunk] }]);

    const inputs = fetchCalls().flatMap((call) => call.body.inputs as string[][]);
    expect(inputs.length).toBeGreaterThan(1);
    for (const part of inputs) expect(part[0]).toBe("H");
    expect(inputs.flatMap((part) => part.slice(1))).toEqual([chunk, chunk, chunk]);
    expect(result[0]).toHaveLength(3);
  });

  it("sends an empty chunk as the header, since Voyage rejects empty strings", async () => {
    mockFetch.mockImplementation(contextualizedEcho());

    const result = await embedArticleChunks([{ header: "H", chunks: ["", "  \n"] }]);

    expect(fetchCalls()[0].body.inputs).toEqual([["H", "H", "H"]]);
    expect(result[0]).toHaveLength(2);
  });

  it("rejects a response with the wrong chunk count", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ data: [{ index: 0, data: [{ index: 0, embedding: makeFakeVector(0) }] }] })
    );

    await expect(embedArticleChunks([{ header: "H", chunks: ["a"] }])).rejects.toThrow(
      /wrong chunk count/
    );
  });

  it("rejects vectors of the wrong dimension", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: [
          {
            index: 0,
            data: [
              { index: 0, embedding: [0.1] },
              { index: 1, embedding: [0.1] },
            ],
          },
        ],
      })
    );

    await expect(embedArticleChunks([{ header: "H", chunks: ["a"] }])).rejects.toThrow(
      /expected 1024/
    );
  });
});

describe("embedDocuments", () => {
  it("sends caption text and the image as a data URL, and restores input order", async () => {
    mockFetch.mockImplementation(multimodalEcho());

    const result = await embedDocuments([
      { text: "caption one", imageBase64: "AAAA", imageMimeType: "image/webp" },
      { text: "caption two" },
    ]);

    const [call] = fetchCalls();
    expect(call.url).toBe("https://api.voyageai.com/v1/multimodalembeddings");
    expect(call.body).toEqual({
      model: "voyage-multimodal-3.5",
      input_type: "document",
      output_dimension: 1024,
      inputs: [
        {
          content: [
            { type: "text", text: "caption one" },
            { type: "image_base64", image_base64: "data:image/webp;base64,AAAA" },
          ],
        },
        { content: [{ type: "text", text: "caption two" }] },
      ],
    });
    expect(result).toEqual([makeFakeVector(0), makeFakeVector(1)]);
  });

  it("sends at most 16 photos per request", async () => {
    mockFetch.mockImplementation(multimodalEcho());
    const inputs = Array.from({ length: 20 }, (_, i) => ({ text: `caption ${i}` }));

    const result = await embedDocuments(inputs);

    expect(fetchCalls().map((call) => (call.body.inputs as unknown[]).length)).toEqual([16, 4]);
    expect(result).toHaveLength(20);
  });

  it("returns empty array for empty input", async () => {
    await expect(embedDocuments([])).resolves.toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("retries a 429 on the batch delays, then throws QuotaExhaustedError", async () => {
    _setQuotaRetryDelaysForTests([1, 1]);
    mockFetch.mockImplementation(async () => jsonResponse({ detail: "rate limited" }, 429));

    const err = await embedDocuments([{ text: "c" }]).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(QuotaExhaustedError);
    expect((err as QuotaExhaustedError).op).toBe("embedDocuments");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("recovers when a transient 429 clears", async () => {
    _setQuotaRetryDelaysForTests([1]);
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ detail: "rate limited" }, 429))
      .mockImplementationOnce(multimodalEcho(7));

    await expect(embedDocuments([{ text: "c" }])).resolves.toEqual([makeFakeVector(7)]);
  });

  it("does not retry or reclassify a 500", async () => {
    _setQuotaRetryDelaysForTests([1, 1]);
    mockFetch.mockResolvedValue(jsonResponse({ detail: "boom" }, 500));

    const err = await embedDocuments([{ text: "c" }]).catch((e: unknown) => e);

    expect(err).not.toBeInstanceOf(QuotaExhaustedError);
    expect(String(err)).toMatch(/Voyage HTTP 500/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws when the response is missing vectors", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ data: [] }));
    await expect(embedDocuments([{ text: "c" }])).rejects.toThrow(/0 vectors for 1 inputs/);
  });

  it("throws EmbedTimeoutError when a request hangs past its budget", async () => {
    vi.useFakeTimers();
    try {
      mockFetch.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
            );
          })
      );
      const promise = embedDocuments([{ text: "c" }]);
      promise.catch(() => {});
      await vi.advanceTimersByTimeAsync(60_000);
      const err = await promise.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EmbedTimeoutError);
      expect((err as EmbedTimeoutError).timeoutMs).toBe(60_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("embedding input identity", () => {
  it("versions text chunks and image inputs separately", () => {
    expect(EMBEDDING_INPUT_VERSION).toBe("article-chunk-voyage-v1");
    expect(IMAGE_EMBEDDING_INPUT_VERSION).toBe("article-image-voyage-v1");
  });

  it("changes the fingerprint when header, text, image bytes, or version changes", () => {
    const base = { header: "H", text: "Body" };
    const first = embeddingInputFingerprint(base);
    expect(embeddingInputFingerprint(base)).toBe(first);
    expect(embeddingInputFingerprint({ ...base, header: "H2" })).not.toBe(first);
    expect(embeddingInputFingerprint({ ...base, text: "Body." })).not.toBe(first);
    expect(embeddingInputFingerprint(base, "article-chunk-voyage-v2")).not.toBe(first);

    const photo = { text: "caption", imageBase64: "bytes", imageMimeType: "image/webp" };
    const photoPrint = embeddingInputFingerprint(photo, IMAGE_EMBEDDING_INPUT_VERSION);
    expect(
      embeddingInputFingerprint({ ...photo, imageBase64: "other" }, IMAGE_EMBEDDING_INPUT_VERSION)
    ).not.toBe(photoPrint);
  });
});

describe("embedQuery", () => {
  it("embeds a text query alone with the chunk model", async () => {
    mockFetch.mockImplementation(contextualizedEcho(4));

    await expect(embedQuery("Who edited the paper in 1962?")).resolves.toEqual(makeFakeVector(4));

    const [call] = fetchCalls();
    expect(call.url).toBe("https://api.voyageai.com/v1/contextualizedembeddings");
    expect(call.body).toEqual({
      model: "voyage-context-4",
      input_type: "query",
      output_dimension: 1024,
      inputs: [["Who edited the paper in 1962?"]],
    });
  });

  it("embeds a photo query with the image model", async () => {
    mockFetch.mockImplementation(multimodalEcho(9));

    await expect(embedQuery("photos of protests", { kind: "image" })).resolves.toEqual(
      makeFakeVector(9)
    );

    const [call] = fetchCalls();
    expect(call.url).toBe("https://api.voyageai.com/v1/multimodalembeddings");
    expect(call.body).toMatchObject({
      model: "voyage-multimodal-3.5",
      input_type: "query",
      inputs: [{ content: [{ type: "text", text: "photos of protests" }] }],
    });
  });

  it("caches per model, so a photo query never reuses a text vector", async () => {
    mockFetch
      .mockImplementationOnce(contextualizedEcho(1))
      .mockImplementationOnce(multimodalEcho(2));

    await embedQuery("same words");
    await embedQuery("same words");
    await embedQuery("same words", { kind: "image" });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("bypasses the query embedding cache in evaluation mode", async () => {
    vi.stubEnv("RAG_EVALUATION_MODE", "1");
    vi.stubEnv("RAG_EVALUATION_RUN_ID", "embedding-cache-test");
    vi.stubEnv("RAG_CORPUS_VERSION", "legacy-test");
    mockFetch.mockImplementation(contextualizedEcho(7));

    await embedQuery("repeat exactly");
    await embedQuery("repeat exactly");

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws immediately when signal is pre-aborted (no API call)", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(embedQuery("abort test", { signal: controller.signal })).rejects.toThrow(
      /signal already aborted/
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // A live query embed backs off twice before giving up, on real delays,
  // so the rejection is driven through fake timers.
  it("converts a 429 into QuotaExhaustedError after the live retries", async () => {
    mockFetch.mockImplementation(async () => jsonResponse({ detail: "rate limited" }, 429));

    vi.useFakeTimers();
    try {
      const promise = embedQuery("quota test");
      promise.catch(() => {});
      await vi.advanceTimersByTimeAsync(3_000);
      const err = await promise.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(QuotaExhaustedError);
      expect((err as QuotaExhaustedError).op).toBe("embedQuery");
      // One attempt plus the two live backoff retries.
      expect(mockFetch).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers when a transient query-embed quota trip clears", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ detail: "rate limited" }, 429))
      .mockImplementationOnce(contextualizedEcho(3));

    vi.useFakeTimers();
    try {
      const promise = embedQuery("transient quota");
      promise.catch(() => {});
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(promise).resolves.toHaveLength(1024);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT convert a generic 500 error into QuotaExhaustedError", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ detail: "server boom" }, 500));

    const promise = embedQuery("generic error");
    await expect(promise).rejects.not.toBeInstanceOf(QuotaExhaustedError);
    await expect(promise).rejects.toThrow(/server boom/);
  });

  it("fails without a Voyage key", async () => {
    vi.stubEnv("VOYAGE_API_KEY", "");
    await expect(embedQuery("no key")).rejects.toThrow(/VOYAGE_API_KEY/);
  });
});

describe("request pacing (VOYAGE_MAX_RPM / VOYAGE_MAX_TPM)", () => {
  it("holds the fourth request of a minute until the window frees", async () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv("VOYAGE_MAX_RPM", "3");
      mockFetch.mockImplementation(contextualizedEcho());
      const queries = ["a", "b", "c", "d"].map((q) => embedQuery(q));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(mockFetch).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockFetch).toHaveBeenCalledTimes(4);
      await expect(Promise.all(queries)).resolves.toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps each model's window separate", async () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv("VOYAGE_MAX_RPM", "1");
      mockFetch.mockImplementation(async (url: string, init: RequestInit) =>
        url.endsWith("/multimodalembeddings")
          ? multimodalEcho()(url, init)
          : contextualizedEcho()(url, init)
      );
      const both = Promise.all([embedQuery("text"), embedQuery("photo", { kind: "image" })]);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      await both;
    } finally {
      vi.useRealTimers();
    }
  });

  it("packs chunk requests under the token limit and waits on the tokens actually used", async () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv("VOYAGE_MAX_TPM", "1000");
      let calls = 0;
      mockFetch.mockImplementation(async (url: string, init: RequestInit) => {
        calls += 1;
        const response = await contextualizedEcho()(url, init);
        const body = await response.json();
        return jsonResponse({ ...body, usage: { total_tokens: 800 } });
      });
      // Two articles of ~600 estimated tokens: too big to share one request.
      const documents = [
        { header: "H1", chunks: ["x".repeat(1_800)] },
        { header: "H2", chunks: ["y".repeat(1_800)] },
      ];
      const done = embedArticleChunks(documents);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(calls).toBe(1); // 800 used of a 900 budget: the second waits
      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls).toBe(2);
      await expect(done).resolves.toHaveLength(2);
      for (const call of fetchCalls()) {
        expect((call.body.inputs as string[][]).length).toBe(1);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("never waits when the limits are unset", async () => {
    mockFetch.mockImplementation(contextualizedEcho());
    await Promise.all(Array.from({ length: 10 }, (_, i) => embedQuery(`q${i}`)));
    expect(mockFetch).toHaveBeenCalledTimes(10);
  });
});
