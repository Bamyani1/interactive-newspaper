---
id: 0020
title: OCR tempfile creation in content_rescue/ad_enrichment uses suffix-only
status: fixed
severity: medium
area: ocr
opened: 2026-04-13
closed: 2026-04-14
---

> **Fix:** both `content_rescue.py` and `ad_enrichment.py` now pass
> explicit `prefix="rescue_"` / `prefix="ads_"` to `tempfile.mkstemp`, so
> two concurrent processes touching the same edition directory cannot
> produce colliding tempfile names. The surrounding atomic-write logic
> (`os.replace`) is unchanged.


## Symptom

`tempfile.mkstemp(dir=..., suffix=".json")` in
`content_rescue.py:198` and `ad_enrichment.py:94` writes temp files next
to the target `edition.json`. If two jobs process the same edition
concurrently (e.g., rerunning a failed edition while another run has
started), tempfiles can collide or shadow each other in unexpected ways.

## Root cause

`tempfile.mkstemp` with only a suffix guarantees uniqueness within a
*single process* via its internal counter, but not across concurrent
processes in the same directory with no prefix distinction.

## Reproduction

Run two instances of the edition pipeline against the same
`public/editions/<date>/` simultaneously. Observe possible conflicts on
the tempfile path or on `os.replace`.

## Proposed fix

Two complementary changes:

1. **Add unique prefixes.**
   ```python
   tempfile.mkstemp(dir=..., suffix=".json", prefix="rescue_")
   tempfile.mkstemp(dir=..., suffix=".json", prefix="ads_")
   ```

2. **Write to a dedicated tmp dir.** Move tempfiles to
   `ocr/runs/<edition>/tmp/` so they never share a directory with the
   finished `edition.json`:
   ```python
   tmp_dir = run_dir / "tmp"
   tmp_dir.mkdir(parents=True, exist_ok=True)
   tempfile.mkstemp(dir=tmp_dir, suffix=".json", prefix="rescue_")
   ```

Prefer option 2 — it's more defensive and doesn't put build artifacts in
the same dir as final output.

## Notes

- Unlikely under normal operator workflow but possible in automated
  rerun scenarios.
