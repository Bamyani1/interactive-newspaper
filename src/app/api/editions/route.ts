import { NextRequest, NextResponse } from "next/server";
import { queryEditions } from "@/src/lib/db";
import { GOLD_DATE, GOLD_EDITION_INFO, GOLD_FILE_EXISTS } from "@/src/lib/gold-edition";
import { createRateLimiter, getClientIp } from "@/src/lib/rate-limit";

// Route reads request.url for query params, so it cannot be statically
// prerendered. Marking it explicitly stops Next.js from attempting (and logging
// a misleading "Dynamic server usage" error) during the build.
export const dynamic = "force-dynamic";

const editionsRateLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rate = editionsRateLimiter(ip);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rate.resetAt - Date.now()) / 1000)),
        },
      },
    );
  }

  try {
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "500", 10) || 500, 500);
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);
    const startDate = url.searchParams.get("start_date") || undefined;
    const endDate = url.searchParams.get("end_date") || undefined;

    const { editions, pagination } = await queryEditions({
      limit,
      offset,
      startDate,
      endDate,
    });

    // Inject gold edition if it exists and isn't already in the DB
    if (GOLD_FILE_EXISTS && !editions.some((e: { date: string }) => e.date === GOLD_DATE)) {
      editions.unshift(GOLD_EDITION_INFO);
    }

    return NextResponse.json({ editions, pagination });
  } catch (error) {
    console.error("Failed to list editions:", error);
    return NextResponse.json(
      { error: "Failed to load editions" },
      { status: 500 },
    );
  }
}
