# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**The Transcript Archive** — an interactive web archive of Ohio Wesleyan University's historic student newspaper. Users browse digitized newspaper editions (currently from the 1960s) with vintage aesthetics, weather data, and era-appropriate music. Includes an AI-powered "Ask the Archive" feature that answers natural-language questions using a RAG pipeline over the article corpus.

## Commands

| Task | Command |
|------|---------|
| Dev server | `npm run dev` |
| Production build | `npm run build` |
| Lint | `npm run lint` |
| Type check | `npx tsc --noEmit` |
| Run all tests | `npm run test:run` |
| Run tests (watch) | `npm run test` |
| Run single test | `npx vitest run tests/hooks/useEditionArticles.test.ts` |
| Seed database (upsert) | `npm run db:seed` |
| Reset + seed database | `npm run db:reset` |
| Embed articles (incremental) | `npm run db:embed` |
| Embed all articles (force) | `npm run db:embed:force` |
| Build weather archive | `npm run weather:build:ohio` |
| Verify weather archive | `npm run weather:verify:ohio` |
| Generate stained-glass SVG | `npm run glass:build` |
| Generate autumn canopy SVG | `npm run canopy:build` |

### Edition Processing Scripts

```bash
scripts/process-edition.sh <path-to-scan-dir>         # Full pipeline: OCR → enrich → cleanup → seed → embed
scripts/process-unprocessed.sh [--parallel N] [--dry-run]  # Batch process multiple editions
node scripts/cleanup-images.mjs [--apply]              # Dry-run image relevance cleanup (--apply writes changes)
```

## Architecture

### Tech Stack

Next.js 16 (App Router) + React 19 + TypeScript 5 + Tailwind CSS 4. Animation via Framer Motion and GSAP. Testing with Vitest + Testing Library (jsdom). Icons from lucide-react. Tailwind v4 uses the PostCSS plugin (`@tailwindcss/postcss`) — there is no `tailwind.config.ts` file.

### Data Flow: Editions Pipeline

Editions are static JSON files (source of truth), seeded into a Neon PostgreSQL database at build time. The pipeline:

1. **OCR output** → `public/editions/{YYYY-MM-DD}/edition.json` (conforms to `OcrEdition` type)
2. **Server adapter** (`src/lib/ocr-adapter.ts`) classifies articles by category via heuristics, transforms OCR data into frontend `Article`/`VintageAd` types
3. **Seed script** (`scripts/db/seed.mjs`) reads JSON files, transforms via ocr-adapter, inserts into Neon PostgreSQL with FTS vectors
4. **Embed script** (`scripts/db/embed.mjs`) generates 768-dim embeddings via `gemini-embedding-001` for articles missing them
5. **Database layer** (`src/lib/db.ts`) provides typed query functions using `@neondatabase/serverless` HTTP driver
6. **API routes** (`/api/editions`, `/api/editions/[date]`, `/api/search`, `/api/articles`, `/api/ask`, `/api/weather/range`) query the database
7. **Client hooks** (`useEditionArticles`, `useArchive`, `useSearch`, `useAskArchive`) fetch from API and normalize into component-ready state

To add a new edition: place a folder at `public/editions/YYYY-MM-DD/` containing `edition.json` (matching the `OcrEdition` interface from `src/types/index.ts`) and optionally `images/` and `scanned-newspaper/page{N}.jpg`. Then run `npm run db:seed && npm run db:embed`.

### Database

Neon PostgreSQL (remote, serverless). Connection via `DATABASE_URL` env var. Schema in `scripts/db/schema.sql`. Tables: `editions`, `articles`, `ads`, `weather`, `music`. The `@neondatabase/serverless` driver uses HTTP (not TCP) — each query is a single HTTP request, no connection pool needed.

Search capabilities:
- **Full-text search**: `search_vector` TSVECTOR column on articles with GIN index
- **Vector search**: `embedding VECTOR(768)` column with HNSW index (cosine distance, m=16, ef_construction=64) via pgvector extension
- **Hybrid search**: Reciprocal Rank Fusion (RRF) combining vector + FTS results (default vector weight 0.7)

### RAG Pipeline (Ask the Archive)

`POST /api/ask` — full retrieval-augmented generation pipeline using Google Gemini:

