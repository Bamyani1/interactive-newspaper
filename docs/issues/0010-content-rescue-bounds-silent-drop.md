---
id: 0010
title: content_rescue silently drops out-of-bounds index decisions
status: open
severity: high
area: ocr
opened: 2026-04-13
---

## Symptom

When Gemini returns a triage decision with `index=10` but only 5 suspect
articles exist, `content_rescue.py` silently skips the decision without
logging. The operator has no idea how many promotions / demotions were lost.
In rescue-heavy runs this can drop a large fraction of Gemini's work with no
trace.

## Root cause

`ocr/src/transcript_ocr/application/content_rescue.py:126-127`:

```python
if decision.decision == "demote" and 0 <= decision.index < len(suspect_indices):
    ...
```

No else branch. No counter. No diagnostic entry. Same pattern for the
corresponding `promote` branch.

## Reproduction

Force Gemini to return a triage decision with an out-of-range index (e.g.,
by stubbing the response). Run content_rescue. Observe no log line for the
dropped decision.

## Proposed fix

Track dropped decisions and surface them in diagnostics:

```python
dropped = []
for decision in decisions:
    if decision.decision == "demote":
        if 0 <= decision.index < len(suspect_indices):
            ...
        else:
            dropped.append((decision.decision, decision.index, len(suspect_indices)))
    elif ...

if dropped:
    warning(f"content_rescue: dropped {len(dropped)} out-of-bounds decisions: {dropped}")
    diag.content_rescue["oob_decisions"] = dropped
```

Include in the edition's run report so operators can see dropped counts
alongside the successfully applied rescue actions.

## Notes

- Discovered during audit, no specific incident attached yet.
- Related: 0011 (broader exception handling in edition_pipeline's Phase 5).
