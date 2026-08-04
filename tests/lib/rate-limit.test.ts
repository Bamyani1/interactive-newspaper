import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { createRateLimiter, getClientIp } from "../../src/lib/rate-limit";

// Force the in-memory fallback path by hiding any DATABASE_URL so the
// module's lazy getSql() returns null before a real Neon call is made.
// Other tests in this suite that explicitly want the DB path should
// restore the env var.
beforeAll(() => {
  delete process.env.DATABASE_URL;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createRateLimiter", () => {
  it("allows requests within the limit", async () => {
    const check = createRateLimiter({ bucket: "test-1", limit: 3, windowMs: 60_000 });
    const r1 = await check("1.2.3.4");
    const r2 = await check("1.2.3.4");
    const r3 = await check("1.2.3.4");

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(true);
  });

  it("blocks requests exceeding the limit", async () => {
    const check = createRateLimiter({ bucket: "test-2", limit: 2, windowMs: 60_000 });
    await check("1.2.3.4");
    await check("1.2.3.4");
    const r3 = await check("1.2.3.4");

    expect(r3.allowed).toBe(false);
    expect(r3.remaining).toBe(0);
  });

  it("tracks IPs independently", async () => {
    const check = createRateLimiter({ bucket: "test-3", limit: 1, windowMs: 60_000 });
    await check("1.1.1.1");
    const blocked = await check("1.1.1.1");
    const other = await check("2.2.2.2");

    expect(blocked.allowed).toBe(false);
    expect(other.allowed).toBe(true);
  });

  it("returns correct remaining count", async () => {
    const check = createRateLimiter({ bucket: "test-4", limit: 5, windowMs: 60_000 });
    const r1 = await check("1.2.3.4");
    const r2 = await check("1.2.3.4");

    expect(r1.remaining).toBe(4);
    expect(r2.remaining).toBe(3);
  });

  it("resets after window expires", async () => {
    const now = 1000000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    const check = createRateLimiter({ bucket: "test-5", limit: 1, windowMs: 60_000 });
    await check("1.2.3.4");
    const blocked = await check("1.2.3.4");
    expect(blocked.allowed).toBe(false);

    // Advance past the window
    vi.spyOn(Date, "now").mockReturnValue(now + 60_001);
    const reset = await check("1.2.3.4");
    expect(reset.allowed).toBe(true);
    expect(reset.remaining).toBe(0); // limit 1, used 1
  });

  it("separate bucket names do not share allowance", async () => {
    const askCheck = createRateLimiter({ bucket: "ask", limit: 1, windowMs: 60_000 });
    const feedbackCheck = createRateLimiter({ bucket: "feedback", limit: 1, windowMs: 60_000 });

    const askR = await askCheck("9.9.9.9");
    const feedbackR = await feedbackCheck("9.9.9.9");
    expect(askR.allowed).toBe(true);
    expect(feedbackR.allowed).toBe(true);

    const askR2 = await askCheck("9.9.9.9");
    expect(askR2.allowed).toBe(false);
    const feedbackR2 = await feedbackCheck("9.9.9.9");
    expect(feedbackR2.allowed).toBe(false);
  });
});

describe("getClientIp", () => {
  it("prefers x-vercel-forwarded-for over a spoofable x-forwarded-for", () => {
    const request = new Request("http://localhost", {
      headers: {
        "x-forwarded-for": "1.2.3.4",
        "x-vercel-forwarded-for": "203.0.113.50",
      },
    });
    expect(getClientIp(request)).toBe("203.0.113.50");
  });

  it("falls back to x-real-ip when Vercel's header is absent", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "1.2.3.4", "x-real-ip": "203.0.113.50" },
    });
    expect(getClientIp(request)).toBe("203.0.113.50");
  });

  it("takes the right-most x-forwarded-for hop, not the client-supplied left-most", () => {
    // Only the hop nearest this server is trustworthy; everything to its
    // left is whatever the caller chose to send. Keying limiters on the
    // left-most entry let anyone mint a fresh bucket per request.
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.50, 70.41.3.18, 150.172.238.178" },
    });
    expect(getClientIp(request)).toBe("150.172.238.178");
  });

  it("returns single IP from x-forwarded-for", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.50" },
    });
    expect(getClientIp(request)).toBe("203.0.113.50");
  });

  it("falls back to 127.0.0.1 when no forwarded header", () => {
    const request = new Request("http://localhost");
    expect(getClientIp(request)).toBe("127.0.0.1");
  });
});
