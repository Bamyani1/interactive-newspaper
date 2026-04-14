#!/usr/bin/env node

/* eslint-disable no-console */

import { access, readFile } from 'fs/promises';
import path from 'path';

const ROOT = path.resolve(process.cwd(), 'public', 'data', 'weather', 'ohio');
const INDEX_DIR = path.join(ROOT, 'index');
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

function validateSlimArchive(archive) {
  assert(archive && typeof archive === 'object', 'Archive must be an object.');
  assert(archive.start_date === START_DATE, `start_date mismatch: ${archive.start_date}`);
  assert(archive.end_date === END_DATE, `end_date mismatch: ${archive.end_date}`);
  assert(Array.isArray(archive.tmax_c), 'tmax_c must be an array.');
  assert(Array.isArray(archive.tmin_c), 'tmin_c must be an array.');
  assert(typeof archive.is_estimated === 'string', 'is_estimated must be a string.');
  assert(archive.tmax_c.length === EXPECTED_DAYS, `tmax_c length mismatch: ${archive.tmax_c.length}`);
  assert(archive.tmin_c.length === EXPECTED_DAYS, `tmin_c length mismatch: ${archive.tmin_c.length}`);
  assert(archive.is_estimated.length === EXPECTED_DAYS, `is_estimated length mismatch: ${archive.is_estimated.length}`);

  for (let i = 0; i < EXPECTED_DAYS; i += 1) {
    assert(
      typeof archive.tmax_c[i] === 'number' || archive.tmax_c[i] === null,
      `tmax_c[${i}] invalid`,
    );
    assert(
      typeof archive.tmin_c[i] === 'number' || archive.tmin_c[i] === null,
      `tmin_c[${i}] invalid`,
    );
    const flag = archive.is_estimated[i];
    assert(flag === '0' || flag === '1', `is_estimated[${i}] must be '0' or '1'`);
  }
}

async function verify() {
  const delawarePath = path.join(INDEX_DIR, 'delaware-by-date-1950-2000.json');
  await access(delawarePath);

  const archive = await readJson(delawarePath);
  validateSlimArchive(archive);

  console.log('Ohio weather archive verification passed.');
  console.log(`Dates: ${EXPECTED_DAYS}`);
}

verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
