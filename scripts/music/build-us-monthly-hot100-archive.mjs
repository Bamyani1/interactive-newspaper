#!/usr/bin/env node

/* eslint-disable no-console */

import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { gzipSync } from 'zlib';

export const SOURCE_URL =
  'https://raw.githubusercontent.com/utdata/rwd-billboard-data/main/data-out/hot-100-current.csv';
export const START_MONTH = '1958-08';
export const END_MONTH = '2000-12';
export const START_DATE = '1958-08-01';
export const END_DATE = '2000-12-31';
export const MONTH_COUNT = 509;
export const TOP_N = 10;
export const MUSIC_SOURCE = 'BILLBOARD_HOT100_MONTHLY_ARCHIVE';

const ROOT = path.resolve(process.cwd(), 'public', 'data', 'music', 'us', 'hot100');
const META_DIR = path.join(ROOT, 'meta');
const RAW_DIR = path.join(ROOT, 'raw');
const INDEX_DIR = path.join(ROOT, 'index');

const YOUTUBE_MAP_PATH = path.join(META_DIR, 'youtube-map.json');
const SNAPSHOT_CSV_GZ_PATH = path.join(RAW_DIR, 'hot-100-current.snapshot.csv.gz');
const MONTHLY_INDEX_PATH = path.join(INDEX_DIR, 'monthly-top10-1958-2000.json');
const TRACKS_CATALOG_PATH = path.join(INDEX_DIR, 'tracks-catalog-1958-2000.json');
const MANIFEST_PATH = path.join(ROOT, 'manifest.json');

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function isIsoWeekDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isIsoMonth(value) {
  return /^\d{4}-\d{2}$/.test(value);
}

export function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

export function computeWeeklyPoints(rank) {
  if (!Number.isInteger(rank) || rank < 1 || rank > 100) {
    return null;
  }

  return 101 - rank;
}

export function canonicalSongKey(title, performer) {
  const normalizedTitle = normalizeWhitespace(title).toLowerCase();
  const normalizedPerformer = normalizeWhitespace(performer).toLowerCase();
  return `${normalizedTitle}|${normalizedPerformer}`;
}

export function toTrackId(songKey) {
  return createHash('sha1').update(songKey).digest('hex').slice(0, 16);
}

export function parseHot100CsvRow(row) {
  const chartWeek = normalizeWhitespace(row.chart_week || '');
  const title = normalizeWhitespace(row.title || '');
  const performer = normalizeWhitespace(row.performer || '');
  const rank = Number(normalizeWhitespace(row.current_week || ''));

  if (!isIsoWeekDate(chartWeek) || !title || !performer || !Number.isInteger(rank)) {
    return null;
  }

  const points = computeWeeklyPoints(rank);
  if (points == null) {
    return null;
  }

  const month = chartWeek.slice(0, 7);
  if (!isIsoMonth(month)) {
    return null;
  }

  return {
    chart_week: chartWeek,
    month,
    title,
    performer,
    rank,
    points,
    song_key: canonicalSongKey(title, performer),
  };
}

export function compareMonthlyAggregates(left, right) {
  if (left.points_total !== right.points_total) {
    return right.points_total - left.points_total;
  }

  if (left.best_rank !== right.best_rank) {
    return left.best_rank - right.best_rank;
  }

  if (left.weeks_present !== right.weeks_present) {
    return right.weeks_present - left.weeks_present;
  }

  const performerCmp = left.performer.localeCompare(right.performer);
  if (performerCmp !== 0) {
    return performerCmp;
  }

  return left.title.localeCompare(right.title);
}

export function rankMonthlyTop10(entries, topN = TOP_N) {
  return [...entries]
    .sort(compareMonthlyAggregates)
    .slice(0, topN)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

function listMonthsInclusive(startMonth, endMonth) {
  const [startYear, startMonthNum] = startMonth.split('-').map(Number);
  const [endYear, endMonthNum] = endMonth.split('-').map(Number);

  const output = [];
  let year = startYear;
  let month = startMonthNum;

  while (year < endYear || (year === endYear && month <= endMonthNum)) {
    output.push(`${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}`);
    month += 1;
    if (month === 13) {
      year += 1;
      month = 1;
    }
  }

  return output;
}

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function loadYoutubeMap() {
  if (!existsSync(YOUTUBE_MAP_PATH)) {
    return {};
  }

  const raw = await readFile(YOUTUBE_MAP_PATH, 'utf8');
  const parsed = JSON.parse(raw);

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed;
  }

  throw new Error(`Invalid youtube map at ${YOUTUBE_MAP_PATH}; expected object map of track_id -> youtubeId.`);
}

async function describeFile(filePath) {
  const buffer = await readFile(filePath);
  return {
    path: path.relative(ROOT, filePath).replace(/\\/g, '/'),
    size_bytes: buffer.length,
    sha256: sha256Buffer(buffer),
  };
}

function ensureRequiredColumns(headers) {
  const normalizedHeaders = headers.map((header) => normalizeWhitespace(header.replace(/^\uFEFF/, '')));
  const required = ['chart_week', 'current_week', 'title', 'performer'];

  const indexes = {};
  for (const name of required) {
    const index = normalizedHeaders.indexOf(name);
    if (index === -1) {
      throw new Error(`Source CSV missing required column: ${name}`);
    }
    indexes[name] = index;
  }

  return indexes;
}

function buildRowFromColumns(columns, indexes) {
  return {
    chart_week: columns[indexes.chart_week] ?? '',
    current_week: columns[indexes.current_week] ?? '',
    title: columns[indexes.title] ?? '',
    performer: columns[indexes.performer] ?? '',
  };
}

