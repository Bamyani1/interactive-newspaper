---
id: 0002
title: seed.mjs embedArticles swallows batch errors; seed exits 0 on total failure
status: fixed
severity: critical
area: scripts
opened: 2026-04-13
closed: 2026-04-14
---

## Symptom

The seed script reports success even when *every* embed batch fails. The
`done` counter stays at 0, the script prints `Embedding complete: 0 articles.`,
`main()` continues to ANALYZE the tables, and the process exits 0. There is
no non-zero signal for CI, operators, or monitoring.

## Root cause

`scripts/db/seed.mjs:535-537`:

```js
} catch (err) {
  console.error(`  Embedding batch error:`, err.message || err);
}
```

The catch logs and continues the loop. `embedArticles()` has no accumulated-
error check before returning. `main()` at line 639 awaits `embedArticles()`
but doesn't inspect any outcome. The outermost `main().catch(...)` at line 670
only fires on an unhandled throw — which never happens because the inner catch
absorbs everything.

## Reproduction

Run `npm run db:seed` while issue 0001 is present:

```bash
npm run db:seed
echo "exit code: $?"   # prints 0 despite 0 articles embedded
```

Even without 0001, any persistent Gemini outage or network failure will
reproduce this.

## Proposed fix

1. Track a `failedBatches` counter inside `embedArticles()`.
2. After the loop ends, if `failedBatches > 0`, throw an error summarizing
   the failure:
   ```js
   throw new Error(`Embedding failed: ${failedBatches} batch(es) of ${totalBatches}`);
   ```
3. `main().catch()` at line 670 already `process.exit(1)` on throw, so no
   further changes are needed.

Alternative: have `embedArticles()` return a `{embedded, failed}` tuple and
let `main()` decide the exit policy.

## Notes

- This is the silent-failure mechanism that let 0001 go unnoticed through
  multiple seed runs.
- Related: 0001 (the underlying type mismatch) and 0003 (embed.mjs has the
  same exit-code problem).
