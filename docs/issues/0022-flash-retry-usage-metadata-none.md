---
id: 0022
title: flash-retry reads usage_metadata without chained None check
status: fixed
severity: medium
area: ocr
opened: 2026-04-13
closed: 2026-04-14
---

> **Fix:** `llm_merge.py` flash-retry path now uses
> `getattr(response, "usage_metadata", None)` and inner
> `getattr(flash_usage, "prompt_token_count", None) or 0` chains, so a
> partial usage_metadata object (non-None outer, None inner) can no
> longer crash the retry path and bury the original Pro error under an
> AttributeError.


## Symptom

In the Flash-retry path of `llm_merge`, if the retry response has no
`usage_metadata` the `if flash_usage:` gate passes (because it checks a
different attribute / truthiness), then subsequent `.prompt_tokens`
access on a None-like object raises `AttributeError`. This swallows the
original retry failure context with a misleading traceback.

## Root cause

`ocr/src/transcript_ocr/merging/llm_merge.py:389-396`:

```python
flash_usage = response.usage_metadata
if flash_usage:
    ...
    md.prompt_tokens = flash_usage.prompt_tokens  # may be None
```

`usage_metadata` can be a partial object where some fields are present and
others are None. The `if flash_usage:` check only tests the outer object,
not the specific fields being read.

## Reproduction

Stub a Gemini response where `usage_metadata` is a non-None object with
`prompt_tokens=None` and `prompt_token_count=0`. Trigger the Flash retry
path. Observe `AttributeError` or `TypeError` on the subsequent access.

## Proposed fix

Normalize and guard:

```python
flash_usage = getattr(response, "usage_metadata", None)
if flash_usage is not None:
    md.prompt_tokens = getattr(flash_usage, "prompt_tokens", None) or 0
    md.output_tokens = getattr(flash_usage, "output_tokens", None) or 0
```

Or wrap the whole block in a narrow try/except that logs and continues
with zero-filled metadata.

## Notes

- Small defensive fix. Important because the Flash retry path fires
  exactly when the primary call failed, and losing the original error
  context makes outage debugging harder.
