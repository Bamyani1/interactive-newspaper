import { NextRequest, NextResponse } from "next/server";
import { queryEditionByDate } from "@/src/lib/db";

// Revalidate individual edition data every 60 seconds (ISR)
export const revalidate = 60;

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ date: string }> },
) {
  const { date } = await params;

  if (!isIsoDate(date)) {
    return NextResponse.json(
      { error: "Invalid date format" },
      { status: 400 },
    );
  }

  try {
    const result = await queryEditionByDate(date);

    if (!result) {
      return NextResponse.json(
        { error: "Edition not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      edition: result.edition,
      articles: result.articles,
      ads: result.ads,
      otherContent: [],
      pagination: {
        nextCursor: null,
        hasMore: false,
      },
    });
  } catch (error) {
    console.error(`Failed to load edition ${date}:`, error);
    return NextResponse.json(
      { error: "Failed to load edition" },
      { status: 500 },
    );
  }
}
