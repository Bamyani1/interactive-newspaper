import { NextRequest, NextResponse } from 'next/server';
import { lookupHistoricalWeatherCached } from '@/src/lib/weather';
import {
  getLocalWeatherByDate,
  isDateWithinLocalArchive,
} from '@/src/lib/weather-local-archive';
import { createRateLimiter, getClientIp } from '@/src/lib/rate-limit';
import type { WeatherQuery } from '@/src/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const weatherRateLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

// Bounds for user-facing input fields. The route is primarily consumed by
// the app's own UI (which always supplies valid inputs), but rejecting
// garbage locally avoids wasting downstream API quota on obviously-bad
// requests and turns upstream 400s into cleaner local 400s. See
// docs/issues/0025.
const MAX_LOCATION_NAME_LEN = 100;
const MAX_COUNTRY_LEN = 3;
const MAX_STATE_LEN = 32;
const MAX_STATION_ID_LEN = 32;

function parseNumericParam(value: string | null): number | undefined {
  if (value == null || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rate = weatherRateLimiter(ip);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Too many weather requests. Please wait a moment and try again.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((rate.resetAt - Date.now()) / 1000)),
        },
      },
    );
  }

  const params = request.nextUrl.searchParams;
  const date = params.get('date');

  if (!date) {
    return NextResponse.json({ error: 'Missing required query parameter: date' }, { status: 400 });
  }

  if (isDateWithinLocalArchive(date)) {
    const localRecord = await getLocalWeatherByDate(date);
    if (localRecord) {
      return NextResponse.json({
        query: { date },
        record: localRecord,
        reason: null,
        attempts: ['LOCAL_ARCHIVE:delaware'],
      });
    }
  }

  // Local input validation — reject out-of-range coordinates and over-long
  // string params before forwarding downstream. See docs/issues/0025.
  const lat = parseNumericParam(params.get('lat'));
  const lon = parseNumericParam(params.get('lon'));
  if (lat !== undefined && (lat < -90 || lat > 90)) {
    return NextResponse.json({ error: 'lat out of range [-90, 90]' }, { status: 400 });
  }
  if (lon !== undefined && (lon < -180 || lon > 180)) {
    return NextResponse.json({ error: 'lon out of range [-180, 180]' }, { status: 400 });
  }

  const location_name = params.get('location_name') ?? undefined;
  if (location_name !== undefined && location_name.length > MAX_LOCATION_NAME_LEN) {
    return NextResponse.json({ error: 'location_name too long' }, { status: 400 });
  }
  const country = params.get('country') ?? undefined;
  if (country !== undefined && country.length > MAX_COUNTRY_LEN) {
    return NextResponse.json({ error: 'country too long' }, { status: 400 });
  }
  const state = params.get('state') ?? undefined;
  if (state !== undefined && state.length > MAX_STATE_LEN) {
    return NextResponse.json({ error: 'state too long' }, { status: 400 });
  }
  const station_id = params.get('station_id') ?? undefined;
  if (station_id !== undefined && station_id.length > MAX_STATION_ID_LEN) {
    return NextResponse.json({ error: 'station_id too long' }, { status: 400 });
  }

  const query: WeatherQuery = {
    date,
    location_name,
    lat,
    lon,
    state,
    country,
    station_id,
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
