#!/usr/bin/env node

/* eslint-disable no-console */

import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { END_MONTH, START_MONTH } from './build-us-monthly-hot100-archive.mjs';

const ROOT = path.resolve(process.cwd(), 'public', 'data', 'music', 'us', 'hot100');
const INDEX_PATH = path.join(ROOT, 'index', 'monthly-top10-1958-2000.json');
const CATALOG_PATH = path.join(ROOT, 'index', 'tracks-catalog-1958-2000.json');
const MAP_PATH = path.join(ROOT, 'meta', 'youtube-map.json');

const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseArgs(argv) {
  const options = {
    startMonth: START_MONTH,
    endMonth: END_MONTH,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--start-month') {
      options.startMonth = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === '--end-month') {
      options.endMonth = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node scripts/music/verify-youtube-map.mjs [--start-month YYYY-MM] [--end-month YYYY-MM]',
      );
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!/^\d{4}-\d{2}$/.test(options.startMonth) || !/^\d{4}-\d{2}$/.test(options.endMonth)) {
    throw new Error('start/end month must be in YYYY-MM format.');
  }

  if (options.startMonth > options.endMonth) {
    throw new Error('start month must be <= end month.');
  }

  return options;
}

export async function verifyYoutubeMap() {
  const options = parseArgs(process.argv.slice(2));

  const [indexRaw, catalogRaw, mapRaw] = await Promise.all([
    readFile(INDEX_PATH, 'utf8'),
    readFile(CATALOG_PATH, 'utf8'),
    readFile(MAP_PATH, 'utf8'),
  ]);

  const index = JSON.parse(indexRaw);
  const catalog = JSON.parse(catalogRaw);
  const youtubeMap = JSON.parse(mapRaw);

  assert(Array.isArray(index), 'Monthly index must be an array.');
  assert(Array.isArray(catalog), 'Tracks catalog must be an array.');
  assert(youtubeMap && typeof youtubeMap === 'object' && !Array.isArray(youtubeMap), 'youtube-map.json must be an object.');

  const catalogIds = new Set(catalog.map((track) => track.track_id));

  let invalidTrackIdCount = 0;
  let invalidYoutubeIdCount = 0;
  for (const [trackId, youtubeId] of Object.entries(youtubeMap)) {
    if (!catalogIds.has(trackId)) {
      invalidTrackIdCount += 1;
    }
    if (typeof youtubeId !== 'string' || !YOUTUBE_ID_PATTERN.test(youtubeId)) {
      invalidYoutubeIdCount += 1;
    }
  }

  assert(invalidTrackIdCount === 0, `Found ${invalidTrackIdCount} mappings for unknown track IDs.`);
  assert(invalidYoutubeIdCount === 0, `Found ${invalidYoutubeIdCount} invalid YouTube IDs.`);

  const targetMonths = index.filter(
    (record) =>
      typeof record?.month === 'string' &&
      record.month >= options.startMonth &&
      record.month <= options.endMonth,
  );

  const targetTrackIds = new Set();
  const perMonthCoverage = [];

  for (const monthRecord of targetMonths) {
    const tracks = Array.isArray(monthRecord.tracks) ? monthRecord.tracks : [];
    let mappedCount = 0;

    for (const track of tracks) {
      if (!track || typeof track.track_id !== 'string') {
        continue;
      }

      targetTrackIds.add(track.track_id);
      const mapped = youtubeMap[track.track_id];
      if (typeof mapped === 'string' && mapped.length > 0) {
        mappedCount += 1;
      }
    }

    perMonthCoverage.push({
      month: monthRecord.month,
      mapped: mappedCount,
      total: tracks.length,
      coverage_percent: tracks.length > 0 ? Number(((mappedCount / tracks.length) * 100).toFixed(2)) : 0,
    });
  }

  const mappedTargetTrackCount = [...targetTrackIds].filter((trackId) => typeof youtubeMap[trackId] === 'string' && youtubeMap[trackId].length > 0).length;
  const overallCoverage = targetTrackIds.size > 0 ? Number(((mappedTargetTrackCount / targetTrackIds.size) * 100).toFixed(2)) : 0;

  const sortedMonths = [...perMonthCoverage].sort((left, right) => {
    if (left.coverage_percent !== right.coverage_percent) {
      return left.coverage_percent - right.coverage_percent;
    }
    return left.month.localeCompare(right.month);
  });

  console.log('YouTube map verification passed.');
  console.log(`Window: ${options.startMonth}..${options.endMonth}`);
  console.log(`Map entries: ${Object.keys(youtubeMap).length}`);
  console.log(`Unique top-10 tracks in window: ${targetTrackIds.size}`);
  console.log(`Mapped top-10 tracks in window: ${mappedTargetTrackCount}`);
  console.log(`Overall coverage: ${overallCoverage}%`);

  if (sortedMonths.length > 0) {
    const lowest = sortedMonths[0];
    const highest = sortedMonths[sortedMonths.length - 1];
    console.log(
      `Lowest month coverage: ${lowest.month} (${lowest.mapped}/${lowest.total}, ${lowest.coverage_percent}%)`,
    );
    console.log(
      `Highest month coverage: ${highest.month} (${highest.mapped}/${highest.total}, ${highest.coverage_percent}%)`,
    );
  }
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  verifyYoutubeMap().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
