#!/usr/bin/env node

/* eslint-disable no-console */

import { access, readFile } from 'fs/promises';
import path from 'path';

const ROOT = path.resolve(process.cwd(), 'public', 'data', 'weather', 'ohio');
const INDEX_DIR = path.join(ROOT, 'index');
const META_DIR = path.join(ROOT, 'meta');
const START_DATE = '1950-01-01';
const END_DATE = '2000-12-31';
const EXPECTED_DAYS = 18628;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function* eachDateInclusive(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    yield cursor.toISOString().slice(0, 10);
  }
}

function validateIndex(name, records) {
  assert(Array.isArray(records), `${name} index must be an array.`);
  assert(records.length === EXPECTED_DAYS, `${name} index length mismatch: ${records.length}`);
  assert(records[0]?.date === START_DATE, `${name} index first date mismatch.`);
  assert(records[records.length - 1]?.date === END_DATE, `${name} index last date mismatch.`);

  const byDate = new Map(records.map((record) => [record.date, record]));
  assert(byDate.size === EXPECTED_DAYS, `${name} index contains duplicate dates.`);

  for (const date of eachDateInclusive(START_DATE, END_DATE)) {
    assert(byDate.has(date), `${name} index missing date ${date}`);
    const record = byDate.get(date);
    assert(typeof record.tmax_c === 'number' || record.tmax_c === null, `${name} ${date} invalid tmax_c`);
    assert(typeof record.tmin_c === 'number' || record.tmin_c === null, `${name} ${date} invalid tmin_c`);
    assert(typeof record.precip_mm === 'number' || record.precip_mm === null, `${name} ${date} invalid precip_mm`);
  }
}

async function verify() {
  const manifestPath = path.join(ROOT, 'manifest.json');
  const stationsPath = path.join(META_DIR, 'stations.json');
  const delawarePath = path.join(INDEX_DIR, 'delaware-by-date-1950-2000.json');
  const statewidePath = path.join(INDEX_DIR, 'statewide-by-date-1950-2000.json');

  await access(manifestPath);
  await access(stationsPath);
  await access(delawarePath);
  await access(statewidePath);

  const [manifest, stations, delaware, statewide] = await Promise.all([
    readJson(manifestPath),
    readJson(stationsPath),
    readJson(delawarePath),
    readJson(statewidePath),
  ]);

  assert(manifest?.date_range?.start === START_DATE, 'Manifest start date mismatch.');
  assert(manifest?.date_range?.end === END_DATE, 'Manifest end date mismatch.');
  assert(manifest?.date_range?.days === EXPECTED_DAYS, 'Manifest day count mismatch.');

  assert(Array.isArray(stations), 'Stations metadata must be an array.');
  assert(stations.length > 0, 'Stations metadata is empty.');

  validateIndex('delaware', delaware);
  validateIndex('statewide', statewide);

  const sample = delaware.find((record) => record.date === '1988-10-12');
  assert(Boolean(sample), 'Expected sample date 1988-10-12 in delaware index.');

  console.log('Ohio weather archive verification passed.');
  console.log(`Stations: ${stations.length}`);
  console.log(`Dates: ${EXPECTED_DAYS}`);
}

verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
