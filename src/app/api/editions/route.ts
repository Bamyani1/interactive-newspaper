import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { queryEditions } from "@/src/lib/db";

// Revalidate editions list every 60 seconds (ISR)
export const revalidate = 60;

const GOLD_DATE = "1960-01-13";
const GOLD_EDITION_INFO = {
  id: `gold-${GOLD_DATE}`,
  date: GOLD_DATE,
  pageCount: 12,
  articleCount: 46,
};

function goldFileExists(): boolean {
  try {
    fs.accessSync(path.join(process.cwd(), "gold", GOLD_DATE, "gold-edition.json"));
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
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
    const hasGold = editions.some((e: { date: string }) => e.date === GOLD_DATE);
    if (!hasGold && goldFileExists()) {
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
