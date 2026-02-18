import { readFile } from 'fs/promises';
import path from 'path';
import type { DailyWeatherRecord } from '@/src/types';

export type LocalWeatherScope = 'delaware' | 'statewide';

export const LOCAL_ARCHIVE_START = '1950-01-01';
export const LOCAL_ARCHIVE_END = '2000-12-31';

const INDEX_FILES: Record<LocalWeatherScope, string> = {
  delaware: path.join(
    process.cwd(),
    'public',
    'data',
    'weather',
    'ohio',
    'index',
    'delaware-by-date-1950-2000.json',
  ),
  statewide: path.join(
    process.cwd(),
    'public',
    'data',
    'weather',
    'ohio',
    'index',
    'statewide-by-date-1950-2000.json',
  ),
};

interface ArchiveCache {
  map: Map<string, DailyWeatherRecord>;
  records: DailyWeatherRecord[];
}

const cacheByScope = new Map<LocalWeatherScope, Promise<ArchiveCache>>();

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toScope(scope: string | null): LocalWeatherScope {
  return scope === 'statewide' ? 'statewide' : 'delaware';
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

async function loadScope(scope: LocalWeatherScope): Promise<ArchiveCache> {
  const indexFile = INDEX_FILES[scope];
  const raw = await readFile(indexFile, 'utf8');
  const parsed = JSON.parse(raw) as DailyWeatherRecord[];

  if (!Array.isArray(parsed)) {
    throw new Error(`Local weather archive index is invalid for scope=${scope}.`);
  }

  const map = new Map<string, DailyWeatherRecord>();
  for (const record of parsed) {
    if (record && typeof record.date === 'string') {
      map.set(record.date, record);
    }
  }

  return { map, records: parsed };
}

async function getScopeCache(scope: LocalWeatherScope): Promise<ArchiveCache> {
  const existing = cacheByScope.get(scope);
  if (existing) {
    return existing;
  }

  const pending = loadScope(scope);
  cacheByScope.set(scope, pending);
  return pending;
}

export function parseScope(scope: string | null): LocalWeatherScope {
  return toScope(scope);
}

export function isDateWithinLocalArchive(date: string): boolean {
  if (!isIsoDate(date)) return false;
  return date >= LOCAL_ARCHIVE_START && date <= LOCAL_ARCHIVE_END;
}

export async function getLocalWeatherByDate(
  date: string,
  scope: LocalWeatherScope,
): Promise<DailyWeatherRecord | null> {
  if (!isDateWithinLocalArchive(date)) {
    return null;
  }

  try {
    const cache = await getScopeCache(scope);
    return cache.map.get(date) ?? null;
  } catch {
    return null;
  }
}

export async function getLocalWeatherRange(
  startDate: string,
  endDate: string,
  scope: LocalWeatherScope,
): Promise<Array<{ date: string; record: DailyWeatherRecord | null; reason: 'NO_DATA' | null }>> {
  const dates = eachDateInclusive(startDate, endDate);

  const cache = await getScopeCache(scope);

  return dates.map((date) => {
    if (!isDateWithinLocalArchive(date)) {
      return { date, record: null, reason: 'NO_DATA' as const };
    }

    const record = cache.map.get(date) ?? null;
    return { date, record, reason: record ? null : ('NO_DATA' as const) };
  });
}

export function clearLocalWeatherArchiveCacheForTests(): void {
  cacheByScope.clear();
}
