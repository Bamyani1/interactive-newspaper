---
id: 0027
title: .gitignore adds scripts/dev/data/ without explanatory comment
status: open
severity: low
area: infra
opened: 2026-04-13
---

## Symptom

The uncommitted `.gitignore` diff adds `scripts/dev/data/` as an ignored
path, with no comment explaining what lives there or why it's ignored.
Future contributors (including future-you) will not know whether the
directory holds intentional build artifacts, in-progress data, or stale
cruft — and won't know whether it's safe to delete when cleaning up.

## Root cause

The directory currently holds transient build artifacts from the music-
archive build work:

- `billboard-monthly-raw.json` (~875 KB) — raw API output
- `hot100-archive.csv` (~18 MB) — historical chart CSV

Both are intermediate outputs of `scripts/dev/build-music-archive.mjs`
and friends.

## Proposed fix

Add a comment line in `.gitignore` above the path:

```
# Transient build artifacts produced by scripts/dev/build-music-archive.mjs
# and related music-chart fetchers. Safe to delete; scripts regenerate.
scripts/dev/data/
```

Or, more aggressively, move the build output to a sub-path that's
already conventionally gitignored (e.g., `ocr/runs/` or a new
`.cache/music/`), eliminating the need for the new ignore entry.

## Notes

- This issue is trivial but filing it helps establish the convention
  that `.gitignore` entries should carry a short rationale comment.
