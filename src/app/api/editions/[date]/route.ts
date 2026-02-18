import { NextRequest, NextResponse } from 'next/server';
import { loadEdition, transformArticles, transformAds, transformOtherContent, computePageCount } from '@/src/lib/ocr-adapter';

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
      { error: 'Invalid date format' },
      { status: 400 },
    );
  }

  const edition = await loadEdition(date);
  if (!edition) {
    return NextResponse.json(
      { error: 'Edition not found' },
      { status: 404 },
    );
  }

  const articles = transformArticles(edition);
  const ads = transformAds(edition);
  const otherContent = transformOtherContent(edition);
  const pageCount = computePageCount(edition);

  return NextResponse.json({
    edition: {
      id: date,
      date,
      pageCount,
      publicationInfo: edition.publication_info || '',
    },
    articles,
    ads,
    otherContent,
    pagination: {
      nextCursor: null,
      hasMore: false,
    },
  });
}
