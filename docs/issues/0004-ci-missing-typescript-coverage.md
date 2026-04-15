---
id: 0004
title: CI workflow has no Next.js TS build / lint / test coverage
status: fixed
severity: critical
area: ci
opened: 2026-04-13
closed: 2026-04-14
---

> **Fix:** `.github/workflows/nextjs-ci.yml` added. Runs on `pull_request`
> and `push` to `main`: `npm ci`, `tsc --noEmit`, `npm run lint`,
> `npm run test:run`. `npm run build` is intentionally deferred — it
> requires a `CI_DATABASE_URL` secret (see Build & Caching in CLAUDE.md),
> which is a separate follow-up.


## Symptom

TypeScript errors, ESLint violations, and broken Next.js builds can land on
`main` without CI noticing. The only gate on PRs and pushes is a Python test
suite for OCR architecture rules.

## Root cause

`.github/workflows/ocr-architecture.yml` is the only CI workflow. It runs:

1. `pytest tests/ocr/architecture/test_import_rules.py`
2. `pytest tests/ocr/architecture/test_wrapper_entrypoints.py`
3. `pytest tests/ocr/architecture/test_runtime_cutover.py`
4. A Python inline script that checks required script files exist.

No `npm ci`. No `npm run lint`. No `npm run test:run`. No `npm run build`.
Nothing verifies the TypeScript / Next.js side of the application.

## Reproduction

Introduce a TypeScript error anywhere in `src/` and push a branch:

```ts
// src/lib/db.ts (example breakage)
const bogus: string = 42;
```

`npm run lint` and `npm run build` would fail locally, but CI will pass on
that PR because it only runs Python tests.

## Proposed fix

Add a second workflow (or a second job in the existing file) that runs on
pull_request and push:

```yaml
jobs:
  next-js:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run test:run
      - run: npm run build
        env:
          DATABASE_URL: ${{ secrets.CI_DATABASE_URL }}
          GOOGLE_API_KEY: ${{ secrets.CI_GOOGLE_API_KEY }}
```

`npm run build` depends on `DATABASE_URL` because `generateStaticParams` in
`src/app/edition/[date]/page.tsx` and the root layout query Neon at build
time (see CLAUDE.md → Build & Caching). Options:

- Provide a Neon branch as `CI_DATABASE_URL` secret and a throwaway
  `GOOGLE_API_KEY` secret.
- Or introduce a `BUILD_MODE=ci` environment flag that causes the layout /
  edition page to skip DB queries and pre-render a minimal set.

Option A is simpler; option B is more principled.

## Notes

- This is the safety net that would have caught 0001 before merge (the
  `.mjs` contract break wouldn't have been caught by `tsc`, but a subsequent
  seed attempt during build would have surfaced it).
- Don't confuse this with the `ocr-architecture.yml` workflow, which should
  stay as-is.
