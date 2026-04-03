import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { queryEditionByDate } from "@/src/lib/db";
import { transformArticles, transformAds, computePageCount } from "@/src/server/ocr-adapter";
import type { OcrEdition } from "@/src/types";

// Revalidate individual edition data every 60 seconds (ISR)
export const revalidate = 60;

const GOLD_DATE = "1960-01-13";

function loadGoldEdition() {
  const filePath = path.join(process.cwd(), "gold", GOLD_DATE, "gold-edition.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  const edition: OcrEdition = JSON.parse(raw);
  return {
    edition: {
      id: `gold-${GOLD_DATE}`,
      date: GOLD_DATE,
      pageCount: computePageCount(edition),
      publicationInfo: edition.publication_info,
    },
    articles: transformArticles(edition),
    ads: transformAds(edition),
    otherContent: [],
    pagination: { nextCursor: null, hasMore: false },
  };
}

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
      if (date === GOLD_DATE) {
        try {
          return NextResponse.json(loadGoldEdition());
        } catch {
          // gold file missing — fall through to 404
        }
      }
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
