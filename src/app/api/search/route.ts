import { NextRequest, NextResponse } from "next/server";
import { searchArticles } from "@/src/lib/db";

const MAX_QUERY_LENGTH = 200;
const SEARCH_TIMEOUT_MS = 8_000;

function newRequestId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();

  if (!q) {
    return NextResponse.json(
      { error: "Missing required query parameter: q", requestId },
      { status: 400 },
    );
  }

  // Length cap protects the FTS index against absurdly long queries that
  // could starve the DB connection (no upper bound on websearch_to_tsquery).
  if (q.length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      {
        error: `Query too long (${q.length} chars). Maximum is ${MAX_QUERY_LENGTH}.`,
        requestId,
      },
      { status: 400 },
    );
  }

  const category = url.searchParams.get("category") || undefined;
  const startDate = url.searchParams.get("start_date") || undefined;
  const endDate = url.searchParams.get("end_date") || undefined;
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 100);
  const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10), 0);

  // Wrap the DB call in a timeout race so a hung Neon request can't block
  // /api/search forever. 504 on fire matches /api/ask retrieval semantics.
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error("Search timeout")),
      SEARCH_TIMEOUT_MS,
    ),
  );

  try {
    const { results, total } = await Promise.race([
      searchArticles({
        query: q,
        category,
        startDate,
        endDate,
        limit,
        offset,
      }),
      timeoutPromise,
    ]);

    return NextResponse.json({
      query: q,
      results,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Search timeout") {
      console.warn(
        `[search requestId=${requestId}] timed out after ${SEARCH_TIMEOUT_MS}ms`,
      );
      return NextResponse.json(
        {
          error: "Search took too long. Please try a more specific query.",
          cause: "timeout",
          requestId,
        },
        { status: 504 },
      );
    }
    console.error(`[search requestId=${requestId}] failed:`, error);
    return NextResponse.json(
      {
        error: "Search failed. Please try again.",
        cause: "internal_error",
        requestId,
      },
      { status: 500 },
    );
  }
}
