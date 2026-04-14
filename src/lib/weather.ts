import { createHash } from 'crypto';
import type { DailyWeatherRecord, WeatherQuery } from '@/src/types';

const NOAA_DAILY_SUMMARIES_URL = 'https://www.ncei.noaa.gov/access/services/data/v1';
const ACIS_STN_META_URL = 'https://data.rcc-acis.org/StnMeta';
const ACIS_STN_DATA_URL = 'https://data.rcc-acis.org/StnData';
const OPEN_METEO_ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';

export interface NormalizedWeatherQuery {
  date: string;
  location_name: string;
  lat: number;
  lon: number;
  state: string;
  country: string;
  station_id?: string;
  force_fallback: boolean;
}

export interface WeatherLookupResult {
  query: NormalizedWeatherQuery;
  record: DailyWeatherRecord | null;
  reason: 'INVALID_DATE' | 'NO_DATA' | null;
  attempts: string[];
}

export interface WeatherLookupOptions {
  fetcher?: Fetcher;
  maxStationCandidates?: number;
}

export interface WeatherRangeQuery {
  start_date: string;
  end_date: string;
  location_name?: string;
  lat?: number;
  lon?: number;
  state?: string;
  country?: string;
  station_id?: string;
  force_fallback?: boolean;
}

export interface WeatherRangeResult {
  start_date: string;
  end_date: string;
  total_days: number;
  populated_days: number;
  missing_days: number;
  missing_day_percentage: number;
  records: Array<{
    date: string;
    record: DailyWeatherRecord | null;
    reason: WeatherLookupResult['reason'];
  }>;
}

export interface DailyDeviation {
  tmax_c_abs_diff: number | null;
  tmin_c_abs_diff: number | null;
  precip_mm_abs_diff: number | null;
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

interface StationCandidate {
  name: string;
  noaa_station_id: string | null;
  acis_sid: string | null;
  lat: number | null;
  lon: number | null;
  distance_km: number | null;
}

interface AcisStationMeta {
  name?: string;
  sids?: unknown;
  ll?: unknown;
}

const DEFAULT_OHIO_QUERY: Omit<NormalizedWeatherQuery, 'date' | 'station_id' | 'force_fallback'> = {
  location_name: 'Delaware, Ohio',
  lat: 40.2987,
  lon: -83.0679,
  state: 'OH',
  country: 'US',
};

const STATION_ID_RE = /^US[CW]\d{8}$/;

const providerCache = new Map<string, Promise<WeatherLookupResult>>();
const resolvedCache = new Map<string, { expiresAt: number; result: WeatherLookupResult }>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function defaultFetcher(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function fahrenheitToCelsius(value: number): number {
  return (value - 32) * (5 / 9);
}

function inchesToMillimeters(value: number): number {
  return value * 25.4;
}

function absoluteDiff(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  return round2(Math.abs(a - b));
}

function parseCoordinatePair(value: unknown): { lat: number; lon: number } | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }

  const lon = toFiniteNumber(value[0]);
  const lat = toFiniteNumber(value[1]);
  if (lat == null || lon == null) return null;

