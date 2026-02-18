# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**The Transcript Archive** — an interactive web archive of Ohio Wesleyan University's historic student newspaper. Users browse digitized newspaper editions (currently from the 1970s) with vintage aesthetics, weather data, and era-appropriate music.

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
| Build weather archive | `npm run weather:build:ohio` |
| Build music archive | `npm run music:build:us-monthly` |

## Architecture

### Tech Stack

Next.js 16 (App Router) + React 19 + TypeScript 5 + Tailwind CSS 4. Animation via Framer Motion and GSAP. Testing with Vitest + Testing Library (jsdom). Icons from lucide-react.

### Data Flow: Editions Pipeline

Editions are static JSON files, not a database. The pipeline:

1. **OCR output** → `public/editions/{YYYY-MM-DD}/edition.json` (conforms to `OcrEdition` type)
2. **Server adapter** (`src/lib/ocr-adapter.ts`) reads edition.json from disk, classifies articles by category via heuristics, transforms OCR data into frontend `Article`/`VintageAd` types
3. **API routes** (`/api/editions`, `/api/editions/[date]`) expose the transformed data
4. **Client hooks** (`useEditionArticles`, `useArchive`) fetch from API and normalize into component-ready state

To add a new edition: place a folder at `public/editions/YYYY-MM-DD/` containing `edition.json` (matching the `OcrEdition` interface from `src/types/index.ts`) and optionally `images/` and `scanned-newspaper/page{N}.jpg`.

### Feature-Based Architecture

Each domain lives under `src/features/{name}/` with its own components, hooks, context, and barrel `index.ts`. Features:

- **archive** — `ArchiveProvider` context: manages edition list, current date, loading state. Wraps the entire app.
- **news-feed** — Main content: article cards, scan viewer, ads sections. Uses the print-edition layout (`TopStoriesPrintEdition`).
- **weather** — Historical weather sidebar widget. Local Ohio archive (1950-2000) at `public/data/weather/ohio/`, falls back to live APIs for out-of-range dates.
- **music-player** — Sidebar vintage music player. Local Billboard Hot 100 archive (1958-2000) at `public/data/music/us/hot100/`. Date-aware: shows the month's top 10 on edition pages.
- **time-controls** — Header date picker for navigating between editions.
- **navigation** — Left sidebar with section navigation. Uses the FleuronClassic variant.
- **context-panel** — Right sidebar aggregating weather + music player widgets.
- **theme** — Dark/light mode toggle via `data-mode` attribute on `<body>`.

### Shared Components

`src/components/` (aliased as `@/shared`) holds cross-cutting UI: `PageShell` layout wrapper, `ErrorBoundary`, `Skeleton` loader, landing page components, and motion utilities.

### Path Aliases

| Alias | Resolves To |
|-------|-------------|
| `@/*` | `./src/*` (also `./` in tsconfig) |
| `@/features/*` | `./src/features/*` |
| `@/shared/*` | `./src/components/*` |
| `@/styles/*` | `./src/styles/*` |
| `@/src/*` | `./src/*` |

Vitest has its own alias config in `vitest.config.ts` — keep both in sync.

### Styling System

CSS custom properties organized in layers: tokens → base → components (see `src/styles/index.css`). Use semantic tokens (`--color-bg-primary`, `--color-text-primary`, `--color-accent`) rather than raw OWU brand values. Color mode handled via `[data-mode='light']` / `[data-mode='dark']` selectors in `src/styles/tokens/colors.css`. Tailwind classes reference CSS variables (e.g., `bg-[var(--color-bg-primary)]`).

### Types

All shared types live in `src/types/index.ts` — single source of truth for both frontend and OCR/API types. Key types: `Article`, `EditionInfo`, `VintageAd`, `OcrEdition`, `OcrArticle`.

### Tests

Tests live in `tests/` (not colocated). Vitest config at root. Environment: jsdom. Setup file: `tests/setup.ts`. Test files follow pattern `tests/{domain}/{name}.test.ts(x)`.

## Conventions

- Conventional Commits: `feat(scope):`, `fix(scope):`, `refactor(scope):`, etc.
- Prettier: double quotes, semicolons, 2-space indent, 100 char width, trailing commas (es5)
- ESLint: next/core-web-vitals + typescript rules. `no-console` warns (error/warn allowed). Unused vars error (prefix with `_` to ignore).
- Prefix unused function params with `_` to satisfy `@typescript-eslint/no-unused-vars`.
- Feature exports go through barrel `index.ts` files.
