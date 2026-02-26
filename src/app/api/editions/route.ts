import { NextRequest, NextResponse } from "next/server";
import { queryEditions } from "@/src/lib/db";

// Revalidate editions list every 60 seconds (ISR)
export const revalidate = 60;

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 500);
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);
    const startDate = url.searchParams.get("start_date") || undefined;
    const endDate = url.searchParams.get("end_date") || undefined;

    const { editions, pagination } = await queryEditions({
      limit,
      offset,
      startDate,
      endDate,
    });

    return NextResponse.json({ editions, pagination });
  } catch (error) {
    console.error("Failed to list editions:", error);
    return NextResponse.json(
      { error: "Failed to load editions" },
      { status: 500 },
    );
  }
}
