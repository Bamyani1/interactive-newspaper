# Production Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove all confirmed-dead code, legacy files, dev utilities, and build artifacts to leave a clean, production-ready repository.

**Architecture:** Approach B (Moderate) — delete confirmed-dead tracked files via `git rm`, move dev utilities to `scripts/dev/` staging, remove untracked junk, patch `.gitignore` gaps, then reset the database and verify the full test suite still passes.

**Tech Stack:** git, Node.js/npm, Python/pytest, Neon Postgres (via `npm run db:reset`)

---

## Pre-flight: What is tracked vs untracked

**Tracked (require `git rm`):**
- `font-color/` (5 files)
- `scripts/process-edition.sh` (root duplicate)
- `scripts/process-unprocessed.sh` (root duplicate)
- `test-rag.sh`
- `src/app/mock/page.tsx`
- `src/app/mock2/page.tsx`, `src/app/mock2/ThemeSelector.tsx`, `src/app/mock2/themes.ts`
- `scripts/generate-autumn-canopy-svg.mjs`
- `scripts/generate-doodle-svg.mjs`
- `scripts/generate-stained-glass-svg.mjs`

**Untracked (just `rm` or `mv`):**
- `ocr/convert_scans_legacy.py`
- `ocr/enrich_ads_legacy.py`
- `gen-lang-client-0206085956-9da4f5a4c7e1.json` (root, covered by `*.json` gitignore but present on disk)
- `public/editions/images/` (2 orphaned JPEGs)
- `ocr/compare_runs.py`
- `ocr/score_gold.py`
- `scripts/test-fetch.js`
- `scripts/gen_gold.py` (lives at `scripts/gen_gold.py`)

**Do not touch — ever:**
```
public/editions/1980-04-17/        # Only production edition
public/gold-score/                 # OCR regression TIFs
public/data/weather/ohio/index/    # Pre-built weather index
scripts/db/schema.sql              # DB schema
ocr/src/                           # Core OCR package
src/server/ocr-adapter/            # DB transform logic
.github/workflows/                 # CI
```

---

### Task 1: Create safety restore point

**Files:** none

**Step 1: Verify you are on the right branch**

```bash
git branch --show-current
```
Expected output: `rag-enhanced`

**Step 2: Tag current state**

```bash
git tag pre-production-cleanup
```
Expected: no output (tag created silently)

**Step 3: Verify tag exists**

```bash
git tag | grep pre-production
```
Expected: `pre-production-cleanup`

---

### Task 2: Establish green baseline

**Files:** none (read-only verification)

**Step 1: Run all TypeScript tests**

```bash
npm run test:run
```
Expected: `269 tests passed` — all green. If any fail, stop and fix before proceeding.

**Step 2: Run all Python tests**

```bash
python -m pytest tests/ocr/ -x
```
Expected: all tests pass (34+ tests, some skip when `ocr/output/` absent — that is fine).

If either suite has failures, do not continue. Fix the failures first.

---

### Task 3: Delete tracked dead code — font-color module

**Files:**
- Delete: `font-color/components/ColorCustomizer.tsx`
- Delete: `font-color/components/FontCustomizer.tsx`
- Delete: `font-color/data/colorPresets.ts`
- Delete: `font-color/data/fontPresets.ts`
- Delete: `font-color/styles/font-color-kit.css`

The `font-color/` directory is a dead custom theme system with no references in any production route. Its test was already deleted (`tests/font-color/` removed per git status).

**Step 1: Confirm no imports exist**

```bash
grep -r "font-color" src/ --include="*.tsx" --include="*.ts" -l
```
Expected: no output. If any files appear, investigate before deleting.

**Step 2: Remove the directory**

```bash
git rm -r font-color/
```
Expected: lists 5 files removed.

**Step 3: Commit**

```bash
git commit -m "chore: remove dead font-color module"
```

---

### Task 4: Delete tracked dead code — duplicate root scripts

**Files:**
- Delete: `scripts/process-edition.sh`
- Delete: `scripts/process-unprocessed.sh`

These are duplicates of `scripts/ocr/process-edition.sh` and `scripts/ocr/process-unprocessed.sh`. The `scripts/ocr/` versions are canonical.

**Step 1: Confirm the ocr/ versions exist**

```bash
ls scripts/ocr/process-edition.sh scripts/ocr/process-unprocessed.sh
```
Expected: both files listed.

**Step 2: Remove the root duplicates**

```bash
git rm scripts/process-edition.sh scripts/process-unprocessed.sh
```

**Step 3: Commit**

```bash
git commit -m "chore: remove duplicate OCR shell scripts from scripts/ root"
```

---

### Task 5: Delete tracked dead code — test-rag.sh

**Files:**
- Delete: `test-rag.sh`

One-off RAG test script from development. Not referenced by any npm script or CI workflow.

**Step 1: Confirm not referenced in package.json or CI**

```bash
grep -r "test-rag" package.json .github/ 2>/dev/null
```
Expected: no output.

