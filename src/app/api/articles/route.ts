import { NextRequest, NextResponse } from "next/server";
import { browseArticles } from "@/src/lib/db";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);

  const category = url.searchParams.get("category") || undefined;
  const author = url.searchParams.get("author") || undefined;
  const startDate = url.searchParams.get("start_date") || undefined;
  const endDate = url.searchParams.get("end_date") || undefined;
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 100);
  const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10), 0);

  try {
    const { articles, total } = await browseArticles({
      category,
      author,
      startDate,
      endDate,
      limit,
      offset,
    });

    return NextResponse.json({
      articles,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (error) {
    console.error("Browse articles failed:", error);
    return NextResponse.json(
      { error: "Failed to browse articles" },
      { status: 500 },
    );
  }
}
