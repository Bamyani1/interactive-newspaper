---
id: 0013
title: merge retry exhaustion raises without fallback to unmerged edition
status: open
severity: high
area: ocr
opened: 2026-04-13
---

## Symptom

If Gemini merge times out through all 4 retries (up to ~32s of exponential
backoff via `shared/retry.py`), the edition is marked failed with no
`edition.json` emitted. There's no graceful fallback to emitting the
pre-merge, page-level articles so that seed/embed can still surface
*something* searchable for that date.

## Root cause

`ocr/src/transcript_ocr/shared/retry.py:98`:

```python
raise last_exc
```

On final retry exhaustion the last exception is re-raised. The call site
in `llm_merge.py` doesn't catch timeout exhaustion and doesn't have a
fallback path that writes unmerged articles.

## Reproduction

Run an edition through a Gemini outage long enough to exhaust the retry
budget. Observe no `edition.json` is written.

## Proposed fix

In `llm_merge.py`, catch the timeout exhaustion and fall back to the
per-page article data (with a diagnostic flag so downstream consumers know
the merge was skipped):

```python
try:
    merged = run_merge(...)
except TimeoutError:
    warning("merge retry budget exhausted; emitting unmerged page-level articles")
    merged = build_unmerged_edition(page_articles)
    merged.diag["merge_skipped"] = True
```

Downstream seed / API / UI layers already handle page-level articles
(they're upstream of merge), so this is a safe degradation.

## Notes

- A partial edition is almost always more useful than a missing edition —
  search, browse, and RAG still work; only article continuations across
  pages are lost.
- Related: 0011, 0012.
