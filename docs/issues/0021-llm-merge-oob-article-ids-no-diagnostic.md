---
id: 0021
title: llm_merge tolerates out-of-bounds article_ids with only a warning
status: open
severity: medium
area: ocr
opened: 2026-04-13
---

## Symptom

When Gemini hallucinates `article_ids` outside the valid range during
merge, `llm_merge` filters the IDs and warns per-offense, then silently
drops the affected merge group. There is no aggregate diagnostic of how
many merge groups were lost. If Gemini reliably hallucinates on a
particular edition type, operators won't notice until the merge quality
drops below a noticeable threshold.

## Root cause

`ocr/src/transcript_ocr/merging/llm_merge.py:433-444`:

```python
for aid in group.article_ids:
    if not (0 <= aid < len(article_data)):
        warning(f"merge dropped oob article id {aid}")
        continue
    ...
```

Per-offense warnings only. No count rolled up into diagnostics or the
run report.

## Proposed fix

Track counts and surface them in the edition's diagnostics bundle:

```python
oob_ids = []
oob_groups = 0
for group in merge_groups:
    clean_ids = []
    for aid in group.article_ids:
        if 0 <= aid < len(article_data):
            clean_ids.append(aid)
        else:
            oob_ids.append(aid)
    if not clean_ids:
        oob_groups += 1
        continue
    ...

if oob_ids:
    diag.merge["oob_count"] = len(oob_ids)
    diag.merge["oob_sample"] = oob_ids[:10]
    diag.merge["oob_groups_dropped"] = oob_groups
```

Surface in the run report so a spike in hallucinations is visible.

## Notes

- Related to 0011, 0012, 0013 — all about merge-phase observability.
