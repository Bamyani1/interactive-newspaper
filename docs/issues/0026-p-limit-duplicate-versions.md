---
id: 0026
title: p-limit resolves to two versions in the lockfile
status: open
severity: low
area: deps
opened: 2026-04-13
---

## Symptom

`package-lock.json` has two versions of `p-limit`:

- `p-limit@7.3.0` — a new direct dependency
- `p-limit@3.1.0` — transitive via `eslint` → `locate-path` → `p-locate`

Both versions ship in `node_modules`. Bundle size impact is minimal, and
consumer code that imports `p-limit` from the root gets 7.3.0 correctly,
so the duplicate is mostly cosmetic.

## Root cause

ESLint's dependency tree pins `p-limit@3.1.0` through `p-locate`. That's
not something we control; it's how ESLint's dep graph resolves. Adding
`p-limit@7.3.0` as a direct dep creates a second resolution path that
npm can't deduplicate.

## Reproduction

```bash
npm ls p-limit
```

Shows both versions in the tree.

## Proposed fix

Two options:

1. **Accept it.** Duplicate minor versions of tiny utility libs happen
   all the time. Not worth action.
2. **Force dedup via overrides.** Add to `package.json`:
   ```json
   "overrides": {
     "p-limit": "7.3.0"
   }
   ```
   This forces all transitive dependents onto 7.3.0. Risk: breaking
   ESLint's usage if it actually depends on 3.x-specific behavior.
   Unlikely but worth a smoke-test run of `npm run lint` after.

Recommend option 1 unless the duplication causes a concrete problem.

## Notes

- Filed for awareness, not action. If someone tackles 0026 alongside an
  eslint upgrade, the problem may resolve on its own.
