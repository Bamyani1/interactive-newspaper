---
id: 0018
title: cleanup-images.mjs tokenScore can become NaN on empty captionTokens
status: fixed
severity: medium
area: scripts
opened: 2026-04-13
closed: 2026-04-14
---

> **Fix:** `scripts/cleanup-images.mjs` now uses
> `captionTokens.length > 0 ? overlap / captionTokens.length : 0` at the
> division site (belt-and-suspenders with the existing upstream early
> return). A refactor that removes or reshapes the upstream guard can no
> longer silently reintroduce NaN into the weighted score.


## Symptom

`scripts/cleanup-images.mjs` can emit `NaN` weighted scores in edge cases
where `captionTokens.length` is 0 at the point of division. Currently
guarded by an early return at line 141, but the arithmetic at line 148 is
fragile — a future refactor that removes or reshapes the early return
would silently reintroduce NaN into the scoring.

## Root cause

Division without a co-located non-zero denominator guard:

```js
// scripts/cleanup-images.mjs (approx line 148)
const tokenScore = overlap / captionTokens.length;
```

The guard at line 141 returns early when `captionTokens.length === 0`,
which is correct today — but the guard is far enough from the use site
that it's easy to break by accident.

## Reproduction

Comment out the early return at line 141 and pass an article with an empty
caption. Observe `NaN` in the weighted score output.

## Proposed fix

Move the guard to the point of division:

```js
const tokenScore = captionTokens.length > 0
  ? overlap / captionTokens.length
  : 0;
```

Or, if zero-length caption should propagate as an explicit "no signal":

```js
if (captionTokens.length === 0) return { tokenScore: 0, nameScore, ... };
const tokenScore = overlap / captionTokens.length;
```

Either approach makes the invariant local and refactor-resistant.

## Notes

- Low priority because the upstream guard works today. Filed mostly as
  defensive hygiene.
