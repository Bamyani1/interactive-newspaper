/**
 * Sliding-window rate limiter.
 *
 * Primary store is a Neon `api_rate_bucket` table so multi-instance
 * Vercel deployments share allowance; in-memory map is a fallback when
 * the DB is unreachable or DATABASE_URL is unset (local dev, tests).
 *
 * Public API is now async. Every existing caller awaits the result.
 */

import { neon } from "@neondatabase/serverless";

interface RateLimitEntry {
    count: number;
    resetAt: number;
}

interface RateLimiterOptions {
    /** Distinguishes buckets (e.g. "ask", "feedback"). Part of the DB key. */
    bucket: string;
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

// Module-level Neon client; lazy-initialized once DATABASE_URL is known.
let _sql: ReturnType<typeof neon> | null = null;
function getSql(): ReturnType<typeof neon> | null {
    if (_sql !== null) return _sql;
    const url = process.env.DATABASE_URL;
    if (!url) return null;
    _sql = neon(url);
    return _sql;
}

function checkInMemory(
    fallback: Map<string, RateLimitEntry>,
    options: RateLimiterOptions,
    ip: string,
): RateLimitResult {
    const now = Date.now();
    const key = `${options.bucket}:${ip}`;
    const entry = fallback.get(key);
    if (!entry || now >= entry.resetAt) {
        fallback.set(key, { count: 1, resetAt: now + options.windowMs });
        return {
            allowed: true,
            limit: options.limit,
            remaining: options.limit - 1,
            resetAt: now + options.windowMs,
        };
    }
    entry.count++;
    if (entry.count > options.limit) {
        return {
            allowed: false,
            limit: options.limit,
            remaining: 0,
            resetAt: entry.resetAt,
        };
    }
    return {
        allowed: true,
        limit: options.limit,
        remaining: options.limit - entry.count,
        resetAt: entry.resetAt,
    };
}

// Module-level fallback store used by createRateLimiter factories when
// no per-instance map is wanted. Callers that want full isolation pass
// their own. Exposed via _clearRateLimitFallbackForTests for test hygiene.
const sharedFallback = new Map<string, RateLimitEntry>();

async function checkNeon(
    sql: ReturnType<typeof neon>,
    options: RateLimiterOptions,
    ip: string,
): Promise<RateLimitResult> {
    const now = Date.now();
    const windowEndIso = new Date(now + options.windowMs).toISOString();
    const key = `${options.bucket}:${ip}`;
    // Atomic upsert + increment. If the existing window has expired we
    // reset the counter to 1 and push expires_at forward; otherwise we
    // increment. RETURNING gives us the post-update count + expiry.
    const rows = (await sql`
        INSERT INTO api_rate_bucket (key, count, expires_at)
        VALUES (${key}, 1, ${windowEndIso})
        ON CONFLICT (key) DO UPDATE
          SET
            count = CASE WHEN api_rate_bucket.expires_at < NOW() THEN 1 ELSE api_rate_bucket.count + 1 END,
            expires_at = CASE WHEN api_rate_bucket.expires_at < NOW() THEN ${windowEndIso} ELSE api_rate_bucket.expires_at END
        RETURNING count, expires_at
    `) as Array<{ count: number; expires_at: string | Date }>;
    const count = Number(rows[0]?.count ?? 1);
    const resetAt =
        rows[0]?.expires_at instanceof Date
            ? rows[0].expires_at.getTime()
            : new Date(String(rows[0]?.expires_at)).getTime();
    return {
        allowed: count <= options.limit,
        limit: options.limit,
        remaining: Math.max(0, options.limit - count),
        resetAt,
    };
}

export function createRateLimiter(options: RateLimiterOptions) {
    // Each factory instance gets its own fallback Map so concurrent
    // limiters in tests (or the same module loaded twice) don't collide.
    const fallback = new Map<string, RateLimitEntry>();
    return async function check(ip: string): Promise<RateLimitResult> {
        const sql = getSql();
        if (sql) {
            try {
                return await checkNeon(sql, options, ip);
            } catch (err) {
                console.warn(
                    JSON.stringify({
                        level: "warn",
                        module: "rate-limit",
                        bucket: options.bucket,
                        msg: "neon check failed, falling back to in-memory",
                        err: err instanceof Error ? err.message : String(err),
                    }),
                );
            }
        }
        return checkInMemory(fallback, options, ip);
    };
}

/**
 * Extract client IP from request headers, falling back to 127.0.0.1.
 *
 * `x-forwarded-for` is a client-supplied header: its left-most entry is
 * whatever the caller typed, so keying limiters on it let anyone mint a
 * fresh bucket per request by varying the header. Vercel sets
 * `x-vercel-forwarded-for` and `x-real-ip` from the connection itself, so
 * those are preferred; XFF is only consulted when neither is present, and
 * then the right-most entry is used — the hop nearest this server, and the
 * last one an untrusted client cannot forge.
 */
export function getClientIp(request: Request): string {
    const trusted =
        request.headers.get("x-vercel-forwarded-for") ??
        request.headers.get("x-real-ip");
    if (trusted?.trim()) return trusted.trim();

    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
        const hops = forwarded
            .split(",")
            .map((hop) => hop.trim())
            .filter(Boolean);
        if (hops.length > 0) return hops[hops.length - 1];
    }
    return "127.0.0.1";
}

/** Test helper — clears the shared fallback so tests don't leak. */
export function _clearRateLimitFallbackForTests(): void {
    sharedFallback.clear();
}
