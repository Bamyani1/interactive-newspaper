#!/usr/bin/env node

/* eslint-disable no-console */

import { createHash } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, stat, writeFile } from 'fs/promises';
import { createGunzip, createGzip } from 'zlib';
import { createInterface } from 'readline';
import { Readable } from 'stream';
import path from 'path';
import { once } from 'events';

const NOAA_STATIONS_URL = 'https://www.ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-stations.txt';
const NOAA_YEARLY_URL = (year) => `https://www.ncei.noaa.gov/pub/data/ghcn/daily/by_year/${year}.csv.gz`;
const OPEN_METEO_ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';

const START_DATE = '1950-01-01';
const END_DATE = '2000-12-31';
const START_YEAR = 1950;
const END_YEAR = 2000;
const TOTAL_DAYS = 18628;

const DELAWARE = {
  name: 'Delaware, Ohio',
  latitude: 40.2987,
  longitude: -83.0679,
};

const SUPPORTED_ELEMENTS = new Set(['TMAX', 'TMIN', 'PRCP']);

const ROOT = path.resolve(process.cwd(), 'public', 'data', 'weather', 'ohio');
const META_DIR = path.join(ROOT, 'meta');
const RAW_DIR = path.join(ROOT, 'raw', 'by-year');
const INDEX_DIR = path.join(ROOT, 'index');

function round2(value) {
  return Math.round(value * 100) / 100;
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dateToIso(date) {
  return date.toISOString().slice(0, 10);
}

function* eachDateInclusive(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    yield dateToIso(cursor);
  }
}

function countMetrics(record) {
  let count = 0;
  if (record.tmax_c != null) count += 1;
  if (record.tmin_c != null) count += 1;
  if (record.precip_mm != null) count += 1;
  return count;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

export function parseStationLine(line) {
  if (!line || line.length < 40) return null;

  const stationId = line.slice(0, 11).trim();
  const latitude = Number(line.slice(12, 20).trim());
  const longitude = Number(line.slice(21, 30).trim());
  const elevationRaw = line.slice(31, 37).trim();
  const state = line.slice(38, 40).trim();
  const name = line.slice(41, 71).trim();

  if (!stationId || !state || Number.isNaN(latitude) || Number.isNaN(longitude)) {
    return null;
  }

  const elevation = Number(elevationRaw);

  return {
    id: stationId,
    name,
    latitude,
    longitude,
    elevation: Number.isNaN(elevation) ? null : elevation,
    state,
    distance_to_delaware_km: round2(
      haversineKm(latitude, longitude, DELAWARE.latitude, DELAWARE.longitude),
    ),
  };
}

export function parseGhcndCsvLine(line) {
  const parts = line.split(',');
  if (parts.length < 7) {
    return null;
  }

  const stationId = parts[0]?.trim();
  const dateRaw = parts[1]?.trim();
  const element = parts[2]?.trim();
  const dataValueRaw = parts[3]?.trim();
  const mFlag = parts[4]?.trim() ?? '';
  const qFlag = parts[5]?.trim() ?? '';
  const sFlag = parts[6]?.trim() ?? '';

  if (!stationId || !dateRaw || !element || !dataValueRaw) {
    return null;
  }

  const numericValue = Number(dataValueRaw);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  const date = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
  if (!isIsoDate(date)) {
    return null;
  }

  return {
    stationId,
    date,
    element,
    dataValue: numericValue,
    mFlag,
    qFlag,
    sFlag,
  };
}

export function normalizeNoaaValue(element, dataValue) {
  if (dataValue === -9999) return null;
  if (element === 'TMAX' || element === 'TMIN') {
    return round2(dataValue / 10);
  }
  if (element === 'PRCP') {
    return round2(dataValue / 10);
  }
  return null;
}

function compareCandidate(left, right) {
  if (!right) return -1;

  if (left.completeness !== right.completeness) {
    return right.completeness - left.completeness;
  }

  const leftDistance = left.distanceToDelawareKm ?? Number.POSITIVE_INFINITY;
  const rightDistance = right.distanceToDelawareKm ?? Number.POSITIVE_INFINITY;

  if (leftDistance !== rightDistance) {
    return leftDistance - rightDistance;
  }

  return left.stationId.localeCompare(right.stationId);
}

export function selectBestDelawareStationRecord(records, stationMetaById) {
  let winner = null;

  for (const record of records) {
    const completeness = countMetrics(record);
    const stationMeta = stationMetaById.get(record.station_id) ?? null;

    const candidate = {
      ...record,
      completeness,
      distanceToDelawareKm: stationMeta?.distance_to_delaware_km ?? null,
    };

    if (winner == null || compareCandidate(candidate, winner) < 0) {
      winner = candidate;
    }
  }

  return winner;
}

function buildQualityFlag(parts) {
  return [`tmax:${parts.tmax}`, `tmin:${parts.tmin}`, `prcp:${parts.precip}`].join(';');
}

function createObservedRecord(date, stationId) {
  return {
    date,
    station_id: stationId,
    tmax_c: null,
    tmin_c: null,
    precip_mm: null,
    source: 'NOAA_GHCN_DAILY_ARCHIVE',
    source_station_id: stationId,
    quality_flag: null,
    is_estimated: false,
    raw: {
      origin: 'NOAA_GHCN_DAILY_BY_YEAR',
      elements: {},
    },
  };
}

function mergeMetric(record, parsedRow) {
  const value = normalizeNoaaValue(parsedRow.element, parsedRow.dataValue);
  if (value == null) {
    return;
  }

  if (parsedRow.qFlag) {
    return;
  }

  if (parsedRow.element === 'TMAX') {
    record.tmax_c = value;
  } else if (parsedRow.element === 'TMIN') {
    record.tmin_c = value;
  } else if (parsedRow.element === 'PRCP') {
    record.precip_mm = value;
  }

  record.raw.elements[parsedRow.element] = {
    m_flag: parsedRow.mFlag || null,
    q_flag: parsedRow.qFlag || null,
    s_flag: parsedRow.sFlag || null,
  };
}

async function readText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
}

