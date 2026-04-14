import { readFile } from 'fs/promises';
import path from 'path';
import type { DailyWeatherRecord } from '@/src/types';

export const LOCAL_ARCHIVE_START = '1950-01-01';
export const LOCAL_ARCHIVE_END = '2000-12-31';
const TOTAL_DAYS = 18628;

const ARCHIVE_FILE = path.join(
  process.cwd(),
  'public',
  'data',
  'weather',
  'ohio',
  'index',
  'delaware-by-date-1950-2000.json',
);

interface SlimArchive {
  start_date: string;
  end_date: string;
  tmax_c: Array<number | null>;
  tmin_c: Array<number | null>;
  is_estimated: string;
}

let archivePromise: Promise<SlimArchive> | null = null;

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dayIndex(isoDate: string): number {
  const start = Date.UTC(1950, 0, 1);
  const target = Date.UTC(
    Number(isoDate.slice(0, 4)),
    Number(isoDate.slice(5, 7)) - 1,
    Number(isoDate.slice(8, 10)),
  );
  return Math.floor((target - start) / 86400000);
}

async function loadArchive(): Promise<SlimArchive> {
  const raw = await readFile(ARCHIVE_FILE, 'utf8');
  const parsed = JSON.parse(raw) as SlimArchive;

  if (
    !parsed ||
    !Array.isArray(parsed.tmax_c) ||
    !Array.isArray(parsed.tmin_c) ||
    typeof parsed.is_estimated !== 'string' ||
    parsed.tmax_c.length !== TOTAL_DAYS ||
    parsed.tmin_c.length !== TOTAL_DAYS ||
    parsed.is_estimated.length !== TOTAL_DAYS
  ) {
    throw new Error('Local weather archive is malformed.');
  }

  return parsed;
}

async function getArchive(): Promise<SlimArchive> {
  if (!archivePromise) {
    archivePromise = loadArchive();
  }
  return archivePromise;
}

function buildRecord(
  archive: SlimArchive,
  date: string,
  index: number,
): DailyWeatherRecord | null {
  const tmax = archive.tmax_c[index];
  const tmin = archive.tmin_c[index];
  if (tmax == null && tmin == null) return null;

  return {
    date,
    tmax_c: tmax ?? null,
    tmin_c: tmin ?? null,
    precip_mm: null,
    source: 'NOAA_GHCN_DAILY_ARCHIVE',
    source_station_id: null,
    quality_flag: null,
    is_estimated: archive.is_estimated[index] === '1',
    raw: {},
  };
}

export function isDateWithinLocalArchive(date: string): boolean {
  if (!isIsoDate(date)) return false;
  return date >= LOCAL_ARCHIVE_START && date <= LOCAL_ARCHIVE_END;
}

export async function getLocalWeatherByDate(
  date: string,
): Promise<DailyWeatherRecord | null> {
  if (!isDateWithinLocalArchive(date)) {
    return null;
  }

  try {
    const archive = await getArchive();
    const idx = dayIndex(date);
    if (idx < 0 || idx >= TOTAL_DAYS) return null;
    return buildRecord(archive, date, idx);
  } catch {
    return null;
  }
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

export async function getLocalWeatherRange(
  startDate: string,
  endDate: string,
): Promise<Array<{ date: string; record: DailyWeatherRecord | null; reason: 'NO_DATA' | null }>> {
  const dates = eachDateInclusive(startDate, endDate);

  let archive: SlimArchive;
  try {
    archive = await getArchive();
  } catch {
    return dates.map((date) => ({ date, record: null, reason: 'NO_DATA' as const }));
  }

  return dates.map((date) => {
    if (!isDateWithinLocalArchive(date)) {
      return { date, record: null, reason: 'NO_DATA' as const };
    }
    const idx = dayIndex(date);
    if (idx < 0 || idx >= TOTAL_DAYS) {
      return { date, record: null, reason: 'NO_DATA' as const };
    }
    const record = buildRecord(archive, date, idx);
    return { date, record, reason: record ? null : ('NO_DATA' as const) };
  });
}

export function clearLocalWeatherArchiveCacheForTests(): void {
  archivePromise = null;
}
