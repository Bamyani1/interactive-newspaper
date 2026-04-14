---
id: 0008
title: page_extractor accesses .page_number on possibly-None response.parsed
status: open
severity: high
area: ocr
opened: 2026-04-13
---

## Symptom

When Gemini blocks a page (safety filter, empty OCR content, quota exceeded
during response generation) and returns a response with `parsed=None`,
`ocr/src/transcript_ocr/recognition/page_extractor.py:105` raises
`AttributeError: 'NoneType' object has no attribute 'page_number'`. The page
fails with a confusing traceback instead of taking the intended "skip page"
diagnostic path.

## Root cause

The line was written assuming the preceding `if response.parsed:` guard
covered all subsequent access, but the expression at line 105 still
dereferences `.page_number` outside that guard (or via an `or` fallback
that short-circuits past the guard).

## Reproduction

Feed the extractor a page that Gemini safety-filters (or stub the Gemini
call to return `SimpleNamespace(parsed=None)`). Observe `AttributeError`
instead of the intended diagnostic.

## Proposed fix

Use `getattr` with a default:

```python
page_num = (
    _extract_page_number_from_filename(...)
    or getattr(response.parsed, "page_number", None)
    or "0"
)
```

Or restructure so the `response.parsed is None` branch returns a diagnostic
before reaching line 105.

## Notes

- This failure mode is likely hit during the 29 editions with page failures
  noted in project memory (2026-04-07).
- Related to issue 0011 (broader exception handling in edition_pipeline).
