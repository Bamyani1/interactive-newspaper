---
id: 0011
title: edition_pipeline broad except in Phase 4/5 masks Gemini 503s as warnings
status: open
severity: high
area: ocr
opened: 2026-04-13
---

## Symptom

Editions silently under-enrich. Phase 4 (ad enrichment) and Phase 5 (content
rescue / triage) fail due to Gemini rate limiting, 503s, or timeouts — but
the edition is marked complete with only a warning logged. Given project
memory notes 29 of 142 editions had page failures (2026-04-07), this
failure mode has been active and hidden, and may explain part of that
backlog.

## Root cause

`ocr/src/transcript_ocr/application/edition_pipeline.py:301, 315`:

```python
try:
    ad_enrichment.run(...)
except Exception as exc:
    warning(f"ad enrichment failed: {exc}")

try:
    content_rescue.run(...)
except Exception as exc:
    warning(f"content rescue failed: {exc}")
```

Two problems:

1. `except Exception` is too broad — it catches transient errors (503,
   quota, timeout) and terminal errors (auth, schema mismatch) the same way.
2. Warnings are not retries. There is no exponential backoff, no
   distinction between "try again" and "give up", and the edition ends up
   with incomplete enrichment recorded as success.

## Reproduction

Run a full edition during a Gemini service incident. Observe the edition
completes successfully but ad/rescue data is sparse.

## Proposed fix

1. **Narrow the exception classes.** Catch the specific Gemini API error
   types (503, ResourceExhaustedError, DeadlineExceededError) and retry them
   via `ocr/src/transcript_ocr/shared/retry.py`.
2. **Fail loud on terminal errors** (auth, schema mismatch, missing prompt)
   — these should abort the phase with a non-zero exit so operators can
   distinguish "bad config" from "bad day".
3. **Record enrichment completeness** in the edition's diagnostics so
   partial runs are visible in reports, even if you keep the "continue on
   transient error" policy.

## Notes

- Memory reference: `project_ocr_pipeline_state.md` (Gemini 503 failures,
  2026-04-07).
- Related: 0010 (content_rescue silent bounds drops) and 0012 (truncated
  merge error messages).
