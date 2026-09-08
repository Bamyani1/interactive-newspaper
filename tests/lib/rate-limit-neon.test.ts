/** @vitest-environment node */
/**
 * The Neon-backed limiter path. Kept in its own file because the module
 * caches its client on first use, so a suite that wants the DB path cannot
 * share state with the one that hides DATABASE_URL to force the in-memory
 * fallback (tests/lib/rate-limit.test.ts).
 *
 * The limiter is the very first await on every /api/* request. Neon's
 * serverless driver has no AbortSignal support, so a hung upsert would
 * stall every request behind it — hence the timer and the fallback.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));

vi.mock("@neondatabase/serverless", () => ({
  neon: () => sqlMock,
}));

process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://fake/test";

import { createRateLimiter } from "@/src/lib/rate-limit";

describe("createRateLimiter with Neon reachable", () => {
  beforeEach(() => {
    sqlMock.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the durable count returned by the upsert", async () => {
    const resetAt = new Date(Date.now() + 45_000);
    sqlMock.mockResolvedValueOnce([{ count: 3, expires_at: resetAt.toISOString() }]);
    const check = createRateLimiter({ bucket: "neon-1", limit: 10, windowMs: 60_000 });

    const result = await check("9.9.9.9");

    expect(result).toEqual({
      allowed: true,
      limit: 10,
      remaining: 7,
      resetAt: resetAt.getTime(),
    });
  });

  it("denies once the durable count passes the limit", async () => {
    sqlMock.mockResolvedValueOnce([
      { count: 11, expires_at: new Date(Date.now() + 10_000).toISOString() },
    ]);
    const check = createRateLimiter({ bucket: "neon-2", limit: 10, windowMs: 60_000 });

    await expect(check("9.9.9.9")).resolves.toMatchObject({ allowed: false, remaining: 0 });
  });

  it("falls back to the in-memory limiter when the upsert rejects", async () => {
    sqlMock.mockRejectedValueOnce(new Error("neon unreachable"));
    const check = createRateLimiter({ bucket: "neon-3", limit: 4, windowMs: 60_000 });

    await expect(check("9.9.9.9")).resolves.toMatchObject({ allowed: true, remaining: 3 });
  });

  it("falls back to the in-memory limiter when the upsert hangs past its budget", async () => {
    vi.useFakeTimers();
    try {
      sqlMock.mockImplementationOnce(() => new Promise(() => {}));
      const check = createRateLimiter({ bucket: "neon-4", limit: 4, windowMs: 60_000 });

      const pending = check("9.9.9.9");
      await vi.advanceTimersByTimeAsync(1_500);

      await expect(pending).resolves.toMatchObject({ allowed: true, remaining: 3 });
    } finally {
      vi.useRealTimers();
    }
  });
});
