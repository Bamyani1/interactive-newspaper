---
id: 0036
title: /api/ask runs full pipeline twice for concurrent identical requests
status: fixed
severity: low
area: rag
opened: 2026-04-14
closed: 2026-04-14
---

## Symptom

If a user double-clicked the "Ask" button or two browser tabs hit the
same `(ip, question, filters)` within 1 second, both POSTs ran the full
pipeline independently — wasting 4 Gemini calls per duplicate
(reformulate + embed + rerank + answer-gen). `embedQuery` had its own
in-memory cache so the embedding was reused, but reformulator, reranker,
and answer-gen had no dedup.

Perf-only, not a correctness bug. Tracked low priority.

## Fix

`src/app/api/ask/route.ts`:

1. Restructured POST so rate-limit + input validation happen at the
   outer scope (not inside the pipeline IIFE), making the dedup key
   computable before the pipeline starts.
2. Added an in-memory `inFlightAsk: Map<string, DedupEntry>` keyed by
   `${ip}:${djb2Hash(question + JSON.stringify(filters))}`.
3. New `getOrExtract(entry)` helper that awaits the in-flight promise
   once, extracts the response body via `response.clone().json()`,
   caches it, and returns the cached body for any subsequent waiter.
4. New `freshResponseFromCached(data)` helper constructs a brand-new
   `NextResponse` from the cached body for each waiter (avoids the
   "body already consumed" gotcha of cloning a `Response` after the
   first read).
5. Auto-evict entries from the map after 30s TTL via `setTimeout`.
6. New `_clearAskDedupForTests` test hook so the dedup state doesn't
   leak between unit tests.

## Verification

New unit tests in `tests/api/ask-route.test.ts`:

- `dedups two concurrent identical requests — pipeline runs once`:
  asserts `reformulateQuery`, `embedQuery`, `hybridSearch`,
  `rerankArticles`, and `generateAnswer` mocks were each called
  exactly once when two identical POSTs are fired via `Promise.all`.
- `dedups three concurrent identical requests — pipeline runs once`
- `does NOT dedup distinct questions from the same IP`
- `does NOT dedup same question with different filters`
- `falls through if the in-flight pipeline rejects` — second call runs
  its own pipeline if the first errored.

## Notes

- The dedup map is module-scoped, so it shares state across all
  requests in a single Vercel function instance. Cross-instance dedup
  would require a Redis or KV layer; explicitly out of scope for this
  perf optimization.
- Falls back to running its own pipeline if the in-flight promise
  rejects, so a transient error in the first request doesn't pin
  failures onto subsequent retries.