async function readJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json();
}

async function fetchOpenMeteoFallbackSeries() {
  const params = new URLSearchParams({
    latitude: `${DELAWARE.latitude}`,
    longitude: `${DELAWARE.longitude}`,
    start_date: START_DATE,
    end_date: END_DATE,
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
    timezone: 'America/New_York',
  });

  const url = `${OPEN_METEO_ARCHIVE_URL}?${params.toString()}`;
  const payload = await readJson(url);

  const dates = payload?.daily?.time;
  const tmax = payload?.daily?.temperature_2m_max;
  const tmin = payload?.daily?.temperature_2m_min;
  const precip = payload?.daily?.precipitation_sum;

  if (!Array.isArray(dates) || !Array.isArray(tmax) || !Array.isArray(tmin) || !Array.isArray(precip)) {
    throw new Error('Open-Meteo fallback response missing required daily arrays.');
  }

  const byDate = new Map();

  for (let index = 0; index < dates.length; index += 1) {
    const date = dates[index];
    if (!isIsoDate(date)) continue;

    const maxValue = Number(tmax[index]);
    const minValue = Number(tmin[index]);
    const precipValue = Number(precip[index]);

    byDate.set(date, {
      tmax_c: Number.isFinite(maxValue) ? round2(maxValue) : null,
      tmin_c: Number.isFinite(minValue) ? round2(minValue) : null,
      precip_mm: Number.isFinite(precipValue) ? round2(precipValue) : null,
    });
  }

  if (byDate.size !== TOTAL_DAYS) {
    throw new Error(
      `Open-Meteo fallback day count mismatch. Expected ${TOTAL_DAYS}, got ${byDate.size}.`,
    );
  }

  return byDate;
}

async function fetchOhioStations() {
  const raw = await readText(NOAA_STATIONS_URL);
  const lines = raw.split(/\r?\n/);
  const stationMetaById = new Map();

  for (const line of lines) {
    const parsed = parseStationLine(line);
    if (!parsed || parsed.state !== 'OH') continue;
    stationMetaById.set(parsed.id, parsed);
  }

  return stationMetaById;
}

