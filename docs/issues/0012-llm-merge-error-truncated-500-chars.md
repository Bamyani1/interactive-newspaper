---
id: 0012
title: llm_merge parse-failure error message truncated to 500 chars
status: open
severity: high
area: ocr
opened: 2026-04-13
---

## Symptom

When Gemini returns malformed or truncated JSON during the merge phase, the
pydantic parse failure is logged with only the first 500 characters of the
raw response. Operators can't see which decision got truncated, where the
JSON broke, or whether the issue was output-token-limit truncation vs
schema mismatch vs some other parse failure.

## Root cause

`ocr/src/transcript_ocr/merging/llm_merge.py:367`:

```python
raw = (response.text or "")[:500]
```

The 500-char cap is useful for a console line but terrible for
post-mortem debugging. The full raw response is discarded after logging.

## Reproduction

Cause Gemini to return a large merge response that truncates mid-JSON (set
a low `max_output_tokens` or process an unusually complex edition). Observe
the error log shows only the first ~500 chars of `raw`.

## Proposed fix

Dump the full raw response to a diagnostics file in the edition's run
directory, and have the console log print the path:

```python
raw = response.text or ""
raw_path = run_dir / "merge_raw_response.txt"
raw_path.write_text(raw, encoding="utf-8")
warning(
    f"merge parse failed: {exc}\n"
    f"  first 500 chars: {raw[:500]}\n"
    f"  full response: {raw_path}"
)
```

This keeps the terse console line while preserving the full context for
debugging.

## Notes

- Pairs well with 0011 (broader except handling) — if you're going to
  continue past a merge failure, at least preserve the evidence.
- Apply the same pattern to any other place where a large LLM response is
  truncated before logging.