  return { lat, lon };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusKm * c;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalizeWeatherQuery(query: WeatherQuery): NormalizedWeatherQuery {
  return {
    date: query.date,
    location_name: query.location_name ?? DEFAULT_OHIO_QUERY.location_name,
    lat: typeof query.lat === 'number' ? query.lat : DEFAULT_OHIO_QUERY.lat,
    lon: typeof query.lon === 'number' ? query.lon : DEFAULT_OHIO_QUERY.lon,
    state: query.state ?? DEFAULT_OHIO_QUERY.state,
    country: query.country ?? DEFAULT_OHIO_QUERY.country,
    station_id: query.station_id,
    force_fallback: Boolean(query.force_fallback),
  };
}

function hasMeasuredData(record: DailyWeatherRecord | null): record is DailyWeatherRecord {
  if (!record) return false;
  return record.tmax_c != null || record.tmin_c != null || record.precip_mm != null;
}

function extractStationToken(value: string): { token: string; network: number | null } {
  const [token = '', networkPart] = value.trim().split(/\s+/);
  const network = networkPart ? Number(networkPart) : null;
  return {
    token,
    network: Number.isFinite(network) ? Number(network) : null,
  };
}

function pickAcisSid(sids: string[]): string | null {
  const weighted = sids
    .map((sid) => {
      const { token, network } = extractStationToken(sid);
      if (!STATION_ID_RE.test(token)) return null;

      let rank = 10;
      if (network === 6) rank = 0;
      else if (network === 32) rank = 1;
      else if (network === 1) rank = 2;
      else if (network === 2) rank = 3;
      else if (network === 4) rank = 4;

      return { sid, rank };
    })
    .filter((item): item is { sid: string; rank: number } => item !== null)
    .sort((a, b) => a.rank - b.rank);

  return weighted[0]?.sid ?? null;
}

async function fetchStationCandidates(
  query: NormalizedWeatherQuery,
  fetcher: Fetcher,
): Promise<StationCandidate[]> {
  if (query.station_id) {
    return [
      {
        name: query.station_id,
        noaa_station_id: query.station_id,
        acis_sid: `${query.station_id} 6`,
        lat: query.lat,
        lon: query.lon,
        distance_km: 0,
      },
    ];
  }

  const payload = {
    ll: `${query.lat},${query.lon}`,
    state: query.state,
    date: query.date,
    elems: 'maxt,mint,pcpn',
    n: 40,
    meta: 'name,sids,ll,valid_daterange,state',
  };

  const response = await fetcher(ACIS_STN_META_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`ACIS StnMeta failed: ${response.status}`);
  }

  const parsed = (await response.json()) as { meta?: unknown };
  const rows = Array.isArray(parsed.meta) ? (parsed.meta as AcisStationMeta[]) : [];

  const candidates = rows
    .map((row): StationCandidate | null => {
      const name = typeof row.name === 'string' ? row.name : 'Unknown Station';
      const rawSids = Array.isArray(row.sids)
        ? row.sids.filter((sid): sid is string => typeof sid === 'string')
        : [];
      const stationTokens = rawSids.map((sid) => extractStationToken(sid).token);
      const noaaStationIds = unique(stationTokens.filter((token) => STATION_ID_RE.test(token)));
      const noaaStationId = noaaStationIds[0] ?? null;
      const acisSid = pickAcisSid(rawSids);

      if (!noaaStationId && !acisSid) {
        return null;
      }

      const ll = parseCoordinatePair(row.ll);
      const distanceKm = ll
        ? haversineKm(query.lat, query.lon, ll.lat, ll.lon)
        : null;

      return {
        name,
        noaa_station_id: noaaStationId,
        acis_sid: acisSid,
        lat: ll?.lat ?? null,
        lon: ll?.lon ?? null,
        distance_km: distanceKm,
      };
    })
    .filter((candidate): candidate is StationCandidate => candidate !== null)
    .sort((a, b) => {
      if (a.distance_km == null && b.distance_km == null) return 0;
      if (a.distance_km == null) return 1;
      if (b.distance_km == null) return -1;
      return a.distance_km - b.distance_km;
    });

  const deduped: StationCandidate[] = [];
  const seenStations = new Set<string>();

  for (const candidate of candidates) {
    const key = `${candidate.noaa_station_id ?? ''}|${candidate.acis_sid ?? ''}`;
    if (seenStations.has(key)) continue;

    seenStations.add(key);
    deduped.push(candidate);
  }

  return deduped;
}