**Step 2: Remove**

```bash
git rm test-rag.sh
```

**Step 3: Commit**

```bash
git commit -m "chore: remove dev test-rag.sh script"
```

---

### Task 6: Delete tracked dead code — experimental UI pages

**Files:**
- Delete: `src/app/mock/page.tsx`
- Delete: `src/app/mock2/page.tsx`
- Delete: `src/app/mock2/ThemeSelector.tsx`
- Delete: `src/app/mock2/themes.ts`

Theme playground pages used during UI development. No production links point to `/mock` or `/mock2`.

**Step 1: Confirm no nav links reference these routes**

```bash
grep -r '"/mock"' src/ --include="*.tsx" --include="*.ts"
grep -r '"/mock2"' src/ --include="*.tsx" --include="*.ts"
```
Expected: no output from either command.

**Step 2: Remove**

```bash
git rm src/app/mock/page.tsx
git rm src/app/mock2/page.tsx src/app/mock2/ThemeSelector.tsx src/app/mock2/themes.ts
```

**Step 3: Verify build still works**

```bash
npm run build 2>&1 | tail -5
```
Expected: build completes with no errors.

**Step 4: Commit**

```bash
git commit -m "chore: remove experimental mock UI pages"
```

---

### Task 7: Move tracked dev utilities to scripts/dev/

**Files:**
- Move: `scripts/generate-autumn-canopy-svg.mjs` → `scripts/dev/generate-autumn-canopy-svg.mjs`
- Move: `scripts/generate-doodle-svg.mjs` → `scripts/dev/generate-doodle-svg.mjs`
- Move: `scripts/generate-stained-glass-svg.mjs` → `scripts/dev/generate-stained-glass-svg.mjs`

SVG generator scripts for `public/shape/`. The output SVGs are already committed and static. These generators are not part of any build step but are kept for future design iteration.

**Step 1: Confirm none referenced in package.json**

```bash
grep -E "generate-.*svg" package.json
```
Expected: no output.

**Step 2: Create staging directory and move**

```bash
mkdir -p scripts/dev
git mv scripts/generate-autumn-canopy-svg.mjs scripts/dev/
git mv scripts/generate-doodle-svg.mjs scripts/dev/
git mv scripts/generate-stained-glass-svg.mjs scripts/dev/
```

**Step 3: Commit**

```bash
git commit -m "chore: move SVG generator scripts to scripts/dev/"
```

---

### Task 8: Remove untracked legacy OCR files

**Files:**
- Delete: `ocr/convert_scans_legacy.py`
- Delete: `ocr/enrich_ads_legacy.py`

These are the old monolithic OCR implementation, replaced by the `ocr/src/transcript_ocr/` package + wrapper entrypoints. They are untracked (never committed), so only disk cleanup is needed.

**Step 1: Confirm they are untracked**

```bash
git status ocr/convert_scans_legacy.py ocr/enrich_ads_legacy.py
```
Expected: both shown as `??` (untracked).

**Step 2: Confirm active wrappers still exist**

```bash
ls ocr/convert_scans.py ocr/enrich_ads.py
```
Expected: both present.

**Step 3: Delete**

```bash
rm ocr/convert_scans_legacy.py ocr/enrich_ads_legacy.py
```

No commit needed — these were never tracked.

---

### Task 9: Remove untracked GCloud credential cache

**Files:**
- Delete: `gen-lang-client-0206085956-9da4f5a4c7e1.json` (root)

Auto-generated Google Cloud client credentials file. Already covered by the `*.json` gitignore pattern, so never committed — just present on disk.

**Step 1: Confirm untracked**

```bash
git status gen-lang-client-0206085956-9da4f5a4c7e1.json
```
Expected: `??` (untracked) or file not shown.

**Step 2: Delete**

```bash
rm gen-lang-client-0206085956-9da4f5a4c7e1.json
```

---

### Task 10: Remove untracked orphaned public images

**Files:**
- Delete: `public/editions/images/` (directory with 2 loose JPEGs)

Two JPEG files not linked to any edition. Artifacts from an early development pipeline run.

**Step 1: Confirm untracked**

```bash
git status public/editions/images/
```
Expected: `??` (untracked).

**Step 2: Confirm no references in edition.json**

```bash
grep -r "editions/images" public/editions/1980-04-17/edition.json
```
Expected: no output.

**Step 3: Delete**

```bash
rm -rf public/editions/images/
```

---

### Task 11: Move untracked dev utilities to scripts/dev/

**Files:**
- Move: `ocr/compare_runs.py` → `scripts/dev/compare_runs.py`
- Move: `ocr/score_gold.py` → `scripts/dev/score_gold.py`
- Move: `scripts/test-fetch.js` → `scripts/dev/test-fetch.js`
- Move: `scripts/gen_gold.py` → `scripts/dev/gen_gold.py`

These are developer utilities for OCR evaluation and debugging. Not part of any CI step or build pipeline but worth keeping for future use.

