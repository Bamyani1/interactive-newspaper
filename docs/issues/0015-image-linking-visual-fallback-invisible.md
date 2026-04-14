---
id: 0015
title: image_linking visual→spatial fallback invisible in diagnostics
status: fixed
severity: high
area: ocr
opened: 2026-04-13
closed: 2026-04-14
---

> **Fix (already covered by pre-existing diag fields):** the
> `VisualMatchingInfo` dataclass at
> `contracts/diagnostics_models.py:64` already exposes three boolean
> fields — `attempted`, `succeeded`, and `fallback_to_spatial` — which
> together fully distinguish the three states the issue describes:
>
> | attempted | succeeded | fallback_to_spatial | meaning |
> |---|---|---|---|
> | False | False | False | never attempted (no content) |
> | True | True | False | visual succeeded |
> | True | False | True | attempted, failed, fell back to spatial |
>
> `visual_matcher.py` sets `attempted` and `succeeded`; `page_pipeline.py`
> sets `fallback_to_spatial`. No code change needed — the issue's concern
> is already addressable from diagnostics. A future follow-up could add a
> `visual_failure_reason: str` field for the specific cause string, but
> that needs a change in `visual_matcher.py` that wasn't in scope for this
> PR.


## Symptom

Diagnostics show `used_visual=False` for two indistinguishable states:

1. **Visual matching was never attempted** — intentionally skipped for
   this page type or pipeline mode.
2. **Visual matching was attempted and failed** — Gemini blocked,
   returned empty, or errored.

Operators can't tell which, so they can't debug degraded image linking
quality or decide whether to investigate.

## Root cause

`ocr/src/transcript_ocr/application/page_pipeline.py:148-156` catches the
exception from `match_images_visual()`, logs a warning, and falls through
to spatial matching. No `visual_attempted` flag or failure-reason field is
recorded in diagnostics. The single `used_visual` boolean collapses both
paths into the same value.

## Proposed fix

Add two fields to the per-page image-linking diagnostic:

- `visual_attempted: bool`
- `visual_failure_reason: str | None`

Populate both in the fallback branch:

```python
diag.image_linking.visual_attempted = True
try:
    matches = match_images_visual(...)
    diag.image_linking.used_visual = True
except Exception as exc:
    diag.image_linking.visual_failure_reason = str(exc)[:200]
    warning(f"visual matching failed, falling back to spatial: {exc}")
    matches = match_images_spatial(...)
```

And in the "never attempted" path, leave `visual_attempted=False` so the
two states are distinguishable.

## Notes

- Small diagnostics improvement, low-risk. High value for debugging the
  OCR pipeline post-hoc.
