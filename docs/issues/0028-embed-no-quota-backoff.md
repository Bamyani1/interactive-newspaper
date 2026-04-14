---
id: 0028
title: Embed pipeline has no 429/quota-exhausted detection or early-abort
status: fixed
severity: medium
area: rag
opened: 2026-04-14
closed: 2026-04-14
---

## Symptom

When the Gemini embedding API returns `429 RESOURCE_EXHAUSTED` (daily quota
exhausted), the embed pipeline has no detection path. Every subsequent
batch fires immediately and 429s instantly. All remaining batches fail in
a row with zero backoff, wasting API calls on guaranteed failures and
prolonging the run for no benefit. The operator sees a wall of identical
error lines with no clear signal distinguishing quota exhaustion from a
genuine service outage.

**Observed 2026-04-14.** A `npm run db:seed` run (during verification of
fixes 0001 + 0002) hit quota at batch 179 of 192 — 8,950 of 9,582 articles
embedded. The remaining 13 batches all errored identically with
`RESOURCE_EXHAUSTED` within seconds, each logged as:

```
Embedding batch error: {"error":{"code":429,"message":"You exceeded your
current quota...","status":"RESOURCE_EXHAUSTED",...}}
```

## Root cause

- `src/lib/embeddings.ts:62-149` (`embedDocuments`) has no awareness of
  429 responses. It propagates the error unchanged without distinguishing
  retry-worthy (503, timeout) from hard-wall (429 daily quota) cases.
- `scripts/db/seed.mjs:embedArticles` (post-fix for 0001/0002) catches
  per-batch errors, logs them, increments `failedBatches`, and moves to
  the next batch without inspecting the error type.
- `scripts/db/embed.mjs:185-204` has a per-batch exponential backoff retry
  (2s, 4s, 8s...) but it's local to one batch and not quota-aware. It's
  useful for transient 503s but actively *worsens* 429 scenarios by
  burning extra API calls on doomed retries.

Neither script distinguishes transient 5xx/timeout errors from hard 429
quota exhaustion. Both have the same broken reaction: keep trying.

## Reproduction

Run `npm run db:seed` or `npm run db:embed` against an API key that is
close to or past its daily quota cap (Gemini embedding quotas are in the
low thousands/day on the free tier). Observe:

- Every batch after the quota hit errors immediately with identical 429.
- Both scripts continue attempting subsequent batches rather than
  aborting.
- The final error message counts total failed batches but doesn't flag
  the cause as quota exhaustion vs. an outage.

## Proposed fix

Two complementary changes:

1. **Quota detection in the shared lib.** In `src/lib/embeddings.ts`, wrap
   the `client.models.embedContent` call so that when the response is a
   `429` or contains `RESOURCE_EXHAUSTED`, it throws a specific
   `QuotaExhaustedError` class (or sets a property on the error) that
   callers can match on.

2. **Early-abort in callers.** In both `scripts/db/seed.mjs:embedArticles`
   and `scripts/db/embed.mjs` main loop, catch `QuotaExhaustedError`
   specifically and `break` out of the batch loop:

   ```js
   } catch (err) {
     failedBatches++;
     console.error(`  Embedding batch error:`, err.message || err);
     if (err.name === "QuotaExhaustedError") {
       console.warn(
         `  Quota exhausted; stopping early. Retry after quota reset.`
       );
       break;
     }
   }
   ```

   Both scripts still throw at the end so the exit code stays non-zero.

Optional: if Gemini returns a `Retry-After` header on 429, surface the
seconds-to-retry in the early-abort message so the operator knows when to
come back.

## Notes

- **Discovered** during the verification run for issues 0001 + 0002. The
  fix for 0001/0002 made this latent problem visible: before the type
  mismatch was fixed, zero batches succeeded and the quota was never
  touched.
- **Related 0003**: embed.mjs exits 0 even on per-batch retry failures —
  the early-abort here should integrate with whatever retry/exit-code
  handling 0003 lands.
- **Related 0011**: edition_pipeline broad `except` masks Gemini 503s.
  Same family of "distinguish transient from hard errors" problem, but
  in the OCR pipeline rather than the embedding pipeline. The fix pattern
  (narrow exception classes, retry-worthy vs hard-stop) is reusable.
- **Workaround** until fixed: after hitting quota, wait for the daily
  reset (typically midnight Pacific), then re-run `npm run db:seed` or
  `npm run db:embed`. Re-runs filter by `WHERE embedding IS NULL`, so
  they're idempotent and only retry the articles that still need
  embeddings.
- **Mitigated in practice by 0029 fix (2026-04-14).** The original
  trigger for this issue was that every seed run burned quota re-
  embedding unchanged content — that was caused by 0029
  (`seedEditions` wiping embeddings on every run), not by a genuine
  quota overrun. With 0029 fixed, seeds only hit quota if there's
  genuinely new content to embed. This issue is still worth
  implementing for robustness (e.g., if someone manually clears
  embeddings and re-seeds) but is no longer urgent.