**Step 1: Confirm scripts/dev/ exists (created in Task 7)**

```bash
ls scripts/dev/
```
Expected: the three SVG generator scripts from Task 7.

**Step 2: Move the files**

```bash
mv ocr/compare_runs.py scripts/dev/compare_runs.py
mv ocr/score_gold.py scripts/dev/score_gold.py
mv scripts/test-fetch.js scripts/dev/test-fetch.js
mv scripts/gen_gold.py scripts/dev/gen_gold.py
```

**Step 3: Add and commit**

```bash
git add scripts/dev/
git commit -m "chore: move dev utility scripts to scripts/dev/"
```

---

### Task 12: Patch .gitignore gaps

**Files:**
- Modify: `.gitignore`

Three patterns are missing: `ocr/unprocessed/`, `*.pyc`, and `.pytest_cache/`. Everything else is already covered.

**Step 1: Read current .gitignore to find insertion point**

Open `.gitignore` and locate the Python virtual environments section (lines 83–86):

```
# Python Virtual Environments
ocr/.venv/
ocr/venv/
ocr/env/
```

**Step 2: Add the three missing patterns after the existing Python section**

In `.gitignore`, after the `# Python bytecode` block (`__pycache__/`), add:

```gitignore
*.pyc
.pytest_cache/
```

And after the `# OCR scan inputs (large TIFFs)` block, add:

```gitignore
ocr/unprocessed/
```

**Step 3: Verify no important files would be newly ignored**

```bash
git status
```
Check that no production files appear as newly ignored. Expected: only untracked junk disappears.

**Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: add missing gitignore patterns for pyc, pytest cache, ocr/unprocessed"
```

---

### Task 13: Clean local gitignored artifacts (disk only)

These files are gitignored — removing them only frees disk space. They regenerate automatically.

**Step 1: Remove build artifacts**

```bash
rm -rf .next/
```
Regenerate with: `npm run build`

**Step 2: Remove Python caches**

```bash
find . -type d -name "__pycache__" -not -path "./.git/*" -exec rm -rf {} + 2>/dev/null || true
find . -type d -name ".pytest_cache" -not -path "./.git/*" -exec rm -rf {} + 2>/dev/null || true
find . -name "*.pyc" -not -path "./.git/*" -delete 2>/dev/null || true
```

**Step 3: Remove OCR working artifacts**

```bash
rm -rf ocr/output/
```
Regenerated by: `scripts/ocr/process-edition.sh <folder>`

**Step 4: (Optional — only if disk space is critical)**

These take significant time to regenerate, so only do this if space is needed:
```bash
rm -rf node_modules/     # Regenerate: npm install
rm -rf ocr/.venv/        # Regenerate: pip install -r ocr/requirements.txt
rm -rf ocr/models/       # Regenerate: auto-downloaded on next OCR run
```

No commit needed — these are gitignored.

---

### Task 14: Reset database to clean production state

**Files:** none (database operation)

`npm run db:reset` drops all tables, recreates them from `scripts/db/schema.sql`, then re-seeds from `public/editions/1980-04-17/edition.json`. This eliminates any dev/test records and produces a clean baseline.

**Step 1: Verify the schema file is intact**

```bash
wc -l scripts/db/schema.sql
```
Expected: non-zero line count (should be ~80+ lines).

**Step 2: Verify the production edition json exists**

```bash
ls -lh public/editions/1980-04-17/edition.json
```
Expected: file present, non-zero size.

**Step 3: Run db:reset**

```bash
npm run db:reset
```
Expected: output confirming tables dropped, recreated, and seeded. Should show `27 articles` and `21 ads` for 1980-04-17.

**Step 4: Generate embeddings for fresh seed data**

```bash
npm run db:embed
```
Expected: embeddings generated for articles.

---

### Task 15: Final verification pass

All production systems must pass before cleanup is considered done.

**Step 1: Run TypeScript test suite**

```bash
npm run test:run
```
Expected: all 269 tests pass. Any new failures indicate something was accidentally removed — check git diff and restore.

**Step 2: Run Python test suite**

```bash
python -m pytest tests/ocr/ -x
```
Expected: all tests pass.

**Step 3: Run linter**

```bash
npm run lint
```
Expected: no errors.

**Step 4: Verify production build**

```bash
npm run build
```
Expected: build completes with no errors. If a page fails to build because of a removed component (e.g., mock page), check for stray imports.

**Step 5: Final commit if any loose ends**

```bash
git status
```
If any modified files remain (e.g., `.gitignore` if not yet committed), commit them:

```bash
git add -A
git status  # review carefully before committing
git commit -m "chore: production cleanup — final pass"
```

**Step 6: Push**

```bash
git push origin rag-enhanced
```

---

## Recovery

If anything breaks and you need to restore:

```bash
git checkout pre-production-cleanup
```

Or to restore a specific deleted file:

```bash
git checkout pre-production-cleanup -- path/to/file
```