export function mergeWithFallback({ date, observedRecord, fallbackValues, mode }) {
  const observed = observedRecord ?? null;

  const tmaxObserved = observed?.tmax_c;
  const tminObserved = observed?.tmin_c;
  const precipObserved = observed?.precip_mm;

  const tmax = tmaxObserved ?? fallbackValues?.tmax_c ?? null;
  const tmin = tminObserved ?? fallbackValues?.tmin_c ?? null;
  const precip = precipObserved ?? fallbackValues?.precip_mm ?? null;

  const sources = {
    tmax: tmaxObserved != null ? 'OBS' : 'OPEN_METEO_FILL',
    tmin: tminObserved != null ? 'OBS' : 'OPEN_METEO_FILL',
    precip: precipObserved != null ? 'OBS' : 'OPEN_METEO_FILL',
  };

  const anyEstimated =
    sources.tmax === 'OPEN_METEO_FILL' ||
    sources.tmin === 'OPEN_METEO_FILL' ||
    sources.precip === 'OPEN_METEO_FILL';

  return {
    date,
    tmax_c: tmax,
    tmin_c: tmin,
    precip_mm: precip,
    source: 'NOAA_GHCN_DAILY_ARCHIVE',
    source_station_id: observed?.station_id ?? null,
    quality_flag: buildQualityFlag(sources),
    is_estimated: anyEstimated,
    raw: {
      mode,
      observed_station_id: observed?.station_id ?? null,
      observed_metric_count: observed ? countMetrics(observed) : 0,
      fallback_source: anyEstimated ? 'OPEN_METEO_ARCHIVE' : null,
    },
  };
}

export function recordsToSlimArchive(records) {
  if (records.length === 0) {
    throw new Error('Cannot build slim archive from empty records.');
  }

  return {
    start_date: records[0].date,
    end_date: records[records.length - 1].date,
    tmax_c: records.map((r) => r.tmax_c),
    tmin_c: records.map((r) => r.tmin_c),
    is_estimated: records.map((r) => (r.is_estimated ? '1' : '0')).join(''),
  };
}

async function writeNdjsonGz(records, outputFile) {
  const gzip = createGzip({ level: 9 });
  const writeStream = createWriteStream(outputFile);
  gzip.pipe(writeStream);

  for (const record of records) {
    gzip.write(`${JSON.stringify(record)}\n`);
  }

  gzip.end();
  await once(writeStream, 'finish');
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function parseYearRecords(year, ohioStationIds) {
  const url = NOAA_YEARLY_URL(year);
  const response = await fetch(url);

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }

  const gunzip = createGunzip();
  const input = Readable.fromWeb(response.body);
  input.pipe(gunzip);

  const rl = createInterface({ input: gunzip, crlfDelay: Infinity });

  const observedByStationDay = new Map();
  let totalLines = 0;
  let ohioElementRows = 0;

  for await (const line of rl) {
    totalLines += 1;
    const parsed = parseGhcndCsvLine(line);
    if (!parsed) continue;

    if (!ohioStationIds.has(parsed.stationId)) continue;
    if (!SUPPORTED_ELEMENTS.has(parsed.element)) continue;

    ohioElementRows += 1;

    const key = `${parsed.stationId}|${parsed.date}`;
    let observed = observedByStationDay.get(key);
    if (!observed) {
      observed = createObservedRecord(parsed.date, parsed.stationId);
      observedByStationDay.set(key, observed);
    }

    mergeMetric(observed, parsed);
  }

  const records = [...observedByStationDay.values()]
    .filter((record) => countMetrics(record) > 0)
    .sort((left, right) => {
      if (left.date !== right.date) return left.date.localeCompare(right.date);
      return left.station_id.localeCompare(right.station_id);
    });

  return {
    records,
    totalLines,
    ohioElementRows,
  };
}

function buildYearIndexes({ year, records, stationMetaById, fallbackByDate }) {
  const byDate = new Map();

  for (const record of records) {
    let list = byDate.get(record.date);
    if (!list) {
      list = [];
      byDate.set(record.date, list);
    }
    list.push(record);
  }

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const delaware = [];

  for (const date of eachDateInclusive(yearStart, yearEnd)) {
    if (date < START_DATE || date > END_DATE) continue;

    const observedForDate = byDate.get(date) ?? [];
    const best = selectBestDelawareStationRecord(observedForDate, stationMetaById);
    const fallback = fallbackByDate.get(date) ?? { tmax_c: null, tmin_c: null, precip_mm: null };

    const delawareRecord = mergeWithFallback({
      date,
      observedRecord: best
        ? {
            date: best.date,
            station_id: best.station_id,
            tmax_c: best.tmax_c,
            tmin_c: best.tmin_c,
            precip_mm: best.precip_mm,
          }
        : null,
      fallbackValues: fallback,
      mode: 'DELAWARE_NEAREST_BEST',
    });

    delaware.push(delawareRecord);
  }

  return { delaware };
}