```
User Question
  → Query Reformulation (src/lib/query-reformulator.ts) — rewrites modern queries into 1960s newspaper language
  → Query Embedding (src/lib/embeddings.ts) — 768-dim via gemini-embedding-001
  → Hybrid Retrieval (src/lib/db.ts) — vector + FTS with RRF fusion
  → Re-Ranking (src/lib/reranker.ts) — LLM relevance scoring, filters by min score
  → Answer Generation (src/lib/answer-generator.ts) — citation-grounded synthesis with confidence level
  → AskResponse with sources, citations, confidence, and timing metadata
```

Each stage has its own timeout and graceful fallback. Requires `GEMINI_API_KEY` or `GOOGLE_API_KEY` env var.

### Feature-Based Architecture

Each domain lives under `src/features/{name}/` with its own components, hooks, context, and barrel `index.ts`. Features:

- **archive** — `ArchiveProvider` context: manages edition list, current date, loading state. Wraps the entire app.
- **ask-archive** — "Ask the Archive" Q&A interface. Components: `AskInput`, `AnswerPanel`, `SourceList`, `SourceCard`, `ConfidenceBadge`. Hook: `useAskArchive`. Page at `/ask`.
- **news-feed** — Main content: article cards, scan viewer, ads sections. Uses the print-edition layout (`TopStoriesPrintEdition`).
- **weather** — Historical weather sidebar widget. Local Ohio archive (1950-2000) at `public/data/weather/ohio/`, falls back to live APIs for out-of-range dates.
- **music-player** — Sidebar vintage music player. Local Billboard Hot 100 archive at `public/top-10-music/{YYYY}.json`. Date-aware: shows the month's top 10 on edition pages.
- **time-controls** — Header date picker for navigating between editions.
- **navigation** — Left sidebar with section navigation. Uses the FleuronClassic variant.
- **context-panel** — Right sidebar aggregating weather + music player widgets.
- **search** — Full-text search across the archive. SearchBar, SearchFilters, SearchResults components + useSearch hook. Page at `/search`.
- **footer** — Site footer component.
- **theme** — Dark/light mode toggle via `data-mode` attribute on `<body>`.

### Shared Components

`src/components/` (aliased as `@/shared`) holds cross-cutting UI: `PageShell` layout wrapper, `ErrorBoundary`, `Skeleton` loader, landing page components, and motion utilities.

### Path Aliases

| Alias | Resolves To (tsconfig) |
|-------|------------------------|
| `@/*` | `./*` (repo root) |
| `@/features/*` | `./src/features/*` |
| `@/shared/*` | `./src/components/*` |
| `@/styles/*` | `./src/styles/*` |

Vitest has its own alias config in `vitest.config.ts`. Note: Vitest maps `@` → `./src` (not repo root), and adds `@/src` → `./src` which tsconfig does not have. Keep both in sync when adding aliases.

### Styling System

CSS custom properties organized in layers: tokens → base → components (see `src/styles/index.css`). Use semantic tokens (`--color-bg-primary`, `--color-text-primary`, `--color-accent`) rather than raw OWU brand values. Color mode handled via `[data-mode='light']` / `[data-mode='dark']` selectors in `src/styles/tokens/colors.css`. Tailwind classes reference CSS variables (e.g., `bg-[var(--color-bg-primary)]`).

### Types

All shared types live in `src/types/index.ts` — single source of truth for both frontend and OCR/API types. Key types: `Article`, `EditionInfo`, `VintageAd`, `SearchResult`, `PaginationInfo`, `OcrEdition`, `OcrArticle`, `AskResponse`, `Citation`.

### Tests

Tests live in `tests/` (not colocated). Vitest config at root. Environment: jsdom. Setup file: `tests/setup.ts`. Test files follow pattern `tests/{domain}/{name}.test.ts(x)`.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `GEMINI_API_KEY` or `GOOGLE_API_KEY` | Google Gemini API (RAG pipeline + embeddings) |

## Conventions

- Conventional Commits: `feat(scope):`, `fix(scope):`, `refactor(scope):`, etc.
- Prettier: double quotes, semicolons, 2-space indent, 100 char width, trailing commas (es5)
- ESLint: next/core-web-vitals + typescript rules. `no-console` warns (error/warn allowed). Unused vars error (prefix with `_` to ignore).
- Prefix unused function params with `_` to satisfy `@typescript-eslint/no-unused-vars`.
- Feature exports go through barrel `index.ts` files.
