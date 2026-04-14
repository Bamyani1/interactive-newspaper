---
id: 0034
title: /api/search has no length limit, no timeout, silent 500 swallow
status: fixed
severity: medium
area: api
opened: 2026-04-14
closed: 2026-04-14
---

## Symptom

`GET /api/search` (`src/app/api/search/route.ts`) accepted any query string
length and called `searchArticles` with no timeout. Three risks:

1. **No length limit on `q`**: a 100KB query could be sent to
   `websearch_to_tsquery`, potentially starving the DB connection.
2. **No timeout wrapper**: a hung Neon request would block the route
   indefinitely (the same class of problem as 0005 but for the FTS
   path).
3. **Silent 500 with opaque error**: the catch returned
   `{ error: "Search failed" }` for any failure with no `cause`,
   `requestId`, or distinction between timeout and other errors.

## Fix

`src/app/api/search/route.ts`:

1. Validate `q.length <= 200` (400 with structured error on violation).
2. Wrap `searchArticles` in `Promise.race` with an 8s timeout; on fire,
   return 504 with `cause: "timeout"`.
3. All error responses now include a `requestId` for log correlation
   and a `cause` field (`"timeout"` | `"internal_error"`).
4. Console logs include `[search requestId=${requestId}]` prefix.

## Verification

New `tests/api/search-route.test.ts` covers:

- 400 missing `q`
- 400 empty-after-trim `q`
- 400 length violation (q.length > 200)
- 200 happy path with structured pagination
- 504 with `cause: "timeout"` when DB hangs (uses `vi.useFakeTimers` to
  advance past the 8s budget)
- 500 with `cause: "internal_error"` on generic DB failure
- limit/offset query params honored
- limit cap at 100
- filter forwarding (category, start_date, end_date)
