import { NextRequest, NextResponse } from 'next/server';
import { loadEdition, transformArticles, transformAds, computePageCount } from '@/src/lib/ocr-adapter';

// Revalidate individual edition data every 60 seconds (ISR)
export const revalidate = 60;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ date: string }> },
) {
  const { date } = await params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
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
    pagination: {
      nextCursor: null,
      hasMore: false,
    },
  });
}
