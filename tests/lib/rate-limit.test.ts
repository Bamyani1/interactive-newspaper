import { describe, it, expect, vi, afterEach } from "vitest";
import { createRateLimiter, getClientIp } from "../../src/lib/rate-limit";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createRateLimiter", () => {
  it("allows requests within the limit", () => {
    const check = createRateLimiter({ limit: 3, windowMs: 60_000 });
    const r1 = check("1.2.3.4");
    const r2 = check("1.2.3.4");
    const r3 = check("1.2.3.4");

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(true);
  });

  it("blocks requests exceeding the limit", () => {
    const check = createRateLimiter({ limit: 2, windowMs: 60_000 });
    check("1.2.3.4");
    check("1.2.3.4");
    const r3 = check("1.2.3.4");

    expect(r3.allowed).toBe(false);
    expect(r3.remaining).toBe(0);
  });

  it("tracks IPs independently", () => {
    const check = createRateLimiter({ limit: 1, windowMs: 60_000 });
    check("1.1.1.1");
    const blocked = check("1.1.1.1");
    const other = check("2.2.2.2");

    expect(blocked.allowed).toBe(false);
    expect(other.allowed).toBe(true);
  });

  it("returns correct remaining count", () => {
    const check = createRateLimiter({ limit: 5, windowMs: 60_000 });
    const r1 = check("1.2.3.4");
    const r2 = check("1.2.3.4");

    expect(r1.remaining).toBe(4);
    expect(r2.remaining).toBe(3);
  });

  it("resets after window expires", () => {
    const now = 1000000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    const check = createRateLimiter({ limit: 1, windowMs: 60_000 });
    check("1.2.3.4");
    const blocked = check("1.2.3.4");
    expect(blocked.allowed).toBe(false);

    // Advance past the window
    vi.spyOn(Date, "now").mockReturnValue(now + 60_001);
    const reset = check("1.2.3.4");
    expect(reset.allowed).toBe(true);
    expect(reset.remaining).toBe(0); // limit 1, used 1
  });
});

describe("getClientIp", () => {
  it("extracts first IP from x-forwarded-for", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.50, 70.41.3.18, 150.172.238.178" },
    });
    expect(getClientIp(request)).toBe("203.0.113.50");
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
