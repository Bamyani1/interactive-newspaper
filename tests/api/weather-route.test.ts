import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

function makeRequest(url: string) {
  return new NextRequest(url);
}

// ── Missing date param ────────────────────────────────────────────────

describe("/api/weather – missing date param", () => {
  it("returns 400 with descriptive error when date is absent", async () => {
    vi.doMock("@/src/lib/weather-local-archive", () => ({
      isDateWithinLocalArchive: vi.fn(() => false),
      getLocalWeatherByDate: vi.fn(),
      parseScope: vi.fn(() => "delaware"),
    }));
    vi.doMock("@/src/lib/weather", () => ({
      lookupHistoricalWeatherCached: vi.fn(),
    }));

    const route = await import("../../src/app/api/weather/route");
    const response = await route.GET(makeRequest("http://localhost/api/weather"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Missing required query parameter: date");
  });
});

// ── Local archive path ────────────────────────────────────────────────

describe("/api/weather – local archive path (in-range date)", () => {
  const mockLocalRecord = {
    date: "1975-06-15",
    tmax_c: 28,
    tmin_c: 15,
    precip_mm: 0,
    source: "NOAA_GHCN_DAILY_ARCHIVE",
    source_station_id: "USS00336196",
    quality_flag: null,
    is_estimated: false,
    raw: {},
  };

  it("returns 200 from local archive; live lookup not called", async () => {
    const getLocalWeatherByDate = vi.fn(async () => mockLocalRecord);
    const lookupHistoricalWeatherCached = vi.fn();

    vi.doMock("@/src/lib/weather-local-archive", () => ({
      isDateWithinLocalArchive: vi.fn(() => true),
      getLocalWeatherByDate,
      parseScope: vi.fn(() => "delaware"),
    }));
    vi.doMock("@/src/lib/weather", () => ({
      lookupHistoricalWeatherCached,
    }));

    const route = await import("../../src/app/api/weather/route");
    const response = await route.GET(makeRequest("http://localhost/api/weather?date=1975-06-15"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getLocalWeatherByDate).toHaveBeenCalledWith("1975-06-15", "delaware");
    expect(lookupHistoricalWeatherCached).not.toHaveBeenCalled();
    expect(body.record?.date).toBe("1975-06-15");
  });
});

// ── Live lookup path ──────────────────────────────────────────────────

describe("/api/weather – live lookup path (out-of-range date)", () => {
  const liveRecord = {
    date: "2010-03-20",
    tmax_c: 12,
    tmin_c: 2,
    precip_mm: 0,
    source: "NOAA_DAILY_SUMMARIES",
    source_station_id: "USW00014821",
    quality_flag: null,
    is_estimated: false,
    raw: {},
  };

  it("calls live lookup; local archive not called", async () => {
    const getLocalWeatherByDate = vi.fn();
    const lookupHistoricalWeatherCached = vi.fn(async () => ({
      query: { date: "2010-03-20" },
      reason: null,
      attempts: ["NOAA:USW00014821"],
      record: liveRecord,
    }));

    vi.doMock("@/src/lib/weather-local-archive", () => ({
      isDateWithinLocalArchive: vi.fn(() => false),
      getLocalWeatherByDate,
      parseScope: vi.fn(() => "delaware"),
    }));
    vi.doMock("@/src/lib/weather", () => ({
      lookupHistoricalWeatherCached,
    }));

    const route = await import("../../src/app/api/weather/route");
    const response = await route.GET(makeRequest("http://localhost/api/weather?date=2010-03-20"));

    expect(response.status).toBe(200);
    expect(lookupHistoricalWeatherCached).toHaveBeenCalledTimes(1);
    expect(getLocalWeatherByDate).not.toHaveBeenCalled();
  });
});

// ── Scope parsing ─────────────────────────────────────────────────────

describe("/api/weather – scope parsing (via local archive path)", () => {
  const mockLocalRecord = {
    date: "1975-06-15",
    tmax_c: 20,
    tmin_c: 10,
    precip_mm: 0,
    source: "NOAA_GHCN_DAILY_ARCHIVE",
    source_station_id: "TEST",
    quality_flag: null,
    is_estimated: false,
    raw: {},
  };

  async function setupLocalRoute(parsedScope: string) {
    const getLocalWeatherByDate = vi.fn(async () => mockLocalRecord);
    vi.doMock("@/src/lib/weather-local-archive", () => ({
      isDateWithinLocalArchive: vi.fn(() => true),
      getLocalWeatherByDate,
      parseScope: vi.fn(() => parsedScope),
    }));
    vi.doMock("@/src/lib/weather", () => ({
      lookupHistoricalWeatherCached: vi.fn(),
    }));
    const route = await import("../../src/app/api/weather/route");
    return { route, getLocalWeatherByDate };
  }

  it("no scope param → getLocalWeatherByDate called with 'delaware'", async () => {
    const { route, getLocalWeatherByDate } = await setupLocalRoute("delaware");
    await route.GET(makeRequest("http://localhost/api/weather?date=1975-06-15"));
    expect(getLocalWeatherByDate).toHaveBeenCalledWith("1975-06-15", "delaware");
  });

  it("scope=statewide → getLocalWeatherByDate called with 'statewide'", async () => {
    const { route, getLocalWeatherByDate } = await setupLocalRoute("statewide");
    await route.GET(makeRequest("http://localhost/api/weather?date=1975-06-15&scope=statewide"));
    expect(getLocalWeatherByDate).toHaveBeenCalledWith("1975-06-15", "statewide");
  });

  it("scope=invalid → parseScope returns 'delaware'", async () => {
    const { route, getLocalWeatherByDate } = await setupLocalRoute("delaware");
    await route.GET(makeRequest("http://localhost/api/weather?date=1975-06-15&scope=invalid"));
    expect(getLocalWeatherByDate).toHaveBeenCalledWith("1975-06-15", "delaware");
  });
});

// ── Numeric param parsing (lat) ───────────────────────────────────────

describe("/api/weather – numeric param parsing via live path", () => {
  function makeLiveMock(spy: ReturnType<typeof vi.fn>) {
    vi.doMock("@/src/lib/weather-local-archive", () => ({
      isDateWithinLocalArchive: vi.fn(() => false),
      getLocalWeatherByDate: vi.fn(),
      parseScope: vi.fn(() => "delaware"),
    }));
    vi.doMock("@/src/lib/weather", () => ({
      lookupHistoricalWeatherCached: spy,
    }));
  }

  it("lat=40.5 → query.lat === 40.5", async () => {
    const spy = vi.fn(async () => ({ query: {}, reason: "NO_DATA", attempts: [], record: null }));
    makeLiveMock(spy);
    const route = await import("../../src/app/api/weather/route");
    await route.GET(makeRequest("http://localhost/api/weather?date=2010-01-01&lat=40.5"));
    const calledQuery = spy.mock.calls[0][0];
    expect(calledQuery.lat).toBe(40.5);
  });

  it("lat=abc → query.lat === undefined", async () => {
    const spy = vi.fn(async () => ({ query: {}, reason: "NO_DATA", attempts: [], record: null }));
    makeLiveMock(spy);
    const route = await import("../../src/app/api/weather/route");
    await route.GET(makeRequest("http://localhost/api/weather?date=2010-01-01&lat=abc"));
    const calledQuery = spy.mock.calls[0][0];
    expect(calledQuery.lat).toBeUndefined();
  });

  it("lat= (empty string) → query.lat === undefined", async () => {
    const spy = vi.fn(async () => ({ query: {}, reason: "NO_DATA", attempts: [], record: null }));
    makeLiveMock(spy);
    const route = await import("../../src/app/api/weather/route");
    await route.GET(makeRequest("http://localhost/api/weather?date=2010-01-01&lat="));
    const calledQuery = spy.mock.calls[0][0];
    expect(calledQuery.lat).toBeUndefined();
  });
});

// ── Live lookup error responses ───────────────────────────────────────

describe("/api/weather – live lookup error status codes", () => {
  function setupLivePath(lookupResult: object) {
    vi.doMock("@/src/lib/weather-local-archive", () => ({
      isDateWithinLocalArchive: vi.fn(() => false),
      getLocalWeatherByDate: vi.fn(),
      parseScope: vi.fn(() => "delaware"),
    }));
    vi.doMock("@/src/lib/weather", () => ({
      lookupHistoricalWeatherCached: vi.fn(async () => lookupResult),
    }));
  }

  it("reason=INVALID_DATE → 400", async () => {
    setupLivePath({ query: {}, reason: "INVALID_DATE", attempts: [], record: null });
    const route = await import("../../src/app/api/weather/route");
    const response = await route.GET(makeRequest("http://localhost/api/weather?date=2010-01-01"));
    expect(response.status).toBe(400);
  });

  it("reason=NO_DATA → 404", async () => {
    setupLivePath({ query: {}, reason: "NO_DATA", attempts: [], record: null });
    const route = await import("../../src/app/api/weather/route");
    const response = await route.GET(makeRequest("http://localhost/api/weather?date=2010-01-01"));
    expect(response.status).toBe(404);
  });

  it("record present, reason=null → 200", async () => {
    setupLivePath({
      query: { date: "2010-01-01" },
      reason: null,
      attempts: ["NOAA:X"],
      record: {
        date: "2010-01-01",
        tmax_c: 5,
        tmin_c: -2,
        precip_mm: 0,
        source: "NOAA_DAILY_SUMMARIES",
        source_station_id: "X",
        quality_flag: null,
        is_estimated: false,
        raw: {},
      },
    });
    const route = await import("../../src/app/api/weather/route");
    const response = await route.GET(makeRequest("http://localhost/api/weather?date=2010-01-01"));
    expect(response.status).toBe(200);
  });
});
