---
id: 0003
title: embed.mjs exits 0 even when per-batch retries fail
status: fixed
severity: critical
area: scripts
opened: 2026-04-13
closed: 2026-04-14
---

## Symptom

`npm run db:embed` can report `Errors: 43` at the bottom of its output and
still exit 0. Downstream automation (CI, cron jobs, deploy hooks) has no way
to detect embedding failure from exit code alone.

## Root cause

`scripts/db/embed.mjs:203-205`:

```js
} catch (retryErr) {
  console.error(`  Retry also failed:`, retryErr.message || retryErr);
}
```

Catches retry failure, logs it, and lets the main loop continue. Main loop
finishes normally and `main()` returns.

`scripts/db/embed.mjs:215-218`:

```js
main().catch((err) => {
  console.error("Embedding failed:", err);
  process.exit(1);
});
```

Only triggers on unhandled throws from `main()`. Since the inner retry catch
swallows everything, `main()` never throws — it just finishes. Error counter
is printed on line 212 for humans but never affects the exit code.

## Reproduction

Run `npm run db:embed` under any condition that causes every batch to fail
(e.g., network cut, invalid API key after initialization, quota exhausted
mid-run):

```bash
npm run db:embed
echo "exit code: $?"   # 0 even with errors > 0
```

## Proposed fix

At the end of `main()` — after the summary prints at `embed.mjs:211-212` —
add:

```js
if (errors > 0) {
  throw new Error(`Embedding failed: ${errors} article(s) could not be embedded`);
}
```

The existing `main().catch()` at line 215 will then exit 1.

## Notes

- Same error-swallowing pattern as issue 0002 (seed.mjs) but in a separate
  script. Both should be fixed.
- Both embed.mjs and seed.mjs contain nearly identical embed loops — consider
  consolidating during the fix (see 0001 proposed fix option 1).
