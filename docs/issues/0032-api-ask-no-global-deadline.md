---
id: 0032
title: /api/ask has no global deadline (worst-case 43s+ cumulative timeout)
status: fixed
severity: critical
area: rag
opened: 2026-04-14
closed: 2026-04-14
---

## Symptom

Each RAG stage in `POST /api/ask` had its own internal timeout
(reformulator 5s, embedQuery 5s, hybridSearch 8s + retrieval race 10s,
reranker 8s, answer-gen 15s) but there was no single deadline budget
enforcing a maximum end-to-end response time. In a slow-but-not-hung
worst case, `/api/ask` could take 5+5+10+8+15 = 43s+ before returning,
holding a serverless function instance the whole time.

There was also no `AbortSignal` propagation from the route into the
libs, so a slow stage could not be cancelled from the outside even if
the operator wanted to.

## Fix

`src/app/api/ask/route.ts`:

1. Added `GLOBAL_DEADLINE_MS = 30_000` and a top-level `AbortController`.
2. Wrapped the whole pipeline in `Promise.race([pipelinePromise,
   deadlinePromise])` so the route is guaranteed to return inside the
   budget even if a downstream lib ignores the signal.
3. New `DeadlineExceededError` class; top-level catch returns 504 with
   `{ error, stage: "deadline", requestId }`.
4. Added `_setGlobalDeadlineForTests` test hook so unit tests can
   exercise the deadline path with a 150ms budget instead of 30s.

`src/lib/{query-reformulator,embeddings,reranker,answer-generator,db}.ts`:

5. Added optional `signal?: AbortSignal` parameter to each public
   function (`reformulateQuery`, `embedQuery`, `hybridSearch`,
   `rerankArticles`, `generateAnswer`).
6. Each lib uses `AbortSignal.any([opts.signal, internalController.signal])`
   to combine the outer signal with its internal timeout — whichever
   fires first wins.
7. Routes pass `globalController.signal` into every stage.

## Verification

New unit tests in `tests/api/ask-route.test.ts`:

- `returns 504 when the global deadline fires` — uses
  `_setGlobalDeadlineForTests(150)` and a hung reformulator mock,
  asserts the response lands inside ~600ms with `stage: "deadline"`.
- `global deadline does not fire for normal fast requests` — sanity
  check that happy-path requests at 5s budget still return 200.

Existing assertion tests updated to tolerate the new `signal` parameter
via `expect.objectContaining({ signal: expect.any(AbortSignal) })`.

## Notes

- Belt-and-suspenders design: the `AbortSignal` propagation is best-effort
  cancellation. The `Promise.race` against the timeout promise is the
  hard guarantee.
- Step 7 (issue 0033) layered structured error responses on top of this,
  so the deadline error includes `stage: "deadline"` and a `requestId`.
