import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { timingSafeEqual } from "node:crypto";
import { createRateLimiter, getClientIp } from "@/src/lib/rate-limit";

// Token-gated POST that drops the cached editions list. Call after
// `npm run db:seed` (or any other write that adds/removes editions) so
// the layout's 1h `unstable_cache` window doesn't keep stale data on screen.
export const dynamic = "force-dynamic";

// Aggressive rate limit — an admin cache-invalidation endpoint has no
// legitimate reason to be hit more than a few times per minute, so the
// limit doubles as a brute-force shield for the token check below.
// See docs/issues/0016.
const revalidateLimiter = createRateLimiter({ bucket: "revalidate", limit: 5, windowMs: 60_000 });

/**
 * Constant-time string comparison that avoids the timing-leak vulnerability
 * of `===`. Guards against length mismatch so `timingSafeEqual` never sees
 * buffers of different sizes (which would throw instead of returning false).
 * See docs/issues/0016.
 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(request: NextRequest) {
  const expected = process.env.ADMIN_REVALIDATE_TOKEN;
  if (!expected) {
    // Answer exactly as a wrong token does. A distinct 503 here told any
    // unauthenticated caller whether this endpoint was armed.
    console.error(
      JSON.stringify({
        level: "error",
        route: "/api/admin/revalidate",
        msg: "ADMIN_REVALIDATE_TOKEN is not configured",
      }),
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Throttle before the token check so online brute force is bounded. The
  // limiter is keyed by client IP — same pattern used by /api/ask.
  const ip = getClientIp(request);
  const limit = await revalidateLimiter(ip);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: {
          "Retry-After": Math.max(
            1,
            Math.ceil((limit.resetAt - Date.now()) / 1000),
          ).toString(),
        },
      },
    );
  }

  const provided = request.headers.get("X-Admin-Token");
  if (!provided || !safeEqual(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Next.js 16 requires a second `profile` argument; "max" matches the
  // long-lived layout cache (`unstable_cache` revalidate=3600).
  revalidateTag("editions", "max");
  return NextResponse.json({ revalidated: true, tag: "editions" });
}
