import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

function makeRequest(url: string) {
  return new NextRequest(url);
}

describe("/api/editions – input bounds", () => {
  const mockQueryEditions = vi.fn().mockResolvedValue({
    editions: [],
    pagination: { total: 0, limit: 100, offset: 0 },
  });

  beforeEach(() => {
    vi.doMock("@/src/lib/db", () => ({
      queryEditions: mockQueryEditions,
    }));
  });

  it("clamps limit to 500", async () => {
    const route = await import("../../src/app/api/editions/route");
    await route.GET(makeRequest("http://localhost/api/editions?limit=9999"));

    expect(mockQueryEditions).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 500 }),
    );
  });

  it("clamps negative offset to 0", async () => {
    const route = await import("../../src/app/api/editions/route");
    await route.GET(makeRequest("http://localhost/api/editions?offset=-50"));

    expect(mockQueryEditions).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0 }),
    );
  });

  it("handles NaN limit gracefully (falls back to 500)", async () => {
    const route = await import("../../src/app/api/editions/route");
    await route.GET(makeRequest("http://localhost/api/editions?limit=abc"));

    expect(mockQueryEditions).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 500 }),
    );
  });

  it("handles NaN offset gracefully (falls back to 0)", async () => {
    const route = await import("../../src/app/api/editions/route");
    await route.GET(makeRequest("http://localhost/api/editions?offset=xyz"));

    expect(mockQueryEditions).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0 }),
    );
  });

  it("uses defaults when no params provided", async () => {
    const route = await import("../../src/app/api/editions/route");
    await route.GET(makeRequest("http://localhost/api/editions"));

    expect(mockQueryEditions).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 500, offset: 0 }),
    );
  });
});
