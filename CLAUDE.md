# The Transcript Archive — CLAUDE.md

## Project

A Next.js app that turns scanned OWU historical newspaper issues into a searchable, readable archive with RAG-powered Q&A. Content flows: raw TIF scans → Python OCR pipeline → `edition.json` → Node seed scripts → Neon Postgres → API routes → React UI.

Full project reference: `docs/PROJECT_MASTER_GUIDE.md`

---

## Tech Stack

- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, Framer Motion
- **Backend:** Next.js API routes (server-side), Neon Postgres (serverless driver)
- **AI/LLM:** Google Gemini (`@google/genai`) — OCR extraction, RAG answer generation, embeddings, reranking
- **OCR pipeline:** Python 3.12 package at `ocr/src/transcript_ocr/`; wrappers at `ocr/*.py`
- **Testing:** Vitest (TypeScript), pytest (Python)

---

## Dev Commands

```bash
# Frontend
npm run dev          # Start dev server
npm run build        # Production build (runs tsc)
npm run lint         # ESLint
npm run test         # Vitest watch mode
npm run test:run     # Vitest run (CI mode) — 269 tests

# Database
npm run db:seed      # Seed editions into Neon DB
npm run db:reset     # Drop + recreate all tables, then seed
npm run db:embed     # Generate vector embeddings for articles
npm run db:embed:force  # Force re-embed all

# OCR pipeline
scripts/ocr/process-edition.sh <folder>   # Process one edition
scripts/ocr/process-unprocessed.sh        # Batch process all unprocessed

# Python tests
python -m pytest tests/ocr/ -x           # OCR test suite (34 tests + 7 skip-if-no-output)
python -m pytest tests/ocr/architecture/ # Import boundary / architecture tests (run in CI)

# Specific test targets
npm run test:golden      # OCR golden snapshot test (1980-04-17)
npm run test:invariants  # OCR pipeline invariant tests
```

---

## Project Structure

```
src/
  app/                  # Next.js App Router pages + API routes
    api/                # editions, search, ask, weather routes
    edition/[date]/     # Edition reading page
    search/, ask/       # Search and Q&A pages
  features/             # Feature modules (news-feed, search, ask-archive, music-player, weather, context-panel, navigation, archive)
  lib/                  # Shared utilities (db.ts, embeddings.ts, answer-generator.ts, reranker.ts, weather-local-archive.ts)
  server/               # Server-only code (ocr-adapter — transforms edition.json → DB rows)
  types/                # Shared TypeScript types (index.ts)

ocr/
  src/transcript_ocr/   # Python OCR package (page_pipeline, edition_pipeline, merging, diagnostics)
  convert_scans.py      # Main OCR entry point
  enrich_ads.py         # Post-OCR ad enrichment
  compare_runs.py       # Parity comparison utility
  score_gold.py         # Gold scoring utility
  inbox/                # Drop new scan folders here (gitignored)
  done/                 # Completed scans moved here (gitignored)
  runs/                 # Diagnostics, logs, artifacts (gitignored)
  models/               # YOLO weights — auto-downloaded (gitignored)

scripts/
  db/seed.mjs           # DB seed + reset
  db/embed.mjs          # Embedding generation
  db/schema.sql         # DB schema (editions, articles, ads, weather, music)
  ocr/                  # Shell wrappers for OCR pipeline
  weather/              # Weather archive build/verify scripts
  cleanup-images.mjs    # Post-OCR image cleanup

public/
  editions/<date>/      # edition.json + images — output of OCR pipeline
  data/weather/ohio/    # index/ (app reads this), meta/ (seed metadata)
  gold-score/           # OCR evaluation reference TIFFs
  top-10-music/         # Monthly music chart data
  shape/, backgrounds/  # UI assets

tests/
  hooks/, news-feed/, api/, lib/, weather/, ocr/   # Vitest + pytest suites
  ocr/fixtures/golden/  # Golden metric snapshots (pipeline-golden.test.ts)
  ocr/fixtures/parity/  # Parity keyset fixtures (test_parity_harness.py)

docs/                   # Project documentation (PROJECT_MASTER_GUIDE.md, ocr-audit/)
.github/workflows/      # ocr-architecture.yml — runs import boundary + architecture tests on PR/push
```

