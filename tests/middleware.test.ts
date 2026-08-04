/** @vitest-environment node */
/**
 * Middleware CSP + rate-limit tests.
 *
 * The security-critical guarantee is that script-src is nonce-based and no
 * longer carries 'unsafe-inline'. These tests lock that in, plus the per-request
 * nonce freshness and the preserved rate-limiting behavior.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRateLimit } = vi.hoisted(() => ({ mockRateLimit: vi.fn() }));

vi.mock("@/src/lib/rate-limit", () => ({
    createRateLimiter: () => mockRateLimit,
    getClientIp: () => "203.0.113.7",
}));

import { NextRequest } from "next/server";
import { middleware, config } from "../middleware";

function req(path: string): NextRequest {
    return new NextRequest(`http://localhost${path}`);
}

function scriptSrc(csp: string): string {
    return (csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src")) ?? "");
}

describe("middleware CSP", () => {
    beforeEach(() => {
        mockRateLimit.mockResolvedValue({
            allowed: true,
            limit: 120,
            remaining: 119,
            resetAt: Date.now() + 60_000,
        });
    });

    it("sets a nonce-based script-src with no 'unsafe-inline'", async () => {
        const res = await middleware(req("/"));
        const csp = res.headers.get("content-security-policy") ?? "";
        const src = scriptSrc(csp);
        expect(src).toMatch(/'nonce-[A-Za-z0-9+/=_-]+'/);
        expect(src).toContain("'strict-dynamic'");
        expect(src).not.toContain("'unsafe-inline'");
    });

    it("keeps 'unsafe-inline' for style-src (out of scope)", async () => {
        const res = await middleware(req("/about"));
        const csp = res.headers.get("content-security-policy") ?? "";
        expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    });

    it("issues a fresh nonce per request", async () => {
        const a = (await middleware(req("/"))).headers.get("content-security-policy") ?? "";
        const b = (await middleware(req("/"))).headers.get("content-security-policy") ?? "";
        const nonceA = a.match(/'nonce-([^']+)'/)?.[1];
        const nonceB = b.match(/'nonce-([^']+)'/)?.[1];
        expect(nonceA).toBeTruthy();
        expect(nonceB).toBeTruthy();
        expect(nonceA).not.toBe(nonceB);
    });
});

describe("middleware rate limiting", () => {
    beforeEach(() => {
        mockRateLimit.mockResolvedValue({
            allowed: true,
            limit: 10,
            remaining: 9,
            resetAt: Date.now() + 60_000,
        });
    });

    it("returns 429 when the limiter denies an /api/ask request", async () => {
        mockRateLimit.mockResolvedValueOnce({
            allowed: false,
            limit: 10,
            remaining: 0,
            resetAt: Date.now() + 60_000,
        });
        const res = await middleware(req("/api/ask"));
        expect(res.status).toBe(429);
        expect(res.headers.get("content-security-policy")).toContain("script-src");
    });

    it("allows an /api/search request under the limit and still sets CSP", async () => {
        const res = await middleware(req("/api/search?q=hi"));
        expect(res.status).toBe(200);
        expect(res.headers.get("x-ratelimit-remaining")).toBe("9");
        expect(res.headers.get("content-security-policy")).toContain("'strict-dynamic'");
    });

    it("does not rate-limit page routes", async () => {
        mockRateLimit.mockClear();
        await middleware(req("/about"));
        expect(mockRateLimit).not.toHaveBeenCalled();
    });
});

describe("middleware matcher", () => {
    it("excludes Next static assets and static files", () => {
        const m = config.matcher[0];
        expect(m).toContain("_next/static");
        expect(m).toContain("_next/image");
        expect(m).toContain("favicon.ico");
    });
});
