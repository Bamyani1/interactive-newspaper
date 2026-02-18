#!/usr/bin/env node

/* eslint-disable no-console */

import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  END_MONTH,
  MONTH_COUNT,
  MUSIC_SOURCE,
  START_MONTH,
  TOP_N,
} from './build-us-monthly-hot100-archive.mjs';

const ROOT = path.resolve(process.cwd(), 'public', 'data', 'music', 'us', 'hot100');
const INDEX_PATH = path.join(ROOT, 'index', 'monthly-top10-1958-2000.json');
const CATALOG_PATH = path.join(ROOT, 'index', 'tracks-catalog-1958-2000.json');
const MANIFEST_PATH = path.join(ROOT, 'manifest.json');

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

async function sha256File(filePath) {
  const buffer = await readFile(filePath);
  return {
    sha256: createHash('sha256').update(buffer).digest('hex'),
    size_bytes: buffer.length,
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export async function verifyUsMonthlyHot100Archive() {
  const [indexRaw, catalogRaw, manifestRaw] = await Promise.all([
    readFile(INDEX_PATH, 'utf8'),
    readFile(CATALOG_PATH, 'utf8'),
    readFile(MANIFEST_PATH, 'utf8'),
  ]);

  const index = JSON.parse(indexRaw);
  const catalog = JSON.parse(catalogRaw);
  const manifest = JSON.parse(manifestRaw);

  assert(Array.isArray(index), 'Monthly index must be an array.');
  assert(Array.isArray(catalog), 'Track catalog must be an array.');

  const expectedMonths = listMonthsInclusive(START_MONTH, END_MONTH);
  assert(expectedMonths.length === MONTH_COUNT, `Expected ${MONTH_COUNT} months in range.`);
  assert(index.length === MONTH_COUNT, `Monthly index should have ${MONTH_COUNT} records.`);

  const monthsFromIndex = index.map((record) => record.month);
  assert(monthsFromIndex[0] === START_MONTH, `First month must be ${START_MONTH}.`);
  assert(monthsFromIndex[monthsFromIndex.length - 1] === END_MONTH, `Last month must be ${END_MONTH}.`);

  for (let i = 0; i < expectedMonths.length; i += 1) {
    assert(monthsFromIndex[i] === expectedMonths[i], `Month mismatch at index ${i}: expected ${expectedMonths[i]}, got ${monthsFromIndex[i]}.`);
  }

  const catalogIds = new Set(catalog.map((item) => item.track_id));

  for (const monthlyRecord of index) {
    assert(monthlyRecord.source === MUSIC_SOURCE, `Unexpected source for ${monthlyRecord.month}.`);
    assert(Array.isArray(monthlyRecord.tracks), `Tracks list missing for ${monthlyRecord.month}.`);
    assert(monthlyRecord.tracks.length === TOP_N, `Expected ${TOP_N} tracks for ${monthlyRecord.month}.`);

    const rankSet = new Set();

    for (const track of monthlyRecord.tracks) {
      assert(typeof track.track_id === 'string' && track.track_id.length > 0, `Missing track_id in ${monthlyRecord.month}.`);
      assert(Number.isInteger(track.rank), `Invalid rank in ${monthlyRecord.month}.`);
      assert(track.rank >= 1 && track.rank <= TOP_N, `Out-of-range rank in ${monthlyRecord.month}.`);
      rankSet.add(track.rank);
      assert(catalogIds.has(track.track_id), `Track ${track.track_id} in ${monthlyRecord.month} is missing from catalog.`);
    }

    assert(rankSet.size === TOP_N, `Duplicate ranks found in ${monthlyRecord.month}.`);
  }

  assert(manifest?.range?.start_month === START_MONTH, 'Manifest start_month mismatch.');
  assert(manifest?.range?.end_month === END_MONTH, 'Manifest end_month mismatch.');
  assert(manifest?.range?.month_count === MONTH_COUNT, 'Manifest month_count mismatch.');

  const fileChecks = [
    {
      filePath: path.join(ROOT, manifest?.files?.snapshot_csv_gz?.path ?? ''),
      expectedSha: manifest?.files?.snapshot_csv_gz?.sha256,
      expectedSize: manifest?.files?.snapshot_csv_gz?.size_bytes,
      key: 'snapshot_csv_gz',
    },
    {
      filePath: path.join(ROOT, manifest?.files?.monthly_index_json?.path ?? ''),
      expectedSha: manifest?.files?.monthly_index_json?.sha256,
      expectedSize: manifest?.files?.monthly_index_json?.size_bytes,
      key: 'monthly_index_json',
    },
    {
      filePath: path.join(ROOT, manifest?.files?.tracks_catalog_json?.path ?? ''),
      expectedSha: manifest?.files?.tracks_catalog_json?.sha256,
      expectedSize: manifest?.files?.tracks_catalog_json?.size_bytes,
      key: 'tracks_catalog_json',
    },
  ];

  for (const check of fileChecks) {
    assert(typeof check.expectedSha === 'string' && check.expectedSha.length > 0, `Manifest checksum missing for ${check.key}.`);
    assert(Number.isInteger(check.expectedSize), `Manifest size missing for ${check.key}.`);

    const actual = await sha256File(check.filePath);
    assert(actual.sha256 === check.expectedSha, `Checksum mismatch for ${check.key}.`);
    assert(actual.size_bytes === check.expectedSize, `Size mismatch for ${check.key}.`);
  }

  console.log('US monthly Hot 100 archive verification passed.');
  console.log(`Months: ${MONTH_COUNT}`);
  console.log(`Catalog tracks: ${catalog.length}`);
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  verifyUsMonthlyHot100Archive().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
