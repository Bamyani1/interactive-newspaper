---
id: 0035
title: answer-generator confidence-default brittleness for FTS-only retrieval
status: fixed
severity: medium
area: rag
opened: 2026-04-14
closed: 2026-04-14
---

## Symptom

`src/lib/answer-generator.ts:109-112` hardcoded `avgDistance = 0.27` when
`vectorArticles.length === 0` (i.e., FTS-only retrieval, where there are
no vector distances to average). The 0.27 value happened to fail the
`avgDistance < 0.26` "high confidence" gate by 0.01, capping FTS-only
confidence at "medium" regardless of how strong the reranker scored the
results. A question that legitimately had only FTS hits with reranker
scores of 9/10 would still report "medium" confidence to the user.

The fake distance also caused the `avgDistance > 0.30 && avgRerankerScore
< 5` skip-Gemini check to behave inconsistently for FTS-only paths
(0.27 is below 0.30, so the skip never fired even when the reranker
flagged everything as tangential).

## Fix

`src/lib/answer-generator.ts`:

1. Changed `avgDistance` to `number | null` — `null` when no vector
   results exist, instead of guessing a "medium" 0.27 default.
2. Updated `computeConfidence` to take an FTS-only branch when
   `avgDistance === null`, using the reranker score as the primary
   signal:
   - score >= 8 → high
   - score >= 5 → medium
   - score < 5 → low
3. Updated the "skip Gemini for distant matches" guard to require
   `avgDistance !== null` before triggering, so FTS-only requests
   always reach the LLM.

## Verification

New unit tests in `tests/lib/answer-generator.test.ts`:

- `FTS-only with mid reranker score (6) gives medium confidence` —
  preserves prior behavior.
- `FTS-only with strong reranker score (>=8) gives HIGH confidence` —
  the regression-test for the brittleness fix.
- `FTS-only with weak reranker score (<5) gives low confidence`
- `FTS-only does NOT trigger the 'don't seem to be closely related' skip`
  — asserts the LLM is still called even when reranker scores are weak.

Golden suite observed `parade-visual` confidence improve from `low` to
`medium` after this fix landed (FTS-heavy visual-mode retrieval).