---

## Architecture

Five cooperating blocks:

1. **Frontend** — Next.js App Router pages consume API routes; feature modules in `src/features/`
2. **API layer** — Server routes in `src/app/api/` query Neon DB; `POST /api/ask` runs full RAG pipeline
3. **Database** — Neon Postgres; tables: `editions`, `articles`, `ads`, `weather`, `music`; FTS + pgvector for retrieval
4. **OCR pipeline** — Python package processes scanned TIFs page-by-page, merges cross-page stories, writes `edition.json` + diagnostics artifacts
5. **Ops scripts** — Shell + Node scripts for process/seed/embed/cleanup lifecycle

---

## Data Flow

```
ocr/inbox/<folder>/   ← drop new scan TIFs here
      ↓
scripts/ocr/process-edition.sh
      ↓
ocr/convert_scans.py  →  public/editions/<date>/edition.json + images/
      ↓
ocr/enrich_ads.py  (post-OCR ad enrichment)
scripts/cleanup-images.mjs  (prune/reassign image attachments)
      ↓
npm run db:seed  →  src/server/ocr-adapter/  →  Neon Postgres
      ↓
npm run db:embed  →  vector embeddings stored in articles table
      ↓
src/app/api/*  ←→  Next.js UI pages
```

---

## Environment Variables

All in `.env.local` (never commit this file):

```
DATABASE_URL=                    # Neon Postgres connection string
GOOGLE_API_KEY=                  # Gemini API — OCR + RAG + embeddings
GOOGLE_CLOUD_PROJECT=            # Document AI project ID
DOCUMENT_AI_PROCESSOR_ID=        # Layout parser processor
DOCUMENT_AI_LOCATION=            # us
LAYOUT_PARSER_PROCESSOR_ID=      # Secondary layout processor
```

---

## Testing

| Suite | Command | Covers |
|---|---|---|
| TypeScript (Vitest) | `npm run test:run` | UI components, hooks, API routes, lib utilities, OCR adapter |
| Python (pytest) | `python -m pytest tests/ocr/ -x` | OCR pipeline logic, architecture boundaries, artifact contracts |
| CI (GitHub Actions) | `.github/workflows/ocr-architecture.yml` | Import rules, wrapper entrypoints, runtime cutover — runs on every PR |

**Notes:**
- `test_artifact_schema_contracts.py` and `test_parity_harness.py` auto-skip when `ocr/runs/` is absent; they activate after a pipeline run.
- Golden test (`pipeline-golden.test.ts`) validates against `tests/ocr/fixtures/golden/1980-04-17.metrics.json`.

---

## Conventions

- **Feature modules**: Business logic lives in `src/features/<feature>/`; no cross-feature imports
- **API routes**: Always validate inputs; return typed JSON; use 400/404/500/502/504 correctly
- **OCR adapter**: `src/server/ocr-adapter/` is the only place that transforms `edition.json` → DB shape
- **Date format**: Always `YYYY-MM-DD` strings; never Date objects across API boundaries
- **No `Co-Authored-By`** in git commits
- **Do not auto-commit** — only commit when explicitly asked

---

## Current Production State

- **Only edition in DB and `public/editions/`:** `1980-04-17`
- **DB:** Neon Postgres (`little-feather-41857937`); 27 articles, 21 ads for 1980-04-17
- **Branch:** `rag-enhanced` is the active development branch; `main` is production base

---

## Do Not Modify Without Explicit Instruction

- `.env.local` — credentials
- `public/editions/1980-04-17/` — the only production edition on disk
- `public/gold-score/` — OCR evaluation reference TIFFs
- `public/data/weather/ohio/index/` — pre-built weather index (18,628 daily entries, 1950–2000)
- `scripts/db/schema.sql` — schema changes require migration plan

---

## Deep Reference

- Full product + API + pipeline documentation: `docs/PROJECT_MASTER_GUIDE.md`
- OCR pipeline internals deep dive: `docs/ocr-audit/full-e2e-ocr-pipeline-deep-dive.md`
