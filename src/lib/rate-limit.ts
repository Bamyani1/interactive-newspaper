/**
 * Sliding-window rate limiter (in-memory).
 *
 * Edge Runtime compatible — no Node.js-specific APIs.
 * Known limitation: Map resets on serverless cold starts and is per-instance.
 * Acceptable for this low-traffic archive. Upgrade path: Upstash Redis.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimiterOptions {
  /** Maximum requests allowed within the window. */
  limit: number;
  /** Window duration in milliseconds. */
  windowMs: number;
}

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export function createRateLimiter({ limit, windowMs }: RateLimiterOptions) {
  const map = new Map<string, RateLimitEntry>();
  let checkCount = 0;

  function cleanup(now: number) {
    for (const [key, entry] of map) {
      if (now >= entry.resetAt) {
        map.delete(key);
      }
    }
  }

  return function check(ip: string): RateLimitResult {
    const now = Date.now();

    // Lazy cleanup every 100 checks
    checkCount++;
    if (checkCount >= 100) {
      checkCount = 0;
      cleanup(now);
    }

    const entry = map.get(ip);

    if (!entry || now >= entry.resetAt) {
      map.set(ip, { count: 1, resetAt: now + windowMs });
      return { allowed: true, limit, remaining: limit - 1, resetAt: now + windowMs };
    }

    entry.count++;

    if (entry.count > limit) {
      return { allowed: false, limit, remaining: 0, resetAt: entry.resetAt };
    }

    return { allowed: true, limit, remaining: limit - entry.count, resetAt: entry.resetAt };
  };
}

/** Extract client IP from request headers, falling back to 127.0.0.1. */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // x-forwarded-for can contain multiple IPs: "client, proxy1, proxy2"
    return forwarded.split(",")[0].trim();
  }
  return "127.0.0.1";
}
