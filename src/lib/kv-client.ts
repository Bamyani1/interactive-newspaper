/**
 * Upstash Redis client wrapper with graceful fallback.
 *
 * If `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set at
 * module load, exposes a typed client. Otherwise every helper is a
 * no-op so callers fall back to in-memory behavior without branching
 * on environment at each call site.
 *
 * Every SDK call is wrapped in try/catch. Errors are logged at warn
 * level (eslint `no-console` restricts to {warn,error}) with
 * `stage: "kv-fallback"` so operators can grep stderr for transient
 * KV outages. Errors never propagate — `kvGet` returns `null`, `kvSet`
 * returns `false`. The next call re-tries KV; failures are not sticky.
 */
import { Redis } from "@upstash/redis";

let _redis: Redis | null = null;

function initRedis(): Redis | null {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;
    try {
        return new Redis({ url, token });
    } catch (err) {
        logKvFallback("init", err);
        return null;
    }
}

_redis = initRedis();

export function isKvAvailable(): boolean {
    return _redis !== null;
}

export function getRedisClient(): Redis | null {
    return _redis;
}

export async function kvGet<T>(key: string): Promise<T | null> {
    if (!_redis) return null;
    try {
        const value = await _redis.get<T>(key);
        return value ?? null;
    } catch (err) {
        logKvFallback("get", err, { key });
        return null;
    }
}

export async function kvSet<T>(
    key: string,
    value: T,
    ttlSeconds: number,
): Promise<boolean> {
    if (!_redis) return false;
    try {
        await _redis.set(key, value, { ex: ttlSeconds });
        return true;
    } catch (err) {
        logKvFallback("set", err, { key });
        return false;
    }
}

export async function kvDel(key: string): Promise<boolean> {
    if (!_redis) return false;
    try {
        await _redis.del(key);
        return true;
    } catch (err) {
        logKvFallback("del", err, { key });
        return false;
    }
}

function logKvFallback(
    op: string,
    err: unknown,
    extra: Record<string, unknown> = {},
): void {
    console.warn(
        JSON.stringify({
            level: "warn",
            stage: "kv-fallback",
            op,
            ...extra,
            err: err instanceof Error ? err.message : String(err),
        }),
    );
}

/**
 * Test hook: re-reads env vars and rebuilds the client. Lets tests
 * simulate env-present / env-absent by mutating `process.env` and
 * calling this before each test.
 */
export function _resetKvForTests(): void {
    _redis = initRedis();
}
