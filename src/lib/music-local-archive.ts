import { readFile } from 'fs/promises';
import path from 'path';
import type {
  MonthlyTrendingRecord,
  MonthlyTrendingTrackCatalogItem,
  MusicSource,
} from '@/src/types';

export const MUSIC_ARCHIVE_START_DATE = '1958-08-01';
export const MUSIC_ARCHIVE_END_DATE = '2000-12-31';
export const MUSIC_ARCHIVE_START_MONTH = '1958-08';
export const MUSIC_ARCHIVE_END_MONTH = '2000-12';

const MONTHLY_INDEX_PATH = path.join(
  process.cwd(),
  'public',
  'data',
  'music',
  'us',
  'hot100',
  'index',
  'monthly-top10-1958-2000.json',
);

const TRACKS_CATALOG_PATH = path.join(
  process.cwd(),
  'public',
  'data',
  'music',
  'us',
  'hot100',
  'index',
  'tracks-catalog-1958-2000.json',
);

interface MonthlyIndexTrackRef {
  rank: number;
  track_id: string;
  points_total: number;
  best_rank: number;
  weeks_present: number;
}

interface MonthlyIndexRecord {
  month: string;
  source: MusicSource;
  tracks: MonthlyIndexTrackRef[];
  raw: Record<string, unknown>;
}

interface ArchiveCache {
  monthMap: Map<string, MonthlyTrendingRecord>;
  trackMap: Map<string, MonthlyTrendingTrackCatalogItem>;
}

let pendingCache: Promise<ArchiveCache> | null = null;

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isIsoMonth(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value);
}

async function loadArchive(): Promise<ArchiveCache> {
  const [indexRaw, catalogRaw] = await Promise.all([
    readFile(MONTHLY_INDEX_PATH, 'utf8'),
    readFile(TRACKS_CATALOG_PATH, 'utf8'),
  ]);

  const index = JSON.parse(indexRaw) as MonthlyIndexRecord[];
  const catalog = JSON.parse(catalogRaw) as MonthlyTrendingTrackCatalogItem[];

  if (!Array.isArray(index) || !Array.isArray(catalog)) {
    throw new Error('Invalid music archive format.');
  }

  const trackMap = new Map<string, MonthlyTrendingTrackCatalogItem>();
  for (const track of catalog) {
    if (!track || typeof track.track_id !== 'string') {
      continue;
    }

    trackMap.set(track.track_id, {
      track_id: track.track_id,
      title: track.title,
      artist: track.artist,
      youtubeId: track.youtubeId ?? null,
    });
  }

  const monthMap = new Map<string, MonthlyTrendingRecord>();

  for (const record of index) {
    if (!record || typeof record.month !== 'string' || !Array.isArray(record.tracks)) {
      continue;
    }

    const resolvedTracks = record.tracks
      .map((trackRef) => {
        const trackMeta = trackMap.get(trackRef.track_id);
        if (!trackMeta) {
          return null;
        }

        return {
          rank: trackRef.rank,
          track_id: trackRef.track_id,
          title: trackMeta.title,
          artist: trackMeta.artist,
          youtubeId: trackMeta.youtubeId,
          points_total: trackRef.points_total,
          best_rank: trackRef.best_rank,
          weeks_present: trackRef.weeks_present,
        };
      })
      .filter((track): track is MonthlyTrendingRecord['tracks'][number] => track !== null)
      .sort((a, b) => a.rank - b.rank);

    monthMap.set(record.month, {
      month: record.month,
      source: record.source,
      tracks: resolvedTracks,
      raw: record.raw ?? {},
    });
  }

  return {
    monthMap,
    trackMap,
  };
}

async function getArchiveCache(): Promise<ArchiveCache> {
  if (pendingCache) {
    return pendingCache;
  }

  pendingCache = loadArchive();
  return pendingCache;
}

export function parseMonthFromDate(date: string): string | null {
  if (!isIsoDate(date)) {
    return null;
  }

  return date.slice(0, 7);
}

export function isMonthWithinMusicArchive(month: string): boolean {
  if (!isIsoMonth(month)) {
    return false;
  }

  return month >= MUSIC_ARCHIVE_START_MONTH && month <= MUSIC_ARCHIVE_END_MONTH;
}

export async function getLocalMonthlyTop10ByDate(date: string): Promise<MonthlyTrendingRecord | null> {
  const month = parseMonthFromDate(date);
  if (!month || !isMonthWithinMusicArchive(month)) {
    return null;
  }

  try {
    const cache = await getArchiveCache();
    return cache.monthMap.get(month) ?? null;
  } catch {
    return null;
  }
}

export function clearMusicLocalArchiveCacheForTests(): void {
  pendingCache = null;
}
