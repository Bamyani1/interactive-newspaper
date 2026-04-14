import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter, getClientIp } from "@/src/lib/rate-limit";

// Three tiers based on endpoint cost
const askLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 }); // /api/ask — expensive Gemini calls
const searchLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 }); // /api/search — DB query
const generalLimiter = createRateLimiter({ limit: 120, windowMs: 60_000 }); // all other API routes

function getLimiter(pathname: string) {
  if (pathname === "/api/ask") return askLimiter;
  if (pathname === "/api/search") return searchLimiter;
  return generalLimiter;
}

export async function middleware(request: NextRequest) {
  const ip = getClientIp(request);
  const limiter = getLimiter(request.nextUrl.pathname);
  const result = await limiter(ip);

  if (!result.allowed) {
    const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(result.limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(result.resetAt),
        },
      },
    );
  }

  const response = NextResponse.next();
  response.headers.set("X-RateLimit-Limit", String(result.limit));
  response.headers.set("X-RateLimit-Remaining", String(result.remaining));
  response.headers.set("X-RateLimit-Reset", String(result.resetAt));
  return response;
}

export const config = {
  matcher: ["/api/ask", "/api/search", "/api/editions/:path*", "/api/weather"],
};
