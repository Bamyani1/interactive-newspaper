# Production Cleanup Design

**Date:** 2026-02-23
**Branch:** `rag-enhanced`
**Approach:** B — Moderate

---

## Problem

The repository has accumulated development artifacts, legacy pipeline versions, experimental UI pages, dev utilities, duplicate scripts, and gitignore gaps during active development. Before processing real newspaper editions and transitioning to production, the codebase needs to be reduced to only what is required to build, run, test, and deploy the system.

---

## Audit Summary

**Total disk footprint:** ~2.3 GB
**Tracked files:** 223
**Actual clutter (tracked):** ~950 KB across confirmed-dead files
**Gitignored artifacts (local disk):** ~1.95 GB (`.next/`, `node_modules/`, `ocr/.venv/`, `ocr/models/`)

### Clutter categories

| Category | Location | Action |
|---|---|---|
| Legacy pipeline code | `ocr/convert_scans_legacy.py`, `ocr/enrich_ads_legacy.py` | Delete |
| Dead code module | `font-color/` | Delete |
| Duplicate shell scripts | `scripts/process-edition.sh`, `scripts/process-unprocessed.sh` (root) | Delete (shadowed by `scripts/ocr/`) |
| Dev utilities | `ocr/compare_runs.py`, `ocr/score_gold.py`, `test-rag.sh`, `scripts/test-fetch.js`, `scripts/gen_gold.py`, `scripts/generate-*.mjs` | Move to `scripts/dev/` |
| Experimental UI pages | `src/app/mock/`, `src/app/mock2/` | Delete |
| Orphaned data | `public/editions/images/` (2 loose JPEGs) | Delete |
| Leaked credential cache | `gen-lang-client-*.json` (root) | Delete + gitignore pattern |
| OS junk | `.DS_Store` files throughout | Delete |
| Gitignore gaps | Build caches, venv, model weights | Add patterns |

---

## What Changes

### Files deleted (git rm)

- `gen-lang-client-0206085956-9da4f5a4c7e1.json`
- `test-rag.sh`
- `ocr/convert_scans_legacy.py`
- `ocr/enrich_ads_legacy.py`
- `ocr/pipeline/` (empty directory)
- `font-color/` (entire directory)
- `scripts/process-edition.sh` (root duplicate)
- `scripts/process-unprocessed.sh` (root duplicate)
- `src/app/mock/page.tsx`
- `src/app/mock2/page.tsx`

### Files removed (untracked)

- `public/editions/images/` (2 orphaned JPEGs)
- `public/backgrounds/background.png`, `background.jpeg`, `background2.jpg`, `background3.jpg`
- `.DS_Store` files throughout

### Dev utilities staged

Moved to `scripts/dev/` (kept but separated from production code):

- `ocr/compare_runs.py`
- `ocr/score_gold.py`
- `scripts/test-fetch.js`
- `scripts/gen_gold.py`
- `scripts/generate-autumn-canopy-svg.mjs`
- `scripts/generate-doodle-svg.mjs`
- `scripts/generate-stained-glass-svg.mjs`

### Gitignore additions

```gitignore
gen-lang-client-*.json
ocr/output/
ocr/unprocessed/
ocr/models/
__pycache__/
*.pyc
.pytest_cache/
.venv/
.next/
out/
node_modules/
.DS_Store
Thumbs.db
```

### Database reset

`npm run db:reset` — drops all tables, recreates from `scripts/db/schema.sql`, re-seeds from `public/editions/1980-04-17/edition.json`. Safest approach: uses committed schema, eliminates dev/test records, produces a clean production state.

---

## Do Not Touch

```
public/editions/1980-04-17/        # Only production edition
public/gold-score/                 # OCR regression test TIFs (176 MB)
public/data/weather/ohio/index/    # Pre-built weather index (18,628 entries)
scripts/db/schema.sql              # Schema (requires migration plan to change)
.env.local                         # Credentials
ocr/src/                           # Core OCR Python package
src/server/ocr-adapter/            # DB transformation logic
.github/workflows/                 # CI pipelines
```

---

## Review Required (deferred)

| Item | Question | How to verify |
|---|---|---|
| `tests/ocr/fixtures/golden/1970-05-28.metrics.json` | Is this a planned regression anchor or a dev artifact? | Confirm if 1970-05-28 is a planned future edition |
| `tests/ocr/fixtures/parity/1970-05-28-full-run-2.keysets.json` | Same as above | Same |
| `public/gold-score/` (176 MB TIFs in git) | Should these move to Git LFS or external storage? | Evaluate CI build time impact |

---

## Execution Order

1. Tag repo: `git tag pre-production-cleanup`
2. Verify CI green: `npm run test:run` + `python -m pytest tests/ocr/ -x`
3. Remove tracked clutter: `git rm` for all deleted files
4. Remove untracked files: `.DS_Store`, orphaned images, dead backgrounds
5. Stage dev utilities: `git mv` to `scripts/dev/`
6. Update `.gitignore`
7. Remove local gitignored artifacts: `.next/`, `node_modules/`, `ocr/.venv/`, `ocr/output/`, `__pycache__/`
8. Reset database: `npm run db:reset`
9. Verification: `npm run build` + `npm run test:run` + `python -m pytest tests/ocr/ -x` + `npm run lint`
10. Commit: `chore: production cleanup — remove dead code, legacy files, and dev artifacts`
