import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calculateDailyDeviation,
  computeDailyWeatherHash,
  fetchWeatherRange,
  isDeviationAboveThreshold,
  lookupHistoricalWeather,
} from '../../src/lib/weather';
import type { DailyWeatherRecord } from '../../src/types';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function asUrl(input: string): URL {
  return new URL(input);
}

describe('historical weather provider pipeline', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Ohio historical pull test: NOAA returns non-null daily metrics for 1955-01-01', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.startsWith('https://data.rcc-acis.org/StnMeta')) {
        return jsonResponse({
          meta: [
            {
              name: 'JOHN GLENN INTERNATIONAL AIRPORT',
              sids: ['USW00014821 6'],
              ll: [-82.9988, 39.9612],
            },
          ],
        });
      }

      if (input.startsWith('https://www.ncei.noaa.gov/access/services/data/v1')) {
        return jsonResponse([
          {
            DATE: '1955-01-01',
            STATION: 'USW00014821',
            TMAX: '13.9',
            TMIN: '-0.6',
            PRCP: '2.5',
          },
        ]);
      }

      if (input.startsWith('https://archive-api.open-meteo.com/v1/archive')) {
        return jsonResponse({
          daily: {
            time: ['1955-01-01'],
            temperature_2m_max: [11.1],
            temperature_2m_min: [-2.1],
            precipitation_sum: [2.9],
          },
        });
      }

      throw new Error(`Unexpected URL: ${input}`);
    });

    const result = await lookupHistoricalWeather(
      {
        date: '1955-01-01',
        lat: 39.9612,
        lon: -82.9988,
        state: 'OH',
        country: 'US',
      },
      { fetcher: fetchMock },
    );

    expect(result.reason).toBeNull();
    expect(result.record).not.toBeNull();
    expect(result.record?.source).toBe('NOAA_DAILY_SUMMARIES');
    expect(result.record?.tmax_c).toBe(13.9);
    expect(result.record?.tmin_c).toBe(-0.6);
    expect(result.record?.precip_mm).toBe(2.5);
    expect(result.record?.is_estimated).toBe(false);
  });

  it('Date continuity test: range query reports missing-day percentage', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = asUrl(input);
      if (url.origin === 'https://www.ncei.noaa.gov') {
        const date = url.searchParams.get('startDate');
        if (date === '1955-01-02') {
          return jsonResponse([]);
        }

        return jsonResponse([
          {
            DATE: date,
            STATION: 'USW00014821',
            TMAX: '10.0',
            TMIN: '0.0',
            PRCP: '0.0',
          },
        ]);
      }

      if (url.origin === 'https://archive-api.open-meteo.com') {
        const date = url.searchParams.get('start_date');
        if (date === '1955-01-02') {
          return jsonResponse({
            daily: {
              time: [date],
              temperature_2m_max: [null],
              temperature_2m_min: [null],
              precipitation_sum: [null],
            },
          });
        }

        return jsonResponse({
          daily: {
            time: [date],
            temperature_2m_max: [11],
            temperature_2m_min: [1],
            precipitation_sum: [0],
          },
        });
      }

      throw new Error(`Unexpected URL: ${input}`);
    });

    const range = await fetchWeatherRange(
      {
        start_date: '1955-01-01',
        end_date: '1955-01-03',
        station_id: 'USW00014821',
        state: 'OH',
        country: 'US',
      },
      { fetcher: fetchMock },
    );

    expect(range.total_days).toBe(3);
    expect(range.populated_days).toBe(2);
    expect(range.missing_days).toBe(1);
    expect(range.missing_day_percentage).toBe(33.33);
  });

  it('Station fallback test: unavailable station path uses reanalysis and marks estimated', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.startsWith('https://archive-api.open-meteo.com/v1/archive')) {
        return jsonResponse({
          daily: {
            time: ['1955-01-01'],
            temperature_2m_max: [11.1],
            temperature_2m_min: [-2.1],
            precipitation_sum: [2.9],
          },
        });
      }

      throw new Error(`Unexpected URL: ${input}`);
    });

    const result = await lookupHistoricalWeather(
      {
        date: '1955-01-01',
        lat: 39.9612,
        lon: -82.9988,
        force_fallback: true,
      },
      { fetcher: fetchMock },
    );

    expect(result.reason).toBeNull();
    expect(result.record).not.toBeNull();
    expect(result.record?.source).toBe('OPEN_METEO_ARCHIVE');
    expect(result.record?.is_estimated).toBe(true);
  });

  it('ACIS-assisted station fallback converts Fahrenheit/inches to Celsius/mm', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.startsWith('https://data.rcc-acis.org/StnMeta')) {
        return jsonResponse({
          meta: [
            {
              name: 'JOHN GLENN INTERNATIONAL AIRPORT',
              sids: ['USW00014821 6'],
              ll: [-82.9988, 39.9612],
            },
          ],
        });
      }

      if (input.startsWith('https://www.ncei.noaa.gov/access/services/data/v1')) {
        return jsonResponse([]);
      }

      if (input.startsWith('https://data.rcc-acis.org/StnData')) {
        return jsonResponse({
          meta: { sids: ['USW00014821 6'] },
          data: [['1955-01-01', '57', '31', '0.10']],
        });
      }

      throw new Error(`Unexpected URL: ${input}`);
    });

    const result = await lookupHistoricalWeather(
      {
        date: '1955-01-01',
        lat: 39.9612,
        lon: -82.9988,
      },
      { fetcher: fetchMock },
    );

    expect(result.record).not.toBeNull();
    expect(result.record?.source).toBe('ACIS_STNDATA');
    expect(result.record?.tmax_c).toBe(13.89);
    expect(result.record?.tmin_c).toBe(-0.56);
    expect(result.record?.precip_mm).toBe(2.54);
  });

  it('Cross-source sanity test flags large NOAA vs reanalysis deviation', () => {
    const noaaRecord: DailyWeatherRecord = {
      date: '1955-01-01',
      tmax_c: 15,
      tmin_c: 5,
      precip_mm: 10,
      source: 'NOAA_DAILY_SUMMARIES',
      source_station_id: 'USW00014821',
      quality_flag: null,
      is_estimated: false,
      raw: {},
    };

    const reanalysisRecord: DailyWeatherRecord = {
      date: '1955-01-01',
      tmax_c: 2,
      tmin_c: -6,
      precip_mm: 1,
      source: 'OPEN_METEO_ARCHIVE',
      source_station_id: null,
      quality_flag: null,
      is_estimated: true,
      raw: {},
    };

    const deviation = calculateDailyDeviation(noaaRecord, reanalysisRecord);

    expect(deviation).toEqual({
      tmax_c_abs_diff: 13,
      tmin_c_abs_diff: 11,
      precip_mm_abs_diff: 9,
    });
    expect(
      isDeviationAboveThreshold(deviation, {
        tmax_c_abs_diff: 8,
        tmin_c_abs_diff: 8,
        precip_mm_abs_diff: 20,
      }),
    ).toBe(true);
  });

  it('Reproducibility test: same query yields identical normalized record hash', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.startsWith('https://data.rcc-acis.org/StnMeta')) {
        return jsonResponse({
          meta: [
            {
              name: 'JOHN GLENN INTERNATIONAL AIRPORT',
              sids: ['USW00014821 6'],
              ll: [-82.9988, 39.9612],
            },
          ],
        });
      }

      if (input.startsWith('https://www.ncei.noaa.gov/access/services/data/v1')) {
        return jsonResponse([
          {
            DATE: '1955-01-01',
            STATION: 'USW00014821',
            TMAX: '13.9',
            TMIN: '-0.6',
            PRCP: '2.5',
          },
        ]);
      }

      throw new Error(`Unexpected URL: ${input}`);
    });

    const query = {
      date: '1955-01-01',
      lat: 39.9612,
      lon: -82.9988,
      state: 'OH',
      country: 'US',
    };

    const first = await lookupHistoricalWeather(query, { fetcher: fetchMock });
    const second = await lookupHistoricalWeather(query, { fetcher: fetchMock });

    expect(first.record).not.toBeNull();
    expect(second.record).not.toBeNull();

    const firstHash = computeDailyWeatherHash(first.record as DailyWeatherRecord);
    const secondHash = computeDailyWeatherHash(second.record as DailyWeatherRecord);

    expect(firstHash).toBe(secondHash);
  });
});
