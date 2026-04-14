---
id: 0005
title: hybridSearch has no timeout wrapper; slow Neon hangs retrieval
status: fixed
severity: critical
area: db
opened: 2026-04-13
closed: 2026-04-14
---

## Symptom

If Neon is slow (cold start, region failover, contention), `hybridSearch` in
`src/lib/db.ts` can block indefinitely on its internal `Promise.all`. The
`/api/ask` route wraps the *outer* retrieval call in `Promise.race` with a
timeout (`src/app/api/ask/route.ts:116`), so the request eventually recovers
— but per-step latency budgets break down, partial retrieval isn't possible,
and the user ends up with a generic timeout rather than a graceful
fallback to FTS-only.

## Root cause

`src/lib/db.ts:285`:

```ts
const [vectorResults, ftsResults] = await Promise.all([
  vectorSearch(...),
  ftsSearch(...),
]);
```

`Promise.all` has no internal timeout. If either query hangs, the combined
promise hangs. The ask route's outer timeout cancels the whole retrieval
rather than letting FTS complete and returning partial results.

## Reproduction

Simulate slow Postgres (e.g., block vector extension with `pg_sleep(60)` in a
parallel session) and issue an ask request. Observe that ftsSearch — which
might be fast — is also effectively blocked until the outer route timeout
fires.

## Proposed fix

Option A (preferred, more composable): accept an `AbortSignal` in
`hybridSearch` and pass it into both sub-searches. Callers (including
`/api/ask`) can use `AbortSignal.timeout(ms)` for per-step budgets and
compose deadlines.

Option B (quick win): push a `Promise.race` against an internal deadline into
`hybridSearch`. On timeout, if one sub-search completed, return its results
as a partial. If both timed out, throw.

```ts
const deadline = new Promise<never>((_, reject) =>
  setTimeout(() => reject(new Error("hybridSearch timeout")), HYBRID_TIMEOUT_MS)
);
const [vectorResults, ftsResults] = await Promise.race([
  Promise.all([vectorSearch(...), ftsSearch(...)]),
  deadline,
]);
```

Pair with option B's partial-result handling if you want graceful degradation.

## Notes

- Related pattern exists in `src/app/api/ask/route.ts:116` where
  `Promise.race([..., retrievalTimeout])` is used. Push that discipline into
  the lib layer.
- This is "critical" only because the failure mode (user-facing timeout)
  happens during real outages; under normal load it's fine.
