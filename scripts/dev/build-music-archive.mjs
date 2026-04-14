#!/usr/bin/env node

/* eslint-disable no-console */

/**
 * Merges the existing chart-1960-2000.json with the freshly enriched
 * billboard-monthly-raw.json (1958-08..1959 + 2001..2010) and writes a
 * single packed archive at chart-1950-2010.json.
 *
 * Existing 1960-2000 tuples pass through unchanged — this script
 * never re-derives them.
 *
 * Usage: node scripts/dev/build-music-archive.mjs
 */

import { readFile, writeFile, unlink, stat } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const ROOT = process.cwd();
const OLD_ARCHIVE = path.join(ROOT, "public/top-10-music/chart-1960-2000.json");
const NEW_ARCHIVE = path.join(ROOT, "public/top-10-music/chart-1950-2010.json");
const RAW_FILE = path.join(ROOT, "scripts/dev/data/billboard-monthly-raw.json");

const START_YEAR = 1950;
const END_YEAR = 2010;
const TOTAL_MONTHS = (END_YEAR - START_YEAR + 1) * 12;
const TRACKS_PER_MONTH = 10;

function monthIndex(year, month) {
  return (year - START_YEAR) * 12 + (month - 1);
}

function validateTuple(tuple, ctx) {
  if (!Array.isArray(tuple) || tuple.length !== 3) {
    throw new Error(`${ctx}: tuple is not [title, artist, ytid]: ${JSON.stringify(tuple)}`);
  }
  const [title, artist, ytid] = tuple;
  if (typeof title !== "string" || typeof artist !== "string" || typeof ytid !== "string") {
    throw new Error(`${ctx}: tuple has non-string field: ${JSON.stringify(tuple)}`);
  }
}

async function main() {
  // 1) Existing 1960-2000 archive
  if (!existsSync(OLD_ARCHIVE)) {
    throw new Error(`Missing existing archive: ${OLD_ARCHIVE}`);
  }
  const old = JSON.parse(await readFile(OLD_ARCHIVE, "utf8"));
  if (!Array.isArray(old.months) || old.months.length !== 41 * 12) {
    throw new Error(
      `Old archive has unexpected month count: ${old.months?.length}, expected ${41 * 12}`,
    );
  }
  console.log(`Loaded old archive: ${old.months.length} months (${old.start} → ${old.end})`);

  // 2) Raw fetched data with YouTube IDs
  if (!existsSync(RAW_FILE)) {
    throw new Error(`Missing raw fetched data: ${RAW_FILE} (run fetch-billboard-monthly.mjs first)`);
  }
  const raw = JSON.parse(await readFile(RAW_FILE, "utf8"));
  console.log(`Loaded raw fetched data: ${raw.months.length} months`);

  // 3) Initialize the new months array
  const months = new Array(TOTAL_MONTHS).fill(null);

  // 4) Copy old archive into the right slots (1960-01 starts at index (1960-1950)*12 = 120)
  let copied = 0;
  for (let i = 0; i < old.months.length; i += 1) {
    const year = 1960 + Math.floor(i / 12);
    const month = (i % 12) + 1;
    const tuples = old.months[i];
    if (tuples != null) {
      tuples.forEach((t) => validateTuple(t, `old ${year}-${month}`));
      months[monthIndex(year, month)] = tuples;
      copied += 1;
    }
  }
  console.log(`Copied ${copied} months from old archive (1960-2000).`);

  // 5) Merge in the new fetched months (1958-08..1959, 2001..2010)
  let merged = 0;
  let withId = 0;
  let withoutId = 0;
  for (const m of raw.months) {
    if (m.year < START_YEAR || m.year > END_YEAR) continue;
    if (!Array.isArray(m.tracks) || m.tracks.length < TRACKS_PER_MONTH) continue;
    const tuples = m.tracks.slice(0, TRACKS_PER_MONTH).map((t) => {
      const tuple = [String(t.title ?? ""), String(t.artist ?? ""), String(t.youtube_id ?? "")];
      if (tuple[2]) withId += 1;
      else withoutId += 1;
      return tuple;
    });
    tuples.forEach((t) => validateTuple(t, `new ${m.year}-${m.month}`));
    const idx = monthIndex(m.year, m.month);
    if (months[idx] != null) {
      // Don't clobber existing data; old archive wins.
      continue;
    }
    months[idx] = tuples;
    merged += 1;
  }
  console.log(`Merged ${merged} new months. Tracks with YT id: ${withId}, without: ${withoutId}.`);

  // 6) Final summary
  const filled = months.filter((m) => m != null).length;
  const empty = months.filter((m) => m == null).length;
  console.log(`Final: ${filled} months filled, ${empty} months null.`);

  const archive = {
    start: `${START_YEAR}-01`,
    end: `${END_YEAR}-12`,
    months,
  };
  await writeFile(NEW_ARCHIVE, JSON.stringify(archive), "utf8");
  const s = await stat(NEW_ARCHIVE);
  console.log(`Wrote ${NEW_ARCHIVE} (${(s.size / 1024).toFixed(1)} KB).`);

  // 7) Remove the now-superseded old archive
  await unlink(OLD_ARCHIVE);
  console.log(`Removed ${OLD_ARCHIVE}.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
