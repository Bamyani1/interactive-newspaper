/** @vitest-environment node */
/**
 * Unit tests for /api/internal/retention (GET + POST).
 *
 * The retention module and the Neon executor factory are mocked so no
 * driver code runs; the tests exercise only the route's auth gating,
 * env guards, and response shapes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRateLimit, mockRunRetentionSweep, mockCreateNeonExecutor } = vi.hoisted(() => ({
    mockRateLimit: vi.fn(),
    mockRunRetentionSweep: vi.fn(),
    mockCreateNeonExecutor: vi.fn(() => ({
        query: vi.fn(),
        transactionBatch: vi.fn(),
    })),
}));

// The route builds its limiter from createRateLimiter at module load, so the
// mock returns our controllable fn as that limiter. getClientIp is stubbed to a
// fixed IP. The limiter's own counting is covered by tests/lib/rate-limit.test.ts;
// here we only assert the route wires it in (429 before auth).
vi.mock("@/src/lib/rate-limit", () => ({
    createRateLimiter: () => mockRateLimit,
    getClientIp: () => "127.0.0.1",
}));

vi.mock("@/src/lib/retention", () => ({
    runRetentionSweep: mockRunRetentionSweep,
}));

// The route imports this by relative path; Vitest matches mocks by
// resolved module id, so mocking the same file here intercepts it.
vi.mock("../../scripts/db/lib/neon-executor", () => ({
    createNeonExecutor: mockCreateNeonExecutor,
}));

import * as route from "@/src/app/api/internal/retention/route";

const SECRET = "test-cron-secret";
const COUNTS = { sessionTurns: 2, feedback: 1, rateBuckets: 3 };

function makeRequest(method: "GET" | "POST", authorization?: string): Request {
    const headers = new Headers();
    if (authorization !== undefined) headers.set("authorization", authorization);
    return new Request("http://localhost/api/internal/retention", {
        method,
        headers,
    });
}

type RouteRequest = Parameters<typeof route.POST>[0];

describe("/api/internal/retention", () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
        vi.clearAllMocks();
        mockRateLimit.mockResolvedValue({
            allowed: true,
            limit: 5,
            remaining: 4,
            resetAt: Date.now() + 60_000,
        });
        mockRunRetentionSweep.mockResolvedValue(COUNTS);
        vi.stubEnv("CRON_SECRET", SECRET);
        // Fake DSN — createNeonExecutor is mocked, no driver is constructed.
        vi.stubEnv("DATABASE_URL", "postgres://mocked/never-connects");
    });

    it("exports exactly GET and POST", () => {
        expect(Object.keys(route).sort()).toEqual(["GET", "POST"]);
    });

    it("returns 429 before auth when the per-IP rate limit is exceeded", async () => {
        mockRateLimit.mockResolvedValueOnce({
            allowed: false,
            limit: 5,
            remaining: 0,
            resetAt: Date.now() + 60_000,
        });
        const response = await route.POST(
            makeRequest("POST", `Bearer ${SECRET}`) as unknown as RouteRequest,
        );
        expect(response.status).toBe(429);
        const body = await response.json();
        expect(body.error).toMatch(/Too many requests/);
        expect(response.headers.get("Retry-After")).toBeTruthy();
        // The limiter runs before the token check, so the sweep never fires
        // even though a valid bearer was supplied.
        expect(mockRunRetentionSweep).not.toHaveBeenCalled();
    });

    it("returns 401 when CRON_SECRET is unset, even with a bearer header", async () => {
        vi.stubEnv("CRON_SECRET", undefined);
        const response = await route.POST(
            makeRequest("POST", `Bearer ${SECRET}`) as unknown as RouteRequest,
        );
        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
        expect(mockRunRetentionSweep).not.toHaveBeenCalled();
    });

    it("returns 401 when the Authorization header is missing", async () => {
        const response = await route.POST(
            makeRequest("POST") as unknown as RouteRequest,
        );
        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
        expect(mockRunRetentionSweep).not.toHaveBeenCalled();
    });

    it("returns 401 on a wrong bearer token", async () => {
        const response = await route.POST(
            makeRequest("POST", "Bearer wrong-secret") as unknown as RouteRequest,
        );
        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
        expect(mockRunRetentionSweep).not.toHaveBeenCalled();
    });

    it("returns 200 with the sweep counts on POST with the correct bearer", async () => {
        const response = await route.POST(
            makeRequest("POST", `Bearer ${SECRET}`) as unknown as RouteRequest,
        );
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual(COUNTS);
        expect(mockCreateNeonExecutor).toHaveBeenCalledWith(
            "postgres://mocked/never-connects",
        );
        expect(mockRunRetentionSweep).toHaveBeenCalledTimes(1);
    });

    it("returns 200 with the sweep counts on GET with the correct bearer (Vercel cron)", async () => {
        const response = await route.GET(
            makeRequest("GET", `Bearer ${SECRET}`) as unknown as RouteRequest,
        );
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual(COUNTS);
        expect(mockRunRetentionSweep).toHaveBeenCalledTimes(1);
    });

    it("returns 503 when DATABASE_URL is not configured", async () => {
        vi.stubEnv("DATABASE_URL", undefined);
        const response = await route.POST(
            makeRequest("POST", `Bearer ${SECRET}`) as unknown as RouteRequest,
        );
        expect(response.status).toBe(503);
        const body = await response.json();
        expect(body.error).toMatch(/DATABASE_URL/);
        expect(mockRunRetentionSweep).not.toHaveBeenCalled();
    });

    it("returns 500 when the sweep itself fails", async () => {
        mockRunRetentionSweep.mockRejectedValueOnce(new Error("connection refused"));
        const response = await route.POST(
            makeRequest("POST", `Bearer ${SECRET}`) as unknown as RouteRequest,
        );
        expect(response.status).toBe(500);
        const body = await response.json();
        expect(body.error).toMatch(/Retention sweep failed/);
    });
});