async function ensureDirectories() {
  await mkdir(META_DIR, { recursive: true });
  await mkdir(RAW_DIR, { recursive: true });
  await mkdir(INDEX_DIR, { recursive: true });
}

async function writeJson(filePath, payload) {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function writeSlimArchive(filePath, archive) {
  await writeFile(filePath, JSON.stringify(archive), 'utf8');
}

function relativeFromRoot(filePath) {
  return path.relative(ROOT, filePath).replaceAll('\\', '/');
}

export async function buildOhioWeatherArchive() {
  console.log('Preparing directories...');
  await ensureDirectories();

  console.log('Fetching Ohio station metadata...');
  const stationMetaById = await fetchOhioStations();
  const ohioStationIds = new Set(stationMetaById.keys());

  console.log(`Loaded ${stationMetaById.size} Ohio stations.`);

  console.log('Fetching Open-Meteo fallback for 1950-2000...');
  const fallbackByDate = await fetchOpenMeteoFallbackSeries();
  console.log(`Loaded fallback series with ${fallbackByDate.size} days.`);

  const stationsOutPath = path.join(META_DIR, 'stations.json');
  const stationList = [...stationMetaById.values()].sort((left, right) => left.id.localeCompare(right.id));
  await writeJson(stationsOutPath, stationList);

  const delawareIndex = [];
  const rawFiles = [];

  for (let year = START_YEAR; year <= END_YEAR; year += 1) {
    console.log(`Processing year ${year}...`);

    const { records, totalLines, ohioElementRows } = await parseYearRecords(year, ohioStationIds);
    const rawPath = path.join(RAW_DIR, `${year}.ndjson.gz`);
    await writeNdjsonGz(records, rawPath);

    const stats = await stat(rawPath);
    const sha256 = await sha256File(rawPath);

    rawFiles.push({
      year,
      file: relativeFromRoot(rawPath),
      rows: records.length,
      source_lines_total: totalLines,
      source_rows_ohio_target_elements: ohioElementRows,
      bytes: stats.size,
      sha256,
    });

    const indexes = buildYearIndexes({
      year,
      records,
      stationMetaById,
      fallbackByDate,
    });

    delawareIndex.push(...indexes.delaware);

    console.log(
      `Year ${year} done: ${records.length.toLocaleString()} records, ${indexes.delaware.length} daily index rows.`,
    );
  }

  delawareIndex.sort((left, right) => left.date.localeCompare(right.date));

  if (delawareIndex.length !== TOTAL_DAYS) {
    throw new Error(
      `Daily index count mismatch: delaware=${delawareIndex.length}, expected=${TOTAL_DAYS}`,
    );
  }

  const delawareOutPath = path.join(INDEX_DIR, 'delaware-by-date-1950-2000.json');
  const slimArchive = recordsToSlimArchive(delawareIndex);
  await writeSlimArchive(delawareOutPath, slimArchive);

  const delawareSha = await sha256File(delawareOutPath);
  const delawareStat = await stat(delawareOutPath);

  const manifestPath = path.join(ROOT, 'manifest.json');
  const manifest = {
    generated_at: new Date().toISOString(),
    date_range: {
      start: START_DATE,
      end: END_DATE,
      days: TOTAL_DAYS,
    },
    location_defaults: {
      mode: 'DELAWARE_NEAREST_BEST',
      latitude: DELAWARE.latitude,
      longitude: DELAWARE.longitude,
      name: DELAWARE.name,
    },
    sources: {
      observed: 'NOAA_GHCN_DAILY_BY_YEAR',
      fallback: 'OPEN_METEO_ARCHIVE',
    },
    station_count: stationList.length,
    files: {
      stations: {
        file: relativeFromRoot(stationsOutPath),
        count: stationList.length,
      },
      raw_years: rawFiles,
      indexes: {
        delaware: {
          file: relativeFromRoot(delawareOutPath),
          rows: delawareIndex.length,
          bytes: delawareStat.size,
          sha256: delawareSha,
        },
      },
    },
  };

  await writeJson(manifestPath, manifest);

  console.log('Ohio weather archive build complete.');
  console.log(`Manifest: ${relativeFromRoot(manifestPath)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildOhioWeatherArchive().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
