import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAskArchive } from "@/features/ask-archive";
import type { AskResponse } from "@/src/types";

const mockResponse: AskResponse = {
  question: "What happened?",
  answer: "Things happened [Source 1].",
  citations: [{ articleId: "1960-01-07-0", headline: "Test", editionDate: "1960-01-07" }],
  confidence: "high",
  sourceArticles: [
    {
      id: "1960-01-07-0",
      headline: "Test",
      editionDate: "1960-01-07",
      category: "News",
      summary: "Summary",
      byline: null,
      bodySnippet: "Body...",
      distance: 0.25,
    },
  ],
  meta: {
    retrievalTimeMs: 100,
    generationTimeMs: 500,
    totalTimeMs: 600,
    articlesSearched: 8,
    method: "hybrid",
  },
};

// Helper: build a fake Response-like object that the hook's streaming
// code path can consume. The hook checks res.headers.get("content-type")
// and either takes the SSE branch or falls back to res.json(). Returning
// a JSON content-type forces the fallback path, which is what these
// legacy unit tests exercise — the SSE path is tested in the ask-route
// integration suite.
function makeJsonResponse(body: unknown, overrides: Partial<{ ok: boolean; status: number }> = {}) {
  return {
    ok: overrides.ok ?? true,
    status: overrides.status ?? 200,
    headers: {
      get: (key: string) =>
        key.toLowerCase() === "content-type" ? "application/json" : null,
    },
    body: null,
    json: () => Promise.resolve(body),
  };
}

describe("useAskArchive", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeJsonResponse(mockResponse)));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls /api/ask?stream=1 with the question on submit", async () => {
    const { result } = renderHook(() => useAskArchive());

    act(() => {
      result.current.submit("What happened?");
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/ask?stream=1",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    );
    // Body now also carries a localStorage-backed sessionId; assert
    // the question field is present rather than pinning the exact shape.
    const body = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    );
    expect(body.question).toBe("What happened?");
  });

  it("sets isLoading to true during fetch", async () => {
    // Use a never-resolving fetch to keep loading state
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(new Promise(() => {}))
    );

    const { result } = renderHook(() => useAskArchive());

    act(() => {
      result.current.submit("What happened?");
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.answer).toBeNull();
  });

  it("sets answer on successful response", async () => {
    const { result } = renderHook(() => useAskArchive());

    act(() => {
      result.current.submit("What happened?");
    });

    await waitFor(() => {
      expect(result.current.answer).not.toBeNull();
    });

    expect(result.current.answer!.question).toBe("What happened?");
    expect(result.current.answer!.answer).toBe("Things happened [Source 1].");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("sets error on failed response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        makeJsonResponse({ error: "Server error" }, { ok: false, status: 500 }),
      ),
    );

    const { result } = renderHook(() => useAskArchive());

    act(() => {
      result.current.submit("What happened?");
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.error).toBe("Server error");
    expect(result.current.answer).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("falls back to status-based error when json parsing fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        headers: { get: () => null },
        body: null,
        json: () => Promise.reject(new Error("parse error")),
      })
    );

    const { result } = renderHook(() => useAskArchive());

    act(() => {
      result.current.submit("What happened?");
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.error).toBe("Request failed: 502");
  });

  it("does not submit empty or whitespace-only input", () => {
    const { result } = renderHook(() => useAskArchive());

    act(() => {
      result.current.submit("   ");
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });

  it("trims the question before sending", async () => {
    const { result } = renderHook(() => useAskArchive());

    act(() => {
      result.current.submit("  What happened?  ");
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const body2 = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    );
    expect(body2.question).toBe("What happened?");
  });

  it("resets all state on reset()", async () => {
    const { result } = renderHook(() => useAskArchive());

    act(() => {
      result.current.submit("What happened?");
    });

    await waitFor(() => {
      expect(result.current.answer).not.toBeNull();
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.answer).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("aborts previous request when submitting a new one", async () => {
    let resolveFirst: (value: unknown) => void;
    const firstFetch = new Promise((resolve) => {
      resolveFirst = resolve;
    });

    const fetchFn = vi
      .fn()
      .mockReturnValueOnce(firstFetch)
      .mockResolvedValueOnce(
        makeJsonResponse({ ...mockResponse, question: "Second?" }),
      );

    vi.stubGlobal("fetch", fetchFn);

    const { result } = renderHook(() => useAskArchive());

    // Submit first question
    act(() => {
      result.current.submit("First?");
    });

    expect(result.current.isLoading).toBe(true);

    // Submit second question (should abort the first)
    act(() => {
      result.current.submit("Second?");
    });

    // The first fetch's signal should be aborted
    const firstCallSignal = fetchFn.mock.calls[0][1].signal as AbortSignal;
    expect(firstCallSignal.aborted).toBe(true);

    // Resolve first (should be ignored due to abort)
    resolveFirst!(makeJsonResponse(mockResponse));

    await waitFor(() => {
      expect(result.current.answer).not.toBeNull();
    });

    expect(result.current.answer!.question).toBe("Second?");
  });
});
