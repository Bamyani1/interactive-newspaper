import { describe, it, expect } from 'vitest';

const scriptModulePromise = import('../../scripts/weather/build-ohio-weather-archive.mjs');

describe('build-ohio-weather-archive helpers', () => {
  it('parses a GHCN daily CSV row and normalizes tenths-units', async () => {
    const script = await scriptModulePromise;

    const parsed = script.parseGhcndCsvLine('USW00014821,19550101,TMAX,139,,,7,');

    expect(parsed).toEqual({
      stationId: 'USW00014821',
      date: '1955-01-01',
      element: 'TMAX',
      dataValue: 139,
      mFlag: '',
      qFlag: '',
      sFlag: '7',
    });

    expect(script.normalizeNoaaValue('TMAX', 139)).toBe(13.9);
    expect(script.normalizeNoaaValue('TMIN', -6)).toBe(-0.6);
    expect(script.normalizeNoaaValue('PRCP', 25)).toBe(2.5);
  });

  it('selects deterministic Delaware record by completeness, distance, then station id', async () => {
    const script = await scriptModulePromise;

    const stationMetaById = new Map([
      ['USW00000002', { distance_to_delaware_km: 8 }],
      ['USW00000001', { distance_to_delaware_km: 8 }],
      ['USW00000003', { distance_to_delaware_km: 2 }],
    ]);

    const records = [
      {
        date: '1988-10-12',
        station_id: 'USW00000001',
        tmax_c: 12,
        tmin_c: 3,
        precip_mm: null,
      },
      {
        date: '1988-10-12',
        station_id: 'USW00000002',
        tmax_c: 11,
        tmin_c: 2,
        precip_mm: 1,
      },
      {
        date: '1988-10-12',
        station_id: 'USW00000003',
        tmax_c: 10,
        tmin_c: 1,
        precip_mm: 0,
      },
    ];

    const chosen = script.selectBestDelawareStationRecord(records, stationMetaById);

    // USW00000003 and USW00000002 both have 3 metrics; distance tie-break should pick USW00000003 (closest)
    expect(chosen.station_id).toBe('USW00000003');
  });

  it('fills missing metrics from fallback and marks estimated provenance', async () => {
    const script = await scriptModulePromise;

    const merged = script.mergeWithFallback({
      date: '1962-07-04',
      observedRecord: {
        date: '1962-07-04',
        station_id: 'USW00014821',
        tmax_c: 30.1,
        tmin_c: null,
        precip_mm: null,
      },
      fallbackValues: {
        tmax_c: 29.9,
        tmin_c: 19.3,
        precip_mm: 4.2,
      },
      mode: 'DELAWARE_NEAREST_BEST',
    });

    expect(merged.tmax_c).toBe(30.1);
    expect(merged.tmin_c).toBe(19.3);
    expect(merged.precip_mm).toBe(4.2);
    expect(merged.is_estimated).toBe(true);
    expect(merged.quality_flag).toBe('tmax:OBS;tmin:OPEN_METEO_FILL;prcp:OPEN_METEO_FILL');
  });
});
