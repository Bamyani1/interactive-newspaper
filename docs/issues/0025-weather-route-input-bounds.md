---
id: 0025
title: /api/weather route doesn't bound-check lat/lon/location_name
status: fixed
severity: low
area: api
opened: 2026-04-13
closed: 2026-04-14
---

> **Fix:** `src/app/api/weather/route.ts` now rejects out-of-range
> coordinates (`lat` ∉ [-90, 90], `lon` ∉ [-180, 180]) and over-long
> `location_name` / `country` / `state` / `station_id` params before
> forwarding the query downstream. Each returns a 400 with a specific
> error string. Downstream API quota is no longer wasted on obviously-
> invalid requests.


## Symptom

`GET /api/weather?lat=999&lon=999&location_name=AAAA...` (any unbounded
input) is forwarded to downstream APIs (NOAA, ACIS, OpenMeteo) without
local validation. Not immediately exploitable but:

- Wastes downstream API quota on obviously-invalid requests.
- Produces upstream 400s that are harder to debug than a proper local
  rejection.
- Could theoretically be used as a cheap amplification vector against
  upstream services (one request in, three requests out).

## Root cause

`src/app/api/weather/route.ts:38-47` parses numeric values but doesn't
bound-check them. `location_name` and `country` are passed through as
strings with no length limit or character filtering.

## Reproduction

```bash
curl "http://localhost:3000/api/weather?lat=999&lon=999&date=1960-01-13"
```

Observe downstream APIs return 400s that propagate as a confusing
response to the client.

## Proposed fix

Add local validation before calling `lookupHistoricalWeatherCached`:

```ts
if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
  return NextResponse.json({ error: "invalid lat" }, { status: 400 });
}
if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
  return NextResponse.json({ error: "invalid lon" }, { status: 400 });
}
if (location_name && location_name.length > 100) {
  return NextResponse.json({ error: "location_name too long" }, { status: 400 });
}
if (country && country.length > 3) {
  return NextResponse.json({ error: "invalid country" }, { status: 400 });
}
```

Or use zod for a cleaner single-pass validator.

## Notes

- Low severity because `/api/weather` is primarily consumed by the app's
  own UI, which supplies valid inputs. Defense against misuse rather than
  a known-exploited vulnerability.
