---
id: 0019
title: weather build has no inline post-build validation
status: fixed
severity: medium
area: scripts
opened: 2026-04-13
closed: 2026-04-14
---

> **Fix:** Option 2 from the issue body. `package.json` `weather:build:ohio`
> script now chains to `npm run weather:verify:ohio` so a broken archive
> fails the build with a non-zero exit. No script code change needed.


## Symptom

`scripts/weather/build-ohio-weather-archive.mjs` can write a corrupted or
partial archive silently. The operator only catches it by running
`scripts/weather/verify-ohio-weather-archive.mjs` as a separate manual
step — and CI doesn't run either script. A broken archive ships to
production if nobody remembers to verify.

## Root cause

Build and verify are two separate scripts with no coupling. There's no
`finally` step in the build that invokes verification, and no exit-code
chain that would fail the build on verification failure.

## Reproduction

Break the archive mid-build (e.g., kill the process after a partial
write) and run only the build script. Archive is written in a broken
state with exit code 0.

## Proposed fix

Two options:

1. **Refactor verify into a function.** Export the verification logic from
   `verify-ohio-weather-archive.mjs` as a function, and call it at the end
   of `build-ohio-weather-archive.mjs`. Exit 1 on verification failure.

2. **Chain in package.json.**
   ```json
   "weather:build:ohio": "node scripts/weather/build-ohio-weather-archive.mjs && node scripts/weather/verify-ohio-weather-archive.mjs"
   ```
   Simple and low-risk but doesn't share code.

Option 1 is more principled; option 2 is a one-line quick win.

## Notes

- The weather archive is one of the "Do Not Modify" paths in CLAUDE.md:
  `public/data/weather/ohio/index/`. That makes silent corruption
  particularly painful because re-running the build requires deliberate
  intent.
