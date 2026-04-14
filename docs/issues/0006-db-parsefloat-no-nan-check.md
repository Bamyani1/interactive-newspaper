---
id: 0006
title: db.ts parseFloat on distance/rank produces unchecked NaN into confidence scoring
status: fixed
severity: high
area: db
opened: 2026-04-13
closed: 2026-04-14
---

## Symptom

If Postgres returns a non-numeric string for `distance` or `rank` (driver
quirk, cast failure, NULL coerced to "null", edge-case encoding),
`parseFloat` yields `NaN`. The `NaN` flows into
`src/lib/answer-generator.ts:109-115` where `avgDistance` is computed and
compared; all comparisons with `NaN` return `false`, so confidence-based
branching silently takes the wrong path. No error is thrown.

## Root cause

`src/lib/db.ts:263`:

```ts
distance: parseFloat(r.distance)
```

and similarly at `src/lib/db.ts:192` for `rank`. Neither has a
`Number.isFinite` guard. `parseFloat` is intentionally lenient and returns
`NaN` on unparseable input rather than throwing.

## Reproduction

Hard to reproduce in a healthy system — requires Neon to return a non-numeric
for these fields. Can be simulated by monkey-patching the driver's return in
a test.

## Proposed fix

Add a small helper and use it for both fields:

```ts
function toNumber(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
```

- For `distance`: fallback to `Number.POSITIVE_INFINITY` (so a bad row sorts
  last and contributes maximum distance).
- For `rank`: fallback to `0` (so a bad row sorts last in FTS relevance).

This fails loud on logging / metrics (look for infinite distances) rather
than silently corrupting confidence scores.

## Notes

- Found during audit of the RAG retrieval pipeline.
- The downstream confidence calc at `answer-generator.ts:109-115` also has
  no defensive check; fixing this source prevents corrupted inputs there.
