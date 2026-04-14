---
id: 0021
title: llm_merge tolerates out-of-bounds article_ids with only a warning
status: fixed
severity: medium
area: ocr
opened: 2026-04-13
closed: 2026-04-14
---

> **Fix:** `llm_merge.py` now tracks an aggregate `oob_ids_total` count
> and `oob_groups_dropped` count across all merge groups, and appends a
> single summary line to `md.duplicate_warnings` with the total, a
> 10-element sample of the offending ids, and the count of groups that
> had only out-of-bounds ids. Per-offense warnings are preserved for
> quick-glance debugging. Merge-group drop behavior is unchanged.


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
