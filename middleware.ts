import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter, getClientIp } from "@/src/lib/rate-limit";

// Three tiers based on endpoint cost. The bucket name keeps their Neon
// rows separate — same IP can hit each tier independently.
const askLimiter = createRateLimiter({ bucket: "mw-ask", limit: 10, windowMs: 60_000 }); // /api/ask — expensive Gemini calls
const searchLimiter = createRateLimiter({ bucket: "mw-search", limit: 60, windowMs: 60_000 }); // /api/search — DB query
const generalLimiter = createRateLimiter({ bucket: "mw-general", limit: 120, windowMs: 60_000 }); // /api/editions, /api/weather

// Returns the limiter for the paths we rate-limit, or null for everything
// else (pages and un-throttled API routes). Preserves the pre-CSP behavior:
// only these paths were matched and limited before.
function rateLimitedTier(pathname: string) {
  if (pathname === "/api/ask") return askLimiter;
  if (pathname === "/api/search") return searchLimiter;
  // The old matcher "/api/editions/:path*" also covered the exact
  // "/api/editions" (zero trailing segments), so keep it in the tier.
  if (
    pathname === "/api/editions" ||
    pathname.startsWith("/api/editions/") ||
    pathname === "/api/weather"
  ) {
    return generalLimiter;
  }
  return null;
}

// CSP is built per-request because script-src carries a fresh nonce. That is
// what lets us drop 'unsafe-inline' from script-src: only scripts tagged with
// this exact nonce run, and 'strict-dynamic' lets those nonce'd scripts (the
// Next.js bootstrap) load the app's own chunks. 'unsafe-eval' is dev-only
// (React Refresh). style-src keeps 'unsafe-inline' — noncing styles is a
// separate, larger change and out of scope here.
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https:",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'self'",
  ].join("; ");
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);

  const limiter = rateLimitedTier(pathname);
  if (limiter) {
    const ip = getClientIp(request);
    const result = await limiter(ip);
    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
      return NextResponse.json(
        {
          kind: "rate_limit",
          message: "Too many requests",
          error: "Too many requests",
          retryAfterSec: retryAfter,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfter),
            "X-RateLimit-Limit": String(result.limit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(result.resetAt),
            "Content-Security-Policy": csp,
          },
        },
      );
    }

    // Rate-limited routes are JSON APIs — they render no inline scripts, so
    // they don't need the request-side nonce plumbing, only the response CSP.
    const response = NextResponse.next();
    response.headers.set("X-RateLimit-Limit", String(result.limit));
    response.headers.set("X-RateLimit-Remaining", String(result.remaining));
    response.headers.set("X-RateLimit-Reset", String(result.resetAt));
    response.headers.set("Content-Security-Policy", csp);
    return response;
  }

  // Document (page) requests: expose the nonce to the app via x-nonce, and put
  // the CSP on the REQUEST headers too so Next.js reads the nonce and stamps it
  // onto its own framework scripts during render.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Run on every route except Next's static assets, the image optimizer, and
  // static files — so CSP covers all HTML documents and API responses.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|woff|woff2|ttf|otf|map)$).*)",
  ],
};
