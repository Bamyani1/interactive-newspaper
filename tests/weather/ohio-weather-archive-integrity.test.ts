import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearLocalWeatherArchiveCacheForTests,
  getLocalWeatherByDate,
  getLocalWeatherRange,
  isDateWithinLocalArchive,
} from '../../src/lib/weather-local-archive';

describe('offline ohio weather archive integrity', () => {
  beforeEach(() => {
    clearLocalWeatherArchiveCacheForTests();
  });

  it('covers full 1950-01-01 to 2000-12-31 date boundaries', async () => {
    expect(isDateWithinLocalArchive('1949-12-31')).toBe(false);
    expect(isDateWithinLocalArchive('1950-01-01')).toBe(true);
    expect(isDateWithinLocalArchive('2000-12-31')).toBe(true);
    expect(isDateWithinLocalArchive('2001-01-01')).toBe(false);

    const start = await getLocalWeatherByDate('1950-01-01', 'delaware');
    const end = await getLocalWeatherByDate('2000-12-31', 'delaware');

    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
  });

  it('returns a deterministic local archive record for an edition date', async () => {
    const record = await getLocalWeatherByDate('1988-10-12', 'delaware');

    expect(record).not.toBeNull();
    expect(record?.date).toBe('1988-10-12');
    expect(record?.source).toBe('NOAA_GHCN_DAILY_ARCHIVE');
    expect(typeof record?.tmax_c === 'number' || record?.tmax_c === null).toBe(true);
    expect(typeof record?.tmin_c === 'number' || record?.tmin_c === null).toBe(true);
    expect(typeof record?.precip_mm === 'number' || record?.precip_mm === null).toBe(true);
  });

  it('range lookup has no missing days after fallback fill policy', async () => {
    const range = await getLocalWeatherRange('1955-01-01', '1955-12-31', 'delaware');

    expect(range).toHaveLength(365);
    const missing = range.filter((entry) => entry.record == null);
    expect(missing).toHaveLength(0);
  });
});
