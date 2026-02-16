import { NextRequest, NextResponse } from 'next/server';
import { lookupHistoricalWeatherCached } from '@/src/lib/weather';
import {
  getLocalWeatherByDate,
  isDateWithinLocalArchive,
  parseScope,
} from '@/src/lib/weather-local-archive';
import type { WeatherQuery } from '@/src/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseNumericParam(value: string | null): number | undefined {
  if (value == null || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const date = params.get('date');
  const scope = parseScope(params.get('scope'));

  if (!date) {
    return NextResponse.json({ error: 'Missing required query parameter: date' }, { status: 400 });
  }

  if (isDateWithinLocalArchive(date)) {
    const localRecord = await getLocalWeatherByDate(date, scope);
    if (localRecord) {
      return NextResponse.json({
        query: {
          date,
          scope,
        },
        record: localRecord,
        reason: null,
        attempts: [`LOCAL_ARCHIVE:${scope}`],
      });
    }
  }

  const query: WeatherQuery = {
    date,
    location_name: params.get('location_name') ?? undefined,
    lat: parseNumericParam(params.get('lat')),
    lon: parseNumericParam(params.get('lon')),
    state: params.get('state') ?? undefined,
    country: params.get('country') ?? undefined,
    station_id: params.get('station_id') ?? undefined,
    force_fallback: params.get('force_fallback') === 'true',
  };

  const lookup = await lookupHistoricalWeatherCached(query);
  if (!lookup.record) {
    return NextResponse.json(
      {
        query: lookup.query,
        record: null,
        reason: lookup.reason,
        attempts: lookup.attempts,
      },
      { status: lookup.reason === 'INVALID_DATE' ? 400 : 404 },
    );
  }

  return NextResponse.json({
    query: lookup.query,
    record: lookup.record,
    reason: null,
    attempts: lookup.attempts,
  });
}
