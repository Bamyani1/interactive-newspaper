import { NextRequest, NextResponse } from 'next/server';
import { lookupHistoricalWeather } from '@/src/lib/weather';
import {
  getLocalWeatherByDate,
  isDateWithinLocalArchive,
  parseScope,
} from '@/src/lib/weather-local-archive';
import type { WeatherQuery } from '@/src/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

async function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    if (signal?.aborted) throw new DOMException('Request timed out', 'AbortError');
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

function eachDateInclusive(startDate: string, endDate: string): string[] {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }

  const dates: string[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }

  return dates;
}

function parseNumericParam(value: string | null): number | undefined {
  if (value == null || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const startDate = params.get('start_date');
  const endDate = params.get('end_date');
  const scope = parseScope(params.get('scope'));

  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: 'Missing required query parameters: start_date and end_date' },
      { status: 400 },
    );
  }

  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    return NextResponse.json(
      { error: 'start_date and end_date must use YYYY-MM-DD format.' },
      { status: 400 },
    );
  }

  const dates = eachDateInclusive(startDate, endDate);
  if (dates.length === 0) {
    return NextResponse.json(
      { error: 'start_date must be earlier than or equal to end_date.' },
      { status: 400 },
    );
  }

  const MAX_RANGE_DAYS = 366;
  if (dates.length > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: `Date range too large: ${dates.length} days exceeds maximum of ${MAX_RANGE_DAYS} days.` },
      { status: 400 },
    );
  }

  const weatherQueryBase: Omit<WeatherQuery, 'date'> = {
    location_name: params.get('location_name') ?? undefined,
    lat: parseNumericParam(params.get('lat')),
    lon: parseNumericParam(params.get('lon')),
    state: params.get('state') ?? undefined,
    country: params.get('country') ?? undefined,
    station_id: params.get('station_id') ?? undefined,
    force_fallback: params.get('force_fallback') === 'true',
  };

  try {
    const signal = AbortSignal.timeout(30_000);

    const records = await processInBatches(
      dates,
      10,
      async (date) => {
        if (isDateWithinLocalArchive(date)) {
          const localRecord = await getLocalWeatherByDate(date, scope);
          return { date, record: localRecord, reason: (localRecord ? null : 'NO_DATA') as 'NO_DATA' | null };
        }
        const lookup = await lookupHistoricalWeather({ ...weatherQueryBase, date });
        return { date, record: lookup.record, reason: lookup.reason };
      },
      signal,
    );

    const totalDays = records.length;
    const populatedDays = records.filter((entry) => entry.record != null).length;
    const missingDays = totalDays - populatedDays;

    return NextResponse.json({
      start_date: startDate,
      end_date: endDate,
      scope,
      total_days: totalDays,
      populated_days: populatedDays,
      missing_days: missingDays,
      missing_day_percentage: totalDays === 0
        ? 0
        : Math.round((missingDays / totalDays) * 10000) / 100,
      records,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return NextResponse.json({ error: 'Request timed out' }, { status: 504 });
    }
    const message = error instanceof Error ? error.message : 'Failed to fetch weather range';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
