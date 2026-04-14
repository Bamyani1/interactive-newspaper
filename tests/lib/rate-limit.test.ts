/**
 * Tests for the rate limiter factory.
 *
 * Two suites:
 * 1. In-memory fallback path — env vars absent, the factory returns
 *    an async wrapper around today's legacy Map-based limiter. These
 *    tests use real process.env state (UPSTASH vars unset in test
 *    env) so the KV path is never constructed.
 * 2. KV path — mocks `@upstash/ratelimit` via vi.hoisted so we can
 *    inject synthetic responses and exercise the SDK → RateLimitResult
 *    mapping plus the fail-fallback-on-throw behavior.
 *
 * The two suites live in one file because the factory must re-read
 * env at construction time, so each `describe` block sets its own
 * env + calls `_resetKvForTests()` in beforeEach.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mocks used by the KV-path suite ──
const { mockLimit } = vi.hoisted(() => ({
    mockLimit: vi.fn() as ReturnType<typeof vi.fn>,
}));

vi.mock("@upstash/ratelimit", () => ({
    Ratelimit: Object.assign(
        vi.fn(() => ({ limit: mockLimit })),
        {
            slidingWindow: vi.fn((limit: number, window: string) => ({
                _kind: "slidingWindow",
                limit,
                window,
            })),
        },
    ),
}));

afterEach(() => {
    vi.restoreAllMocks();
});

describe("createRateLimiter — in-memory fallback", () => {
    // This suite assumes env vars are absent. Tests run with `vitest run`
    // from a shell without UPSTASH_* set, so `isKvAvailable()` is false
    // and the factory returns the legacy async-wrapped Map limiter.
    beforeEach(async () => {
        delete process.env.UPSTASH_REDIS_REST_URL;
        delete process.env.UPSTASH_REDIS_REST_TOKEN;
        const { _resetKvForTests } = await import("../../src/lib/kv-client");
        _resetKvForTests();
    });

    it("allows requests within the limit", async () => {
        const { createRateLimiter } = await import("../../src/lib/rate-limit");
        const check = createRateLimiter({ limit: 3, windowMs: 60_000 });
        const r1 = await check("1.2.3.4");
        const r2 = await check("1.2.3.4");
        const r3 = await check("1.2.3.4");

        expect(r1.allowed).toBe(true);
        expect(r2.allowed).toBe(true);
        expect(r3.allowed).toBe(true);
    });

    it("blocks requests exceeding the limit", async () => {
        const { createRateLimiter } = await import("../../src/lib/rate-limit");
        const check = createRateLimiter({ limit: 2, windowMs: 60_000 });
        await check("1.2.3.4");
        await check("1.2.3.4");
        const r3 = await check("1.2.3.4");

        expect(r3.allowed).toBe(false);
        expect(r3.remaining).toBe(0);
    });

    it("tracks IPs independently", async () => {
        const { createRateLimiter } = await import("../../src/lib/rate-limit");
        const check = createRateLimiter({ limit: 1, windowMs: 60_000 });
        await check("1.1.1.1");
        const blocked = await check("1.1.1.1");
        const other = await check("2.2.2.2");

        expect(blocked.allowed).toBe(false);
        expect(other.allowed).toBe(true);
    });

    it("returns correct remaining count", async () => {
        const { createRateLimiter } = await import("../../src/lib/rate-limit");
        const check = createRateLimiter({ limit: 5, windowMs: 60_000 });
        const r1 = await check("1.2.3.4");
        const r2 = await check("1.2.3.4");

        expect(r1.remaining).toBe(4);
        expect(r2.remaining).toBe(3);
    });

    it("resets after window expires", async () => {
        const now = 1000000;
        vi.spyOn(Date, "now").mockReturnValue(now);

        const { createRateLimiter } = await import("../../src/lib/rate-limit");
        const check = createRateLimiter({ limit: 1, windowMs: 60_000 });
        await check("1.2.3.4");
        const blocked = await check("1.2.3.4");
        expect(blocked.allowed).toBe(false);

        // Advance past the window
        vi.spyOn(Date, "now").mockReturnValue(now + 60_001);
        const reset = await check("1.2.3.4");
        expect(reset.allowed).toBe(true);
        expect(reset.remaining).toBe(0); // limit 1, used 1
    });
});

describe("createRateLimiter — KV path", () => {
    // This suite sets UPSTASH env vars before importing, so the
    // factory goes down the Ratelimit SDK branch. We mock
    // @upstash/ratelimit to inject controlled responses.
    beforeEach(async () => {
        process.env.UPSTASH_REDIS_REST_URL = "https://fake-test.upstash.io";
        process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
        mockLimit.mockReset();
        const { _resetKvForTests } = await import("../../src/lib/kv-client");
        _resetKvForTests();
    });

    it("maps Upstash slidingWindow response to RateLimitResult", async () => {
        mockLimit.mockResolvedValueOnce({
            success: true,
            limit: 10,
            remaining: 9,
            reset: 1_700_000_000_000,
            pending: Promise.resolve(),
        });
        const { createRateLimiter } = await import("../../src/lib/rate-limit");
        const check = createRateLimiter({ limit: 10, windowMs: 60_000 });
        const r = await check("9.9.9.9");
        expect(r).toEqual({
            allowed: true,
            limit: 10,
            remaining: 9,
            resetAt: 1_700_000_000_000,
        });
        expect(mockLimit).toHaveBeenCalledWith("9.9.9.9");
    });

    it("maps a rejected request correctly (success=false)", async () => {
        mockLimit.mockResolvedValueOnce({
            success: false,
            limit: 5,
            remaining: 0,
            reset: 1_700_000_000_000,
            pending: Promise.resolve(),
        });
        const { createRateLimiter } = await import("../../src/lib/rate-limit");
        const check = createRateLimiter({ limit: 5, windowMs: 60_000 });
        const r = await check("9.9.9.9");
        expect(r.allowed).toBe(false);
        expect(r.remaining).toBe(0);
    });

    it("falls back to in-memory limiter when the SDK call throws", async () => {
        // First call rejects — should log warn and return an in-memory
        // result. Second call also rejects — in-memory is now warmed up
        // (one previous call) so this should behave like a fresh IP's
        // second in-memory call.
        mockLimit.mockRejectedValue(new Error("ECONNRESET"));
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        const { createRateLimiter } = await import("../../src/lib/rate-limit");
        const check = createRateLimiter({ limit: 2, windowMs: 60_000 });

        const r1 = await check("8.8.8.8");
        const r2 = await check("8.8.8.8");
        const r3 = await check("8.8.8.8");

        expect(r1.allowed).toBe(true);
        expect(r2.allowed).toBe(true);
        // 3rd call (in-memory fallback) should be blocked by the
        // legacy Map limiter with limit: 2.
        expect(r3.allowed).toBe(false);
        // Warn logged for each of the 3 failed SDK calls.
        expect(warnSpy).toHaveBeenCalledTimes(3);
        const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
        expect(logged.stage).toBe("kv-fallback");
        expect(logged.op).toBe("ratelimit.limit");
    });
});

describe("getClientIp", () => {
    it("extracts first IP from x-forwarded-for", async () => {
        const { getClientIp } = await import("../../src/lib/rate-limit");
        const request = new Request("http://localhost", {
            headers: { "x-forwarded-for": "203.0.113.50, 70.41.3.18, 150.172.238.178" },
        });
        expect(getClientIp(request)).toBe("203.0.113.50");
    });

    it("returns single IP from x-forwarded-for", async () => {
        const { getClientIp } = await import("../../src/lib/rate-limit");
        const request = new Request("http://localhost", {
            headers: { "x-forwarded-for": "203.0.113.50" },
        });
        expect(getClientIp(request)).toBe("203.0.113.50");
    });

    it("falls back to 127.0.0.1 when no forwarded header", async () => {
        const { getClientIp } = await import("../../src/lib/rate-limit");
        const request = new Request("http://localhost");
        expect(getClientIp(request)).toBe("127.0.0.1");
    });
});
