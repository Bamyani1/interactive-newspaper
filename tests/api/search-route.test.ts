import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/src/lib/db", () => ({
  searchArticles: vi.fn(),
}));

import { GET } from "@/src/app/api/search/route";
import { searchArticles } from "@/src/lib/db";

function makeRequest(qs: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/search?${qs}`);
}

describe("GET /api/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (searchArticles as ReturnType<typeof vi.fn>).mockResolvedValue({
      results: [
        {
          id: "1960-01-13-0",
          editionDate: "1960-01-13",
          category: "News",
          headline: "Test",
          summary: "Summary",
          byline: null,
          snippet: "snippet",
          rank: 0.5,
        },
      ],
      total: 1,
    });
  });

  it("returns 400 when q is missing", async () => {
    const response = await GET(makeRequest(""));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/missing/i);
    expect(body.requestId).toBeDefined();
  });

  it("returns 400 when q is empty after trim", async () => {
    const response = await GET(makeRequest("q=%20%20%20"));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/missing/i);
  });

  it("returns 400 when q exceeds 200 characters", async () => {
    const longQ = "a".repeat(201);
    const response = await GET(makeRequest(`q=${longQ}`));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/too long/i);
    expect(body.error).toContain("201");
    expect(body.requestId).toBeDefined();
  });

  it("accepts q at exactly 200 characters", async () => {
    const okQ = "a".repeat(200);
    const response = await GET(makeRequest(`q=${okQ}`));
    expect(response.status).toBe(200);
  });

  it("returns 200 with structured results on success", async () => {
    const response = await GET(makeRequest("q=Kennedy"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.query).toBe("Kennedy");
    expect(body.results).toHaveLength(1);
    expect(body.pagination).toEqual({
      total: 1,
      limit: 20,
      offset: 0,
      hasMore: false,
    });
  });

  it("returns 504 with cause='timeout' when DB call hangs", async () => {
    (searchArticles as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}),
    );

    vi.useFakeTimers();
    try {
      // Pre-attach a catch so vitest doesn't see an unhandled rejection
      // window between the timer firing and the await landing.
      let captured: Response | undefined;
      const settled = GET(makeRequest("q=hangs")).then((r) => {
        captured = r;
      });
      await vi.advanceTimersByTimeAsync(8_100);
      await settled;
      expect(captured).toBeDefined();
      const response = captured!;
      const body = await response.json();
      expect(response.status).toBe(504);
      expect(body.cause).toBe("timeout");
      expect(body.requestId).toBeDefined();
      expect(body.error).toMatch(/took too long/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns 500 with cause='internal_error' on generic DB failure", async () => {
    (searchArticles as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Neon connection refused"),
    );

    const response = await GET(makeRequest("q=test"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.cause).toBe("internal_error");
    expect(body.requestId).toBeDefined();
    expect(body.error).toMatch(/search failed/i);
  });

  it("respects limit and offset query params", async () => {
    await GET(makeRequest("q=test&limit=5&offset=10"));
    expect(searchArticles).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5, offset: 10 }),
    );
  });

  it("caps limit at 100", async () => {
    await GET(makeRequest("q=test&limit=999"));
    expect(searchArticles).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100 }),
    );
  });

  it("forwards filters to searchArticles", async () => {
    await GET(makeRequest("q=test&category=News&start_date=1960-01-01&end_date=1969-12-31"));
    expect(searchArticles).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "test",
        category: "News",
        startDate: "1960-01-01",
        endDate: "1969-12-31",
      }),
    );
  });
});