async function fetchNoaaDailySummary(
  stationId: string,
  date: string,
  fetcher: Fetcher,
): Promise<DailyWeatherRecord | null> {
  const params = new URLSearchParams({
    dataset: 'daily-summaries',
    stations: stationId,
    startDate: date,
    endDate: date,
    dataTypes: 'TMAX,TMIN,PRCP',
    units: 'metric',
    format: 'json',
    includeStationName: 'true',
  });

  const response = await fetcher(`${NOAA_DAILY_SUMMARIES_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`NOAA daily summaries failed: ${response.status}`);
  }

  const parsed = (await response.json()) as Array<Record<string, unknown>>;
  const row = Array.isArray(parsed) ? parsed[0] : null;
  if (!row) return null;

  const tmax = toFiniteNumber(row.TMAX);
  const tmin = toFiniteNumber(row.TMIN);
  const precip = toFiniteNumber(row.PRCP);

  if (tmax == null && tmin == null && precip == null) return null;

  return {
    date,
    tmax_c: tmax != null ? round2(tmax) : null,
    tmin_c: tmin != null ? round2(tmin) : null,
    precip_mm: precip != null ? round2(precip) : null,
    source: 'NOAA_DAILY_SUMMARIES',
    source_station_id: stationId,
    quality_flag: null,
    is_estimated: false,
    raw: row,
  };
}

function parseAcisValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const normalized = value.trim().toUpperCase();
  if (!normalized || normalized === 'M' || normalized === 'NA') return null;
  if (normalized === 'T') return 0;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchAcisDailySummary(
  acisSid: string,
  date: string,
  fetcher: Fetcher,
): Promise<DailyWeatherRecord | null> {
  const payload = {
    sid: acisSid,
    sdate: date,
    edate: date,
    elems: [{ name: 'maxt' }, { name: 'mint' }, { name: 'pcpn' }],
  };

  const response = await fetcher(ACIS_STN_DATA_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`ACIS StnData failed: ${response.status}`);
  }

  const parsed = (await response.json()) as {
    data?: unknown;
    meta?: { sids?: unknown };
  };

  const rows = Array.isArray(parsed.data) ? parsed.data : [];
  const row = Array.isArray(rows[0]) ? rows[0] : null;
  if (!row || row.length < 4) return null;

  const rawMax = row[1];
  const rawMin = row[2];
  const rawPrecip = row[3];

  const maxF = parseAcisValue(rawMax);
  const minF = parseAcisValue(rawMin);
  const precipInches = parseAcisValue(rawPrecip);

  const tmax = maxF != null ? round2(fahrenheitToCelsius(maxF)) : null;
  const tmin = minF != null ? round2(fahrenheitToCelsius(minF)) : null;
  const precip = precipInches != null ? round2(inchesToMillimeters(precipInches)) : null;

  if (tmax == null && tmin == null && precip == null) return null;

  const qualityFlags: string[] = [];
  if (typeof rawMax === 'string' && rawMax.trim().toUpperCase() === 'M') qualityFlags.push('MISSING_TMAX');
  if (typeof rawMin === 'string' && rawMin.trim().toUpperCase() === 'M') qualityFlags.push('MISSING_TMIN');
  if (typeof rawPrecip === 'string') {
    const normalized = rawPrecip.trim().toUpperCase();
    if (normalized === 'M') qualityFlags.push('MISSING_PRCP');
    if (normalized === 'T') qualityFlags.push('TRACE_PRCP');
  }

  const stationToken = extractStationToken(acisSid).token;

  return {
    date,
    tmax_c: tmax,
    tmin_c: tmin,
    precip_mm: precip,
    source: 'ACIS_STNDATA',
    source_station_id: stationToken || null,
    quality_flag: qualityFlags.length > 0 ? qualityFlags.join(',') : null,
    is_estimated: false,
    raw: {
      sid: acisSid,
      data: row,
      meta: parsed.meta ?? {},
    },
  };
}

async function fetchOpenMeteoDaily(
  query: NormalizedWeatherQuery,
  fetcher: Fetcher,
): Promise<DailyWeatherRecord | null> {
  const params = new URLSearchParams({
    latitude: `${query.lat}`,
    longitude: `${query.lon}`,
    start_date: query.date,
    end_date: query.date,
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
    timezone: 'America/New_York',
  });

  const response = await fetcher(`${OPEN_METEO_ARCHIVE_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Open-Meteo archive failed: ${response.status}`);
  }

  const parsed = (await response.json()) as {
    daily?: {
      time?: unknown;
      temperature_2m_max?: unknown;
      temperature_2m_min?: unknown;
      precipitation_sum?: unknown;
    };
  };

  const daily = parsed.daily;
  if (!daily) return null;

  const tmax = Array.isArray(daily.temperature_2m_max)
    ? toFiniteNumber(daily.temperature_2m_max[0])
    : null;
  const tmin = Array.isArray(daily.temperature_2m_min)
    ? toFiniteNumber(daily.temperature_2m_min[0])
    : null;
  const precip = Array.isArray(daily.precipitation_sum)
    ? toFiniteNumber(daily.precipitation_sum[0])
    : null;

  if (tmax == null && tmin == null && precip == null) return null;

  return {
    date: query.date,
    tmax_c: tmax != null ? round2(tmax) : null,
    tmin_c: tmin != null ? round2(tmin) : null,
    precip_mm: precip != null ? round2(precip) : null,
    source: 'OPEN_METEO_ARCHIVE',
    source_station_id: null,
    quality_flag: null,
    is_estimated: true,
    // Store as parsed JSON without the double-cast so the type system
    // retains a structural claim. The `raw` field is purely informational
    // for now, so the indexable-record shape is safe. See docs/issues/0024.
    raw: parsed as Record<string, unknown>,
  };
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return `{${entries
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
    .join(',')}}`;
}

function cacheKey(query: NormalizedWeatherQuery): string {
  return [
    query.date,
    query.lat.toFixed(4),
    query.lon.toFixed(4),
    query.state,
    query.country,
    query.station_id ?? '',
    query.force_fallback ? 'fallback' : 'full',
  ].join('|');
}

export async function lookupHistoricalWeather(
  query: WeatherQuery,
  options: WeatherLookupOptions = {},
): Promise<WeatherLookupResult> {
  const normalized = normalizeWeatherQuery(query);
  const fetcher = options.fetcher ?? defaultFetcher;
  const maxStationCandidates = options.maxStationCandidates ?? 12;

  if (!isIsoDate(normalized.date)) {
    return {
      query: normalized,
      record: null,
      reason: 'INVALID_DATE',
      attempts: [],
    };
  }

  const attempts: string[] = [];

  let stationCandidates: StationCandidate[] = [];
  if (!normalized.force_fallback) {
    try {
      stationCandidates = await fetchStationCandidates(normalized, fetcher);
      attempts.push(`ACIS_META:${stationCandidates.length}`);
    } catch {
      attempts.push('ACIS_META_ERROR');
    }

    const noaaStations = unique(
      stationCandidates
        .map((candidate) => candidate.noaa_station_id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ).slice(0, maxStationCandidates);

    for (const stationId of noaaStations) {
      attempts.push(`NOAA:${stationId}`);
      try {
        const record = await fetchNoaaDailySummary(stationId, normalized.date, fetcher);
        if (hasMeasuredData(record)) {
          return {
            query: normalized,
            record,
            reason: null,
            attempts,
          };
        }
      } catch {
        attempts.push(`NOAA_ERROR:${stationId}`);
      }
    }

    const acisSids = unique(
      stationCandidates
        .map((candidate) => candidate.acis_sid)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ).slice(0, maxStationCandidates);

    for (const sid of acisSids) {
      attempts.push(`ACIS_STNDATA:${sid}`);
      try {
        const record = await fetchAcisDailySummary(sid, normalized.date, fetcher);
        if (hasMeasuredData(record)) {
          return {
            query: normalized,
            record,
            reason: null,
            attempts,
          };
        }
      } catch {
        attempts.push(`ACIS_STNDATA_ERROR:${sid}`);
      }
    }
  }

  attempts.push('OPEN_METEO');
  try {
    const fallbackRecord = await fetchOpenMeteoDaily(normalized, fetcher);
    if (hasMeasuredData(fallbackRecord)) {
      return {
        query: normalized,
        record: fallbackRecord,
        reason: null,
        attempts,
      };
    }
  } catch {
    attempts.push('OPEN_METEO_ERROR');
  }

  return {
    query: normalized,
    record: null,
    reason: 'NO_DATA',
    attempts,
  };
}

export async function lookupHistoricalWeatherCached(
  query: WeatherQuery,
  options: WeatherLookupOptions = {},
): Promise<WeatherLookupResult> {
  const normalized = normalizeWeatherQuery(query);
  const key = cacheKey(normalized);
  const now = Date.now();

  const resolved = resolvedCache.get(key);
  if (resolved && resolved.expiresAt > now) {
    return resolved.result;
  }
  if (resolved && resolved.expiresAt <= now) {
    resolvedCache.delete(key);
  }

  const existing = providerCache.get(key);
  if (existing) {
    return existing;
  }

  const pending = lookupHistoricalWeather(normalized, options)
    .then((result) => {
      resolvedCache.set(key, {
        result,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return result;
    })
    .finally(() => {
      providerCache.delete(key);
    });

  providerCache.set(key, pending);
  return pending;
}

function eachIsoDateInclusive(startDate: string, endDate: string): string[] {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }

  const dates: string[] = [];
  for (
    const cursor = new Date(start);
    cursor <= end;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    dates.push(cursor.toISOString().slice(0, 10));
  }

  return dates;
}

export async function fetchWeatherRange(
  query: WeatherRangeQuery,
  options: WeatherLookupOptions = {},
): Promise<WeatherRangeResult> {
  if (!isIsoDate(query.start_date) || !isIsoDate(query.end_date)) {
    throw new Error('start_date and end_date must use YYYY-MM-DD format.');
  }

  const dates = eachIsoDateInclusive(query.start_date, query.end_date);
  const records: WeatherRangeResult['records'] = [];

  for (const date of dates) {
    const lookup = await lookupHistoricalWeather(
      {
        date,
        location_name: query.location_name,
        lat: query.lat,
        lon: query.lon,
        state: query.state,
        country: query.country,
        station_id: query.station_id,
        force_fallback: query.force_fallback,
      },
      options,
    );

    records.push({
      date,
      record: lookup.record,
      reason: lookup.reason,
    });
  }

  const totalDays = records.length;
  const populatedDays = records.filter((entry) => hasMeasuredData(entry.record)).length;
  const missingDays = totalDays - populatedDays;

  return {
    start_date: query.start_date,
    end_date: query.end_date,
    total_days: totalDays,
    populated_days: populatedDays,
    missing_days: missingDays,
    missing_day_percentage: totalDays === 0 ? 0 : round2((missingDays / totalDays) * 100),
    records,
  };
}

export function calculateDailyDeviation(
  observed: DailyWeatherRecord,
  fallback: DailyWeatherRecord,
): DailyDeviation {
  return {
    tmax_c_abs_diff: absoluteDiff(observed.tmax_c, fallback.tmax_c),
    tmin_c_abs_diff: absoluteDiff(observed.tmin_c, fallback.tmin_c),
    precip_mm_abs_diff: absoluteDiff(observed.precip_mm, fallback.precip_mm),
  };
}

export function isDeviationAboveThreshold(
  deviation: DailyDeviation,
  thresholds: Partial<{
    tmax_c_abs_diff: number;
    tmin_c_abs_diff: number;
    precip_mm_abs_diff: number;
  }> = {},
): boolean {
  const limits = {
    tmax_c_abs_diff: thresholds.tmax_c_abs_diff ?? 8,
    tmin_c_abs_diff: thresholds.tmin_c_abs_diff ?? 8,
    precip_mm_abs_diff: thresholds.precip_mm_abs_diff ?? 20,
  };

  if (deviation.tmax_c_abs_diff != null && deviation.tmax_c_abs_diff > limits.tmax_c_abs_diff) {
    return true;
  }
  if (deviation.tmin_c_abs_diff != null && deviation.tmin_c_abs_diff > limits.tmin_c_abs_diff) {
    return true;
  }
  if (deviation.precip_mm_abs_diff != null && deviation.precip_mm_abs_diff > limits.precip_mm_abs_diff) {
    return true;
  }

  return false;
}

export function computeDailyWeatherHash(record: DailyWeatherRecord): string {
  const payload = stableStringify(record);
  return createHash('sha256').update(payload).digest('hex');
}

export function celsiusToFahrenheit(valueC: number): number {
  return (valueC * 9) / 5 + 32;
}
