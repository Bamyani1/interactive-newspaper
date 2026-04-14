#!/usr/bin/env node

/* eslint-disable no-console */

import { readFile, writeFile, unlink, stat } from 'fs/promises';
import path from 'path';
import { recordsToSlimArchive } from './build-ohio-weather-archive.mjs';

const INDEX_DIR = path.resolve(process.cwd(), 'public', 'data', 'weather', 'ohio', 'index');
const DELAWARE_PATH = path.join(INDEX_DIR, 'delaware-by-date-1950-2000.json');
const STATEWIDE_PATH = path.join(INDEX_DIR, 'statewide-by-date-1950-2000.json');

async function fileSizeBytes(filePath) {
  try {
    const s = await stat(filePath);
    return s.size;
  } catch {
    return 0;
  }
}

async function main() {
  const beforeBytes = await fileSizeBytes(DELAWARE_PATH);
  const beforeStateBytes = await fileSizeBytes(STATEWIDE_PATH);

  console.log(`Reading ${DELAWARE_PATH} (${(beforeBytes / 1024 / 1024).toFixed(2)} MB)...`);
  const raw = await readFile(DELAWARE_PATH, 'utf8');
  const records = JSON.parse(raw);

  if (!Array.isArray(records)) {
    throw new Error('Delaware archive is not an array — already converted?');
  }

  console.log(`Loaded ${records.length} records. Converting to slim format...`);
  const slim = recordsToSlimArchive(records);

  await writeFile(DELAWARE_PATH, JSON.stringify(slim), 'utf8');
  const afterBytes = await fileSizeBytes(DELAWARE_PATH);

  console.log(
    `Wrote slim delaware archive: ${(afterBytes / 1024).toFixed(1)} KB (was ${(beforeBytes / 1024 / 1024).toFixed(2)} MB).`,
  );

  if (beforeStateBytes > 0) {
    await unlink(STATEWIDE_PATH);
    console.log(
      `Deleted statewide archive (${(beforeStateBytes / 1024 / 1024).toFixed(2)} MB).`,
    );
  }

  const totalBefore = beforeBytes + beforeStateBytes;
  const reduction = totalBefore > 0 ? (1 - afterBytes / totalBefore) * 100 : 0;
  console.log(
    `Total: ${(totalBefore / 1024 / 1024).toFixed(2)} MB → ${(afterBytes / 1024).toFixed(1)} KB (${reduction.toFixed(1)}% reduction).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
