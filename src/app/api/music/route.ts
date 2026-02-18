import { NextRequest, NextResponse } from 'next/server';
import {
  getLocalMonthlyTop10ByDate,
  isMonthWithinMusicArchive,
  parseMonthFromDate,
} from '@/src/lib/music-local-archive';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get('date');

  if (!date) {
    return NextResponse.json(
      {
        query: {
          date: null,
          month: null,
        },
        record: null,
        reason: 'INVALID_DATE',
        attempts: ['LOCAL_ARCHIVE:hot100-monthly'],
        error: 'Missing required query parameter: date',
      },
      { status: 400 },
    );
  }

  const month = parseMonthFromDate(date);
  if (!month) {
    return NextResponse.json(
      {
        query: {
          date,
          month: null,
        },
        record: null,
        reason: 'INVALID_DATE',
        attempts: ['LOCAL_ARCHIVE:hot100-monthly'],
      },
      { status: 400 },
    );
  }

  if (!isMonthWithinMusicArchive(month)) {
    return NextResponse.json({
      query: {
        date,
        month,
      },
      record: null,
      reason: 'OUT_OF_ARCHIVE_RANGE',
      attempts: ['LOCAL_ARCHIVE:hot100-monthly'],
    });
  }

  const record = await getLocalMonthlyTop10ByDate(date);

  if (!record) {
    return NextResponse.json(
      {
        query: {
          date,
          month,
        },
        record: null,
        reason: 'NO_DATA',
        attempts: ['LOCAL_ARCHIVE:hot100-monthly'],
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    query: {
      date,
      month,
    },
    record,
    reason: null,
    attempts: ['LOCAL_ARCHIVE:hot100-monthly'],
  });
}
