import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('/api/weather local archive priority', () => {
  it('serves in-range date from local archive before live lookup', async () => {
    const liveLookup = vi.fn(async () => {
      throw new Error('Live lookup should not be called for in-range local archive date');
    });

    vi.doMock('@/src/lib/weather', () => ({
      lookupHistoricalWeatherCached: liveLookup,
    }));

    const route = await import('../../src/app/api/weather/route');

    const request = new NextRequest('http://localhost/api/weather?date=1988-10-12');
    const response = await route.GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.record?.date).toBe('1988-10-12');
    expect(payload.record?.source).toBe('NOAA_GHCN_DAILY_ARCHIVE');
    expect(Array.isArray(payload.attempts)).toBe(true);
    expect(payload.attempts[0]).toBe('LOCAL_ARCHIVE:delaware');
    expect(liveLookup).toHaveBeenCalledTimes(0);
  });

  it('falls back to live lookup for out-of-range date', async () => {
    const liveLookup = vi.fn(async () => ({
      query: {
        date: '2001-01-01',
        location_name: 'Delaware, Ohio',
        lat: 40.2987,
        lon: -83.0679,
        state: 'OH',
        country: 'US',
        force_fallback: false,
      },
      reason: null,
      attempts: ['NOAA:USW00014821'],
      record: {
        date: '2001-01-01',
        tmax_c: 1,
        tmin_c: -5,
        precip_mm: 0,
        source: 'NOAA_DAILY_SUMMARIES',
        source_station_id: 'USW00014821',
        quality_flag: null,
        is_estimated: false,
        raw: {},
      },
    }));

    vi.doMock('@/src/lib/weather', () => ({
      lookupHistoricalWeatherCached: liveLookup,
    }));

    const route = await import('../../src/app/api/weather/route');

    const request = new NextRequest('http://localhost/api/weather?date=2001-01-01');
    const response = await route.GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.record?.date).toBe('2001-01-01');
    expect(payload.record?.source).toBe('NOAA_DAILY_SUMMARIES');
    expect(liveLookup).toHaveBeenCalledTimes(1);
  });
});
