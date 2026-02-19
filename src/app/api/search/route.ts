import { NextRequest, NextResponse } from "next/server";
import { searchArticles } from "@/src/lib/db";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();

  if (!q) {
    return NextResponse.json(
      { error: "Missing required query parameter: q" },
      { status: 400 },
    );
  }

  const category = url.searchParams.get("category") || undefined;
  const startDate = url.searchParams.get("start_date") || undefined;
  const endDate = url.searchParams.get("end_date") || undefined;
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 100);
  const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10), 0);

  try {
    const { results, total } = await searchArticles({
      query: q,
      category,
      startDate,
      endDate,
      limit,
      offset,
    });

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
    console.error("Search failed:", error);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 },
    );
  }
}
