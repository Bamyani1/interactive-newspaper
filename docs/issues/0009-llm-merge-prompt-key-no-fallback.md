---
id: 0009
title: llm_merge uses PROMPTS["seam_repair"] with no key fallback
status: fixed
severity: high
area: ocr
opened: 2026-04-13
closed: 2026-04-14
---

> **Fix:** `config/prompts_loader.py` now validates required prompt keys
> (`seam_repair`) at module load and raises `RuntimeError` with a descriptive
> message if any are missing. A stale deploy or a partial manual edit that
> drops the key now fails loudly at pipeline startup instead of crashing mid-
> merge with a cryptic KeyError.


## Symptom

If `prompts.json` (or equivalent) is missing the `seam_repair` key — stale
deploy, partial manual edit, merge conflict resolution gone wrong — merge
crashes with `KeyError: 'seam_repair'` during seam validation, taking down
the entire edition pipeline run for that edition.

## Root cause

`ocr/src/transcript_ocr/merging/llm_merge.py:102`:

```python
seam_prompt = PROMPTS["seam_repair"].format(tail=tail, head=head)
```

Direct dict access without a key guard. The module loader only deserializes
JSON; it does not validate that the expected keys exist.

## Reproduction

Delete the `seam_repair` key from the prompts JSON file, then run any
edition through the merge phase.

## Proposed fix

Two complementary hardenings:

1. **Module-load validation** — at prompt-loading time, assert that a short
   list of required keys is present, and raise a descriptive error if any
   is missing:
   ```python
   REQUIRED_PROMPT_KEYS = ("seam_repair", "merge_groups", ...)
   missing = [k for k in REQUIRED_PROMPT_KEYS if k not in PROMPTS]
   if missing:
       raise RuntimeError(f"prompts.json missing required keys: {missing}")
   ```

2. **Call-site safety** — use `PROMPTS.get("seam_repair")` with an explicit
   check so the failure point is clearly reported, even if module-load
   validation is bypassed.

## Notes

- Low probability in a stable deploy but high blast radius when it hits.
- Consider applying the same pattern to any other direct dict access of
  prompts throughout `merging/` and `recognition/`.
