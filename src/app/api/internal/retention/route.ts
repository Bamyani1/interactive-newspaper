/**
 * /api/internal/retention — cron-triggered data-retention sweep
 *
 * Deletes expired ask_session_turns, out-of-retention ask_feedback,
 * and stale api_rate_bucket rows (see src/lib/retention.ts).
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}`. A missing CRON_SECRET
 * env, missing header, or wrong token all return 401 — the endpoint
 * never runs unauthenticated. Both GET and POST are accepted because
 * Vercel cron invokes cron paths with GET; operators can curl POST.
 *
 * Success: 200 { sessionTurns, feedback, rateBuckets }.
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createRateLimiter, getClientIp } from "@/src/lib/rate-limit";

/**
 * Constant-time string comparison — same guard as
 * src/app/api/admin/revalidate/route.ts (docs/issues/0016).
 */
function safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
}

// This is the only auth-bearing route with no rate limiter, and it runs bulk
// DELETEs. Throttle per-IP BEFORE the token check so a stolen-endpoint guess
// can't be brute-forced at offline speed. The Vercel cron hits this once/day
// from an unspoofable x-real-ip, so 5/min is never a constraint; and the
// limiter falls back to in-memory (allowing) on any Neon error, so a DB blip
// cannot 429 the cron either.
const retentionRateLimiter = createRateLimiter({
    bucket: "internal-retention",
    limit: 5,
    windowMs: 60_000,
});

async function handleRetentionSweep(request: NextRequest): Promise<NextResponse> {
    const rate = await retentionRateLimiter(getClientIp(request));
    if (!rate.allowed) {
        return NextResponse.json(
            { error: "Too many requests." },
            {
                status: 429,
                headers: {
                    "Retry-After": String(
                        Math.ceil((rate.resetAt - Date.now()) / 1000),
                    ),
                },
            },
        );
    }

    const secret = process.env.CRON_SECRET;
    if (!secret) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const header = request.headers.get("authorization");
    if (!header || !safeEqual(header, `Bearer ${secret}`)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        // Same failure shape as admin/revalidate uses for missing server env.
        return NextResponse.json(
            { error: "DATABASE_URL is not configured on the server" },
            { status: 503 },
        );
    }

    // Lazy imports keep module evaluation driver-free (mirrors the
    // lazy-init pattern the ask routes use via src/lib/rate-limit.ts:
    // no Neon client exists until DATABASE_URL is known to be set).
    const [executorModule, retentionModule] = await Promise.all([
        import("../../../../../scripts/db/lib/neon-executor"),
        import("@/src/lib/retention"),
    ]);

    try {
        const counts = await retentionModule.runRetentionSweep(
            executorModule.createNeonExecutor(databaseUrl),
        );
        return NextResponse.json(counts);
    } catch (err) {
        console.error(
            JSON.stringify({
                level: "error",
                route: "/api/internal/retention",
                stage: "sweep",
                msg: "retention sweep failed",
                err: err instanceof Error ? err.message : String(err),
            }),
        );
        return NextResponse.json(
            { error: "Retention sweep failed" },
            { status: 500 },
        );
    }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
    return handleRetentionSweep(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    return handleRetentionSweep(request);
}
