---
id: 0017
title: next.config.ts image optimization changes uncommitted on image-embedding branch
status: open
severity: medium
area: infra
opened: 2026-04-13
---

## Symptom

`next.config.ts` has local modifications (image `formats`, `minimumCacheTTL`,
`deviceSizes`, `imageSizes`) that haven't been committed on the
`image-embedding` feature branch. A stray `git checkout`, `git stash drop`,
or `git reset --hard` would silently lose the work. CI will never see these
values until they're committed. If another contributor pulls, they won't
get the intended image optimization behavior.

## Root cause

Active feature development; the config changes were made alongside the
multimodal image embedding work in commit `9ef252b` but not included in
the commit itself.

## Reproduction

```bash
git status
git diff next.config.ts
```

Observe the uncommitted changes.

## Proposed fix

Not a code fix — a triage decision for the repo owner:

- **If the changes are intentional** (tuned for the image-embedding work):
  commit them with a message explaining why (e.g., "tune image formats for
  AVIF/WebP on R2-hosted edition images"). Include any related test
  evidence.
- **If the changes were exploratory**: revert them with
  `git checkout next.config.ts`.

## Notes

- CLAUDE.md → Build & Caching documents the existing `minimumCacheTTL: 1y`
  and other settings. Any change should be reflected there if kept.
- This issue is meta: once triaged, close as `fixed` or `wontfix`.