export async function buildUsMonthlyHot100Archive() {
  await mkdir(META_DIR, { recursive: true });
  await mkdir(RAW_DIR, { recursive: true });
  await mkdir(INDEX_DIR, { recursive: true });

  const response = await fetch(SOURCE_URL, {
    headers: {
      'User-Agent': 'transcript-archive/0.1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download Hot 100 source CSV (${response.status}) from ${SOURCE_URL}`);
  }

  const csvText = await response.text();
  const youtubeByTrackId = await loadYoutubeMap();

  const lines = csvText.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length < 2) {
    throw new Error('Source CSV appears empty.');
  }

  const headers = parseCsvLine(lines[0]);
  const indexes = ensureRequiredColumns(headers);

  const monthlySongStats = new Map();
  const weeklyDatesByMonth = new Map();
  let sourceRowsInRange = 0;

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const parsedColumns = parseCsvLine(lines[lineIndex]);
    const parsedRow = parseHot100CsvRow(buildRowFromColumns(parsedColumns, indexes));
    if (!parsedRow) {
      continue;
    }

    if (parsedRow.month < START_MONTH || parsedRow.month > END_MONTH) {
      continue;
    }

    sourceRowsInRange += 1;

    const monthlyWeeks = weeklyDatesByMonth.get(parsedRow.month) ?? new Set();
    monthlyWeeks.add(parsedRow.chart_week);
    weeklyDatesByMonth.set(parsedRow.month, monthlyWeeks);

    const songsForMonth = monthlySongStats.get(parsedRow.month) ?? new Map();
    const existing = songsForMonth.get(parsedRow.song_key) ?? {
      track_id: toTrackId(parsedRow.song_key),
      title: parsedRow.title,
      performer: parsedRow.performer,
      points_total: 0,
      best_rank: 1000,
      weeks_present: 0,
    };

    existing.points_total += parsedRow.points;
    existing.best_rank = Math.min(existing.best_rank, parsedRow.rank);
    existing.weeks_present += 1;

    songsForMonth.set(parsedRow.song_key, existing);
    monthlySongStats.set(parsedRow.month, songsForMonth);
  }

  const months = listMonthsInclusive(START_MONTH, END_MONTH);
  if (months.length !== MONTH_COUNT) {
    throw new Error(`Expected ${MONTH_COUNT} months in range but built ${months.length}.`);
  }

  const monthlyIndex = [];
  const catalogByTrackId = new Map();

  for (const month of months) {
    const songsForMonth = monthlySongStats.get(month);
    if (!songsForMonth || songsForMonth.size < TOP_N) {
      throw new Error(`Insufficient data for month ${month}; expected at least ${TOP_N} unique songs.`);
    }

    const ranked = rankMonthlyTop10([...songsForMonth.values()], TOP_N);

    for (const song of songsForMonth.values()) {
      if (!catalogByTrackId.has(song.track_id)) {
        const youtubeIdRaw = youtubeByTrackId[song.track_id];
        catalogByTrackId.set(song.track_id, {
          track_id: song.track_id,
          title: song.title,
          artist: song.performer,
          youtubeId: typeof youtubeIdRaw === 'string' && youtubeIdRaw.trim().length > 0
            ? youtubeIdRaw.trim()
            : null,
        });
      }
    }

    monthlyIndex.push({
      month,
      source: MUSIC_SOURCE,
      tracks: ranked.map((song) => ({
        rank: song.rank,
        track_id: song.track_id,
        points_total: song.points_total,
        best_rank: song.best_rank,
        weeks_present: song.weeks_present,
      })),
      raw: {
        scoring: 'POINTS_100_TO_1',
        weeks_in_month: weeklyDatesByMonth.get(month)?.size ?? 0,
        candidate_song_count: songsForMonth.size,
      },
    });
  }

  const tracksCatalog = [...catalogByTrackId.values()].sort((a, b) => a.track_id.localeCompare(b.track_id));

  const snapshotCsvGz = gzipSync(Buffer.from(csvText, 'utf8'));
  await writeFile(SNAPSHOT_CSV_GZ_PATH, snapshotCsvGz);
  await writeFile(MONTHLY_INDEX_PATH, JSON.stringify(monthlyIndex, null, 2));
  await writeFile(TRACKS_CATALOG_PATH, JSON.stringify(tracksCatalog, null, 2));

  const manifest = {
    generated_at: new Date().toISOString(),
    source: {
      name: 'UTData Billboard Hot 100 current archive',
      url: SOURCE_URL,
      response_url: response.url,
      status: response.status,
      etag: response.headers.get('etag'),
      last_modified: response.headers.get('last-modified'),
    },
    range: {
      start_date: START_DATE,
      end_date: END_DATE,
      start_month: START_MONTH,
      end_month: END_MONTH,
      month_count: months.length,
    },
    totals: {
      source_rows_in_range: sourceRowsInRange,
      monthly_entry_count: months.length * TOP_N,
      unique_tracks_in_catalog: tracksCatalog.length,
    },
    files: {
      snapshot_csv_gz: await describeFile(SNAPSHOT_CSV_GZ_PATH),
      monthly_index_json: await describeFile(MONTHLY_INDEX_PATH),
      tracks_catalog_json: await describeFile(TRACKS_CATALOG_PATH),
    },
  };

  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  console.log('US monthly Hot 100 archive build complete.');
  console.log(`Months: ${months.length}`);
  console.log(`Monthly entries: ${months.length * TOP_N}`);
  console.log(`Catalog tracks: ${tracksCatalog.length}`);

  return {
    monthCount: months.length,
    monthlyEntryCount: months.length * TOP_N,
    uniqueTracks: tracksCatalog.length,
  };
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  buildUsMonthlyHot100Archive().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
