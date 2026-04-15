---
id: 0014
title: continuation marker extraction returns [] on truncated page text
status: fixed
severity: high
area: ocr
opened: 2026-04-13
closed: 2026-04-14
---

> **Fix (partial — diagnostic only):** `docai_provider.py` now has a
> `_detect_truncated_continuation` helper called after
> `_extract_continuation_markers`. When the tail of a page's DocAI text
> looks like a half-formed continuation phrase ("Cont", "Continued on pa")
> that the regex didn't match, we emit a warning so operators can see the
> lost signal. The heuristic is deliberately conservative (last 64 chars,
> only flags when a known prefix is present AND no full regex match
> covered it). **We did NOT add the Gemini-based fallback extraction** —
> that would add new LLM calls and change which continuations get linked,
> which is a behavior change.


## Symptom

When DocAI truncates a page (long column, bottom clipped, OCR quality
issue), continuation markers like "Continued on page 4" get cut mid-sentence
("Continued on pa...", "Continued on..."). The regex patterns in
`_CONTINUATION_PATTERNS` don't match the truncated text, the extractor
returns an empty list, and the merge phase treats the article as self-
contained. Cross-page article merging silently loses the continuation.

## Root cause

`ocr/src/transcript_ocr/recognition/docai_provider.py:158-164`:

```python
def _extract_continuation_markers(text: str) -> list[ContinuationMarker]:
    markers = []
    for pattern in _CONTINUATION_PATTERNS:
        for match in pattern.finditer(text):
            ...
    return markers
```

An empty list is returned for both "no markers present" and "markers
present but truncated". These states are indistinguishable downstream.

## Reproduction

Create a synthetic page where the text ends with "Cont" or
"Continued on pa" (common DocAI truncation). Feed it to the extractor.
Observe the returned list is empty even though a continuation marker is
visible in the source text.

## Proposed fix

Two-part:

1. **Detect truncation** — flag pages where text length is at the DocAI
   limit, ends mid-word, or lacks sentence-terminating punctuation. Store
   this as a diagnostic (`diag.page.text_truncated = True`).

2. **Fallback extraction** — on suspected-truncated pages, fall back to a
   Gemini-based extraction that can tolerate partial markers, or apply a
   looser regex that matches "Cont[a-z]*" near the end of the text.

Either change is cheap; the diagnostic alone is enough to make the issue
visible even before a fix is in place.

## Notes

- Cross-page article merging correctness depends on this signal. Missing
  continuations directly worsen RAG retrieval for longer articles.
- Related: 0011, 0012.
