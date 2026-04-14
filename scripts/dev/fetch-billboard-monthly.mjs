#!/usr/bin/env node

/* eslint-disable no-console */

/**
 * Fetches Billboard Hot 100 weekly chart data and reduces it to one
 * top-10 list per month for the year ranges this archive cares about.
 *
 * Source: utdata/rwd-billboard-data on GitHub — a maintained CSV mirror
 * of every Billboard Hot 100 weekly chart from 1958-08-04 onward.
 *
 * Output: scripts/dev/data/billboard-monthly-raw.json
 *   { months: [{ year, month, chartDate, tracks: [{rank, title, artist}, ...10] }] }
 *
 * Pre-1958-08 months (Hot 100 didn't exist yet) are skipped — those
 * become null entries in the final packed archive.
 *
 * The script is resumable: if the output file exists, months already
 * present are kept. Re-run after editing date ranges to top up.
 */

import { readFile, writeFile, mkdir, stat } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const DEV_DATA_DIR = path.resolve(process.cwd(), "scripts/dev/data");
const CSV_CACHE = path.join(DEV_DATA_DIR, "hot100-archive.csv");
const OUTPUT_FILE = path.join(DEV_DATA_DIR, "billboard-monthly-raw.json");
const CSV_URL =
  "https://raw.githubusercontent.com/utdata/rwd-billboard-data/main/data-out/hot100_archive_1958_2021.csv";

// Ranges this run will fill. The build script prefers the existing
// chart-1960-2000.json over re-fetched data, so it is safe to ask for
// the full 1958-08..2010 span — only slots the old archive left null
// (e.g. 1969-11 and 1969-12) will be backfilled.
const RANGES = [
  { startYear: 1950, startMonth: 1, endYear: 2010, endMonth: 12 },
];
const HOT100_MIN_DATE = "1958-08-04"; // first ever Hot 100

async function ensureCsvDownloaded() {
  await mkdir(DEV_DATA_DIR, { recursive: true });
  if (existsSync(CSV_CACHE)) {
    const s = await stat(CSV_CACHE);
    console.log(`Using cached CSV (${(s.size / 1024 / 1024).toFixed(1)} MB) at ${CSV_CACHE}`);
    return;
  }
  console.log(`Downloading Hot 100 archive CSV from ${CSV_URL}`);
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`Failed to download CSV: ${res.status} ${res.statusText}`);
  const text = await res.text();
  await writeFile(CSV_CACHE, text, "utf8");
  console.log(`Cached ${(text.length / 1024 / 1024).toFixed(1)} MB`);
}

// CSV parser that handles quoted fields containing commas.
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else if (ch === '"') {
      inQuotes = true;
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Returns a map: chartDate (YYYY-MM-DD) → array of top-10 entries
 * { rank, title, artist }.
 */
async function loadHot100ByDate() {
  const text = await readFile(CSV_CACHE, "utf8");
  const lines = text.split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  const idxDate = header.indexOf("chart_date");
  const idxRank = header.indexOf("current_position");
  const idxTitle = header.indexOf("title");
  const idxPerformer = header.indexOf("performer");
  if (idxDate < 0 || idxRank < 0 || idxTitle < 0 || idxPerformer < 0) {
    throw new Error(`CSV header missing expected columns: ${header.join(",")}`);
  }

  const byDate = new Map();
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const cols = parseCsvLine(line);
    const rank = Number(cols[idxRank]);
    if (!Number.isFinite(rank) || rank < 1 || rank > 10) continue; // top 10 only
    const date = cols[idxDate];
    const title = cols[idxTitle];
    const artist = cols[idxPerformer];
    if (!date || !title || !artist) continue;
    let bucket = byDate.get(date);
    if (!bucket) {
      bucket = [];
      byDate.set(date, bucket);
    }
    bucket.push({ rank, title, artist });
  }

  // Sort each chart by rank for safety.
  for (const tracks of byDate.values()) {
    tracks.sort((a, b) => a.rank - b.rank);
  }
  return byDate;
}

function* iterateMonths() {
  for (const r of RANGES) {
    let y = r.startYear;
    let m = r.startMonth;
    while (y < r.endYear || (y === r.endYear && m <= r.endMonth)) {
      yield { year: y, month: m };
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  }
}

function pickClosestChart(year, month, byDate) {
  const target = new Date(Date.UTC(year, month - 1, 15));
  let best = null;
  let bestDiff = Infinity;
  for (const dateStr of byDate.keys()) {
    if (!dateStr.startsWith(`${year}-${String(month).padStart(2, "0")}`)) continue;
    const d = new Date(`${dateStr}T00:00:00Z`);
    const diff = Math.abs(d.getTime() - target.getTime());
    if (diff < bestDiff) {
      bestDiff = diff;
      best = dateStr;
    }
  }
  return best;
}

async function main() {
  await ensureCsvDownloaded();
  const byDate = await loadHot100ByDate();
  console.log(`Loaded top-10 entries for ${byDate.size} chart weeks.`);

  let existing = { months: [] };
  if (existsSync(OUTPUT_FILE)) {
    try {
      existing = JSON.parse(await readFile(OUTPUT_FILE, "utf8"));
    } catch {
      // Treat unreadable file as empty.
    }
  }
  const haveKey = new Set(existing.months.map((m) => `${m.year}-${m.month}`));

  let added = 0;
  let skippedHaveData = 0;
  let skippedNoChart = 0;

  for (const { year, month } of iterateMonths()) {
    const key = `${year}-${month}`;
    if (haveKey.has(key)) {
      skippedHaveData += 1;
      continue;
    }
    const monthStartIso = `${year}-${String(month).padStart(2, "0")}-01`;
    if (monthStartIso < HOT100_MIN_DATE.slice(0, 7) + "-01") {
      skippedNoChart += 1;
      continue;
    }
    const chartDate = pickClosestChart(year, month, byDate);
    if (!chartDate) {
      console.warn(`  ${key}: no chart found`);
      skippedNoChart += 1;
      continue;
    }
    const tracks = byDate.get(chartDate);
    if (!tracks || tracks.length < 10) {
      console.warn(`  ${key}: chart ${chartDate} only has ${tracks?.length ?? 0} tracks`);
      skippedNoChart += 1;
      continue;
    }
    existing.months.push({
      year,
      month,
      chartDate,
      tracks: tracks.slice(0, 10),
    });
    added += 1;
  }

  existing.months.sort((a, b) => a.year - b.year || a.month - b.month);
  await writeFile(OUTPUT_FILE, JSON.stringify(existing, null, 2), "utf8");

  console.log(`\nDone.`);
  console.log(`  Added:   ${added} months`);
  console.log(`  Already: ${skippedHaveData} months`);
  console.log(`  Skipped: ${skippedNoChart} months (pre-1958-08 or missing data)`);
  console.log(`  Total in file: ${existing.months.length} months`);
  console.log(`  Wrote ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
