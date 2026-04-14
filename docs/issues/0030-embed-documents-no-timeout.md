---
id: 0030
title: embedDocuments has no timeout wrapper (asymmetric with embedQuery)
status: fixed
severity: critical
area: rag
opened: 2026-04-14
closed: 2026-04-14
---

## Symptom

`embedDocuments` in `src/lib/embeddings.ts` calls `client.models.embedContent`
with no `AbortController`/timeout. If the Gemini API stalls or hangs,
`npm run db:embed` and `npm run db:seed` block indefinitely. By contrast,
`embedQuery` in the same file has a 5-second internal timeout.

## Root cause

Asymmetric design — query-time embedding was hardened with a timeout but
the document/seed-time path was not. Surfaced by the focused RAG audit
(2026-04-14).

## Fix

`src/lib/embeddings.ts`:

1. Added `EmbedTimeoutError` exported class.
2. Added `embedWithTimeout(op, fn, timeoutMs)` helper using
   `AbortController` + `Promise.race` (belt-and-suspenders so a hung
   underlying fetch can't block past the budget even if the SDK ignores
   the signal).
3. Wrapped both `embedContent` calls in `embedDocuments` (text-batch and
   multimodal) with a 30s per-batch budget.
4. Step 6 (issue 0028) layered quota detection on top of the same
   helper, so `EmbedTimeoutError` and `QuotaExhaustedError` both flow
   from one place.

## Verification

- New unit tests in `tests/lib/embeddings.test.ts`:
  - `throws EmbedTimeoutError when embedContent hangs past the budget`
  - `EmbedTimeoutError carries op name and timeout budget`
- Golden suite: no regressions before/after fix.
