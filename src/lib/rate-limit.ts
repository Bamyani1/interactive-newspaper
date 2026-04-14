/**
 * Sliding-window rate limiter.
 *
 * Primary path: Upstash Redis via `@upstash/ratelimit`. Shares state
 * across Vercel Fluid Compute instances so a "N per minute" limit
 * actually means N per minute, not N × instance_count.
 *
 * Fallback path: in-memory Map. Used when `UPSTASH_REDIS_REST_URL` /
 * `UPSTASH_REDIS_REST_TOKEN` are absent (local dev, tests) or when
 * an Upstash call throws at runtime. Per-instance only, so cross-
 * instance leakage relaxes the limit during an outage — an acceptable
 * availability-over-abuse-protection trade for this low-traffic
 * archive.
 *
 * The public `createRateLimiter` API returns an async check function
 * so the KV path can be awaited. Call sites use `await checker(ip)`.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { getRedisClient, isKvAvailable } from "./kv-client";

interface RateLimitEntry {
    count: number;
    resetAt: number;
}

interface RateLimiterOptions {
    /** Maximum requests allowed within the window. */
    limit: number;
    /** Window duration in milliseconds. */
    windowMs: number;
    /** Optional namespace prefix for KV keys. Defaults to "rl". */
    prefix?: string;
}

export interface RateLimitResult {
    allowed: boolean;
    limit: number;
    remaining: number;
    resetAt: number;
}

/**
 * In-memory sliding-window limiter — the legacy implementation, now
 * used only as a fallback when Upstash is unavailable. Kept byte-
 * identical in behavior to the pre-KV code so existing tests stay
 * green in test envs that have no env vars.
 */
function createInMemoryLimiter({ limit, windowMs }: RateLimiterOptions) {
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

        checkCount++;
        if (checkCount >= 100) {
            checkCount = 0;
            cleanup(now);
        }

        const entry = map.get(ip);

        if (!entry || now >= entry.resetAt) {
            map.set(ip, { count: 1, resetAt: now + windowMs });
            return {
                allowed: true,
                limit,
                remaining: limit - 1,
                resetAt: now + windowMs,
            };
        }

        entry.count++;

        if (entry.count > limit) {
            return {
                allowed: false,
                limit,
                remaining: 0,
                resetAt: entry.resetAt,
            };
        }

        return {
            allowed: true,
            limit,
            remaining: limit - entry.count,
            resetAt: entry.resetAt,
        };
    };
}

/**
 * Build an async rate-limit checker.
 *
 * Returns `(ip) => Promise<RateLimitResult>`. Callers always `await`
 * the result — under the hood it uses Upstash's sliding-window
 * algorithm when KV is available, falling back to an in-memory Map
 * otherwise or on runtime KV errors.
 */
export function createRateLimiter(
    opts: RateLimiterOptions,
): (ip: string) => Promise<RateLimitResult> {
    const inMemory = createInMemoryLimiter(opts);

    const redis = isKvAvailable() ? getRedisClient() : null;
    if (!redis) {
        return async (ip: string) => inMemory(ip);
    }

    const windowSeconds = Math.max(1, Math.round(opts.windowMs / 1000));
    const ratelimit = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(opts.limit, `${windowSeconds} s`),
        prefix: opts.prefix ?? "rl",
        analytics: false,
    });

    return async (ip: string): Promise<RateLimitResult> => {
        try {
            const res = await ratelimit.limit(ip);
            return {
                allowed: res.success,
                limit: res.limit,
                remaining: res.remaining,
                resetAt: res.reset,
            };
        } catch (err) {
            console.warn(
                JSON.stringify({
                    level: "warn",
                    stage: "kv-fallback",
                    op: "ratelimit.limit",
                    ip,
                    err: err instanceof Error ? err.message : String(err),
                }),
            );
            return inMemory(ip);
        }
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
