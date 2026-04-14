---
id: 0033
title: /api/ask catch-all returns opaque 500 with no stage or requestId
status: fixed
severity: medium
area: rag
opened: 2026-04-14
closed: 2026-04-14
---

## Symptom

The top-level catch in `POST /api/ask` returned `{ error: "An unexpected
error occurred. Please try again." }` for any unhandled error, with no
information about which stage failed (reformulator, embed, retrieval,
rerank, answer-gen) or any correlation token operators could grep in
logs. Compare with the existing well-shaped 502 (embed) and 504 (retrieval
timeout) responses which were specific to one stage.

## Fix

`src/app/api/ask/route.ts`:

1. Added `requestId` (short random token) generation at the top of POST.
2. New `StageError` class with `stage` + `cause` properties.
3. New `wrapStage(stage, fn)` helper that catches any error from a
   stage and re-throws as `StageError` (preserving `DeadlineExceededError`
   and `QuotaExhaustedError` which are handled separately).
4. Wrapped `reformulateQuery`, `rerankArticles`, and `generateAnswer`
   calls with `wrapStage("reformulate"|"rerank"|"generate", ...)`.
5. Top-level catch reads `err.stage` and returns a structured error
   response: `{ error, stage, requestId }` with status 500. Existing
   429/502/504 responses also gained `stage` + `requestId` fields.
6. All `console.error` calls now include `[ask requestId=${requestId}]`
   for log correlation.

## Verification

New unit tests in `tests/api/ask-route.test.ts`:

- `tags reformulator errors with stage='reformulate'`
- `tags reranker errors with stage='rerank'`
- `tags answer-gen errors with stage='generate'`
- `502 embed failure includes stage='embed' and requestId`
- `504 deadline includes stage='deadline' and requestId`
- `429 + Retry-After when embedQuery throws QuotaExhaustedError` —
  asserts `cause: "quota_exhausted"`, `stage: "embed"`, `requestId`,
  and `Retry-After: 3600` header.

## Notes

- The `requestId` field is added to error responses only, not to the
  happy-path 200 response. There's a documenting test covering this
  intentional asymmetry.
