# The Transcript Archive — Project Documentation

> Complete reference for developers and AI agents working on this project.
> Last updated: 2026-02-16

---

## 1. Project Overview

**The Transcript Archive** is an interactive web archive of Ohio Wesleyan University's historic student newspaper, *The Transcript*. Users browse digitized editions (currently from the 1970s) with vintage aesthetics, historical weather data, and era-appropriate Billboard Hot 100 music.

### Current State

- **1 edition** processed: January 7, 1970 (8 pages, ~20 articles)
- **Weather archive**: 51 years of Ohio weather data (1950–2000)
- **Music archive**: 509 months of Billboard Hot 100 charts (1958–2000)
- **10 layout variants** for the "Top Stories" section
- **5 navigation sidebar variants**
- **Dark/light mode** with OWU brand colors
- **Scan viewer** for browsing original newspaper page scans

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| UI | React 19 |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 + CSS custom properties |
| Animation | Framer Motion + GSAP |
| Testing | Vitest + Testing Library (jsdom) |
| Icons | lucide-react |
| OCR Pipeline | Python 3.12+ / DocLayout-YOLO / Google Gemini Flash |

---

## 2. How to Run

### Prerequisites

- Node.js 18+ and npm 9+
- Python 3.12+ (only for OCR pipeline)

### Commands

| Task | Command |
|------|---------|
| Dev server | `npm run dev` |
| Production build | `npm run build` |
| Start production | `npm start` |
| Lint | `npm run lint` |
| Type check | `npx tsc --noEmit` |
| Run all tests | `npm run test:run` |
| Run tests (watch) | `npm run test` |
| Run single test | `npx vitest run tests/hooks/useEditionArticles.test.ts` |
| Build weather archive | `npm run weather:build:ohio` |
| Verify weather archive | `npm run weather:verify:ohio` |
| Build music archive | `npm run music:build:us-monthly` |
| Verify music archive | `npm run music:verify:us-monthly` |
| Verify YouTube map | `npm run music:youtube:verify` |

### Deployment (Vercel)

1. Connect repository to Vercel
2. Deploy from `main` branch
3. No environment variables required for the web app
4. Edition data deploys automatically from `public/editions/`
5. No database — all data served from static JSON files

---

## 3. Architecture Overview

### Feature-Based Architecture

Each domain lives under `src/features/{name}/` with its own components, hooks, context, and barrel `index.ts`.

```
User visits /edition/1970-01-07
        │
        ▼
┌─────────────────────────────────────────────────────┐
│  ArchiveProvider (context)                           │
│  ┌─────────┬────────────────────────┬──────────┐    │
│  │ NavBar  │   Main Content Area    │ Context  │    │
│  │ (left)  │                        │ Panel    │    │
│  │         │ ┌─ TimeControls ─────┐ │ (right)  │    │
│  │ Section │ │ Date picker/nav    │ │          │    │
│  │ nav     │ └────────────────────┘ │ Weather  │    │
│  │ links   │ ┌─ HeroSection ─────┐ │ widget   │    │
│  │         │ │ Lead article       │ │          │    │
│  │         │ └────────────────────┘ │ Music    │    │
│  │         │ ┌─ FeaturedGrid ────┐ │ player   │    │
│  │         │ │ Top Stories layout │ │ (top 10) │    │
│  │         │ │ (10 variants)     │ │          │    │
│  │         │ └────────────────────┘ │          │    │
│  │         │ ┌─ ArticleCards ────┐ │          │    │
│  │         │ │ Remaining articles│ │          │    │
│  │         │ └────────────────────┘ │          │    │
│  │         │ ┌─ AdsSection ──────┐ │          │    │
│  │         │ │ Display + classif.│ │          │    │
│  │         │ └────────────────────┘ │          │    │
│  └─────────┴────────────────────────┴──────────┘    │
└─────────────────────────────────────────────────────┘
```

### Data Flow: Editions Pipeline

Editions are static JSON files, not a database:

```
Scanned TIFFs
    │
    ▼  (ocr/convert_scans.py — DocLayout-YOLO + Gemini Flash)
edition.json (OcrEdition type)
    │
    ▼  (ocr/enrich_articles.py — Gemini category classification)
edition.json + categories[] field
    │
    ▼  (ocr/enrich_ads.py — Gemini ad metadata extraction)
edition.json + enriched_ads[] field
    │
    ▼  Committed to public/editions/YYYY-MM-DD/
    │
    ▼  (src/lib/ocr-adapter.ts — server-side transform)
    │   • classifyCategory() — heuristic article categorization
    │   • bodyToHtml() — paragraph conversion
    │   • imageUrls() — path mapping to API routes
    │
    ▼  (API routes — /api/editions, /api/editions/[date])
    │   • ISR caching (60s revalidation)
    │
    ▼  (Client hooks — useEditionArticles, useArchive)
    │   • Client-side state management
    │
    ▼  React components render articles, ads, images
```

### Features

| Feature | Directory | Purpose |
|---------|-----------|---------|
| **archive** | `src/features/archive/` | `ArchiveProvider` context: edition list, current date, loading state. Wraps the entire app. |
| **news-feed** | `src/features/news-feed/` | Main content: article cards, hero section, featured grid, scan viewer, ads. 10 "Top Stories" layout variants. |
| **weather** | `src/features/weather/` | Historical weather sidebar widget. Local Ohio archive (1950–2000), falls back to live APIs for out-of-range dates. |
| **music-player** | `src/features/music-player/` | Sidebar vintage music player. Billboard Hot 100 monthly archive (1958–2000). Date-aware: shows the month's top 10. |
| **time-controls** | `src/features/time-controls/` | Header date picker for navigating between editions. |
| **navigation** | `src/features/navigation/` | Left sidebar with section navigation. 5 visual variants. |
| **context-panel** | `src/features/context-panel/` | Right sidebar aggregating weather + music player widgets. |
| **theme** | `src/features/theme/` | Dark/light mode toggle via `data-mode` attribute on `<body>`. |
| **footer** | `src/features/footer/` | Site footer component. |

---

## 4. Directory Map

```
.
├── src/
│   ├── app/                              # Next.js App Router
│   │   ├── layout.tsx                    # Root layout (fonts, providers)
│   │   ├── page.tsx                      # Landing page
│   │   ├── globals.css                   # Tailwind + style imports
│   │   ├── about/page.tsx
│   │   ├── contact/page.tsx
│   │   ├── edition/
│   │   │   ├── layout.tsx                # Edition page shell
│   │   │   ├── page.tsx                  # /edition (redirects to latest)
│   │   │   ├── error.tsx                 # Error boundary
│   │   │   └── [date]/page.tsx           # /edition/1970-01-07
│   │   ├── api/
│   │   │   ├── editions/
│   │   │   │   ├── route.ts              # GET /api/editions
│   │   │   │   └── [date]/
│   │   │   │       ├── route.ts          # GET /api/editions/[date]
│   │   │   │       └── images/[...path]/route.ts  # Image serving
│   │   │   ├── weather/
│   │   │   │   ├── route.ts              # GET /api/weather
│   │   │   │   └── range/route.ts        # GET /api/weather/range
│   │   │   └── music/route.ts            # GET /api/music
│   │   └── mocks/                        # Layout variant previews
│   │       ├── page.tsx
│   │       ├── mockData.ts
│   │       └── *.tsx                     # Mock variant components
│   │
│   ├── features/
│   │   ├── archive/
│   │   │   ├── context/ArchiveContext.tsx
│   │   │   └── index.ts
│   │   ├── news-feed/
│   │   │   ├── components/
│   │   │   │   ├── NewsFeed.tsx           # Main feed orchestrator
│   │   │   │   ├── HeroSection.tsx        # Lead article display
│   │   │   │   ├── FeaturedGrid.tsx       # Top stories variant selector
│   │   │   │   ├── ArticleCard.tsx        # Individual article card
│   │   │   │   ├── AdsSection.tsx         # Vintage ads display
│   │   │   │   ├── ScanViewer.tsx         # Original page scan viewer
│   │   │   │   ├── EditionMasthead.tsx    # Edition header
│   │   │   │   ├── EditionFooter.tsx      # Edition footer
│   │   │   │   └── variants/             # 10 Top Stories layout variants
│   │   │   │       ├── TopStoriesDefault.tsx
│   │   │   │       ├── TopStoriesBroadside.tsx
│   │   │   │       ├── TopStoriesColumnSplit.tsx
│   │   │   │       ├── TopStoriesFrontPage.tsx
│   │   │   │       ├── TopStoriesLedgerList.tsx
│   │   │   │       ├── TopStoriesMagazineSpread.tsx
│   │   │   │       ├── TopStoriesMosaic.tsx
│   │   │   │       ├── TopStoriesScrapbook.tsx
│   │   │   │       ├── TopStoriesTabloidStack.tsx
│   │   │   │       ├── TopStoriesTelegraph.tsx
│   │   │   │       ├── ExpandedArticleSlot.tsx
│   │   │   │       └── TopStoriesVariantProps.ts
│   │   │   ├── hooks/
│   │   │   │   ├── useEditionArticles.ts  # Fetch edition data
│   │   │   │   ├── useKeyboardNavigation.ts
│   │   │   │   └── useScanViewer.ts       # Scan viewer state
│   │   │   ├── data/mockData.ts
│   │   │   └── index.ts
│   │   ├── navigation/
│   │   │   ├── components/
│   │   │   │   ├── NavigationSidebar.tsx
│   │   │   │   ├── MobileNav.tsx
│   │   │   │   └── variants/             # 5 nav sidebar variants
│   │   │   │       ├── BroadsheetCompact.tsx
│   │   │   │       ├── DispatchMono.tsx
│   │   │   │       ├── FleuronClassic.tsx
│   │   │   │       ├── LedgerRuled.tsx
│   │   │   │       └── SpecimenCentered.tsx
│   │   │   └── index.ts
│   │   ├── music-player/
│   │   │   ├── components/SidebarPlayer.tsx
│   │   │   ├── data/musicData.ts
│   │   │   ├── hooks/useMonthlyTrendingMusic.ts
│   │   │   └── index.ts
│   │   ├── weather/
│   │   │   ├── hooks/useHistoricalWeather.ts
│   │   │   └── index.ts
│   │   ├── time-controls/
│   │   │   ├── components/TimeControls.tsx
│   │   │   └── index.ts
│   │   ├── context-panel/
│   │   │   ├── components/ContextSidebar.tsx
│   │   │   └── index.ts
│   │   ├── theme/
│   │   │   ├── components/
│   │   │   │   ├── ThemeModeManager.tsx
│   │   │   │   └── ThemeModeToggle.tsx
│   │   │   └── index.ts
│   │   └── footer/
│   │       ├── components/SiteFooter.tsx
│   │       └── index.ts
│   │
│   ├── components/                       # Shared UI (aliased as @/shared)
│   │   ├── index.ts
│   │   ├── ErrorBoundary.tsx
│   │   ├── landing/
│   │   │   ├── ArtDecoFrame.tsx
│   │   │   ├── CinemaBackground.tsx
│   │   │   ├── EditionPicker.tsx
│   │   │   ├── Ticker.tsx
│   │   │   └── data/headlines.ts
│   │   ├── layout/
│   │   │   └── PageShell/index.tsx       # 3-column layout wrapper
│   │   ├── motion/
│   │   │   ├── MotionProvider.tsx
│   │   │   ├── PageTransition.tsx
│   │   │   ├── Reveal.tsx
│   │   │   └── motionTokens.ts
│   │   └── ui/
│   │       └── Skeleton.tsx
│   │
│   ├── lib/
│   │   ├── ocr-adapter.ts               # OCR → frontend type transformer
│   │   ├── weather-local-archive.ts      # Local weather data reader
│   │   ├── weather.ts                    # Weather API fallback logic
│   │   └── music-local-archive.ts        # Local music data reader
│   │
│   ├── styles/
│   │   ├── index.css                     # Layer orchestration
│   │   ├── tokens/
│   │   │   ├── colors.css                # Color palette + semantic tokens
│   │   │   ├── typography.css            # Fonts, type scale, weights
│   │   │   └── spacing.css              # Spacing, layout, z-index, shadows
│   │   ├── base/
│   │   │   ├── reset.css                # Global reset + prose styles
│   │   │   └── animations.css           # All @keyframes
│   │   └── components/
│   │       ├── article-card.css
│   │       ├── cinema-landing.css
│   │       ├── edition-background.css
│   │       ├── edition-picker.css
│   │       ├── sidebar-player.css
│   │       ├── site-footer.css
│   │       └── time-controls.css
│   │
│   └── types/
│       └── index.ts                      # Single source of truth for all types
│
├── public/
│   ├── editions/                         # Processed newspaper data
│   │   └── 1970-01-07/
│   │       ├── edition.json              # Structured OCR output
│   │       ├── diagnostics.json          # OCR processing metadata
│   │       ├── images/                   # Extracted article images
│   │       └── 000N_Page N.md            # Per-page markdown (8 pages)
│   ├── data/
│   │   ├── weather/ohio/                 # Historical weather archive
│   │   │   ├── meta/stations.json        # 1,479 Ohio weather stations
│   │   │   ├── raw/by-year/              # 1950–2000 NDJSON (gzipped)
│   │   │   ├── index/
│   │   │   │   ├── delaware-by-date-1950-2000.json
│   │   │   │   └── statewide-by-date-1950-2000.json
│   │   │   └── manifest.json
│   │   └── music/us/hot100/              # Billboard Hot 100 archive
│   │       ├── meta/youtube-map.json     # YouTube URL mappings
│   │       ├── raw/hot-100-current.snapshot.csv.gz
│   │       ├── index/
│   │       │   ├── monthly-top10-1958-2000.json
│   │       │   └── tracks-catalog-1958-2000.json
│   │       └── manifest.json
│   └── backgrounds/
│       ├── background.jpg
│       └── edition-background.jpg
│
├── ocr/                                  # OCR Pipeline (Python, dev-only)
│   ├── convert_scans.py                  # Main OCR: DocLayout-YOLO + Gemini
│   ├── enrich_articles.py                # AI category classification
│   ├── enrich_ads.py                     # AI ad metadata extraction
│   ├── viewer.py                         # Local preview server (port 8080)
│   └── requirements.txt
│
├── scripts/                              # Node.js data pipeline scripts
│   ├── weather/
│   │   ├── build-ohio-weather-archive.mjs
│   │   └── verify-ohio-weather-archive.mjs
│   └── music/
│       ├── build-us-monthly-hot100-archive.mjs
│       ├── verify-us-monthly-hot100-archive.mjs
│       └── verify-youtube-map.mjs
│
├── tests/                                # Test suite (18 test files)
│   ├── setup.ts
│   ├── edition-picker/
│   ├── font-color/
│   ├── footer/
│   ├── hooks/
│   ├── music/
│   ├── music-player/
│   ├── news-feed/
│   ├── time-controls/
│   └── weather/
│
├── CLAUDE.md                             # AI agent instructions
├── doc.md                                # This file
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── eslint.config.mjs
├── postcss.config.mjs
└── .prettierrc
```

---

## 5. Data Pipeline

### OCR Pipeline (Python)

The OCR pipeline converts scanned newspaper TIFFs into structured JSON. It is **development-only** — only the output JSON files are deployed.

#### Step 1: Extract articles and images (`convert_scans.py`)

```bash
cd ocr
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Requires GEMINI_API_KEY in environment or .env
python convert_scans.py ../public/editions/YYYY-MM-DD/
```

**Process:**
1. **DocLayout-YOLO** detects photo/image regions in each page
2. **Google Gemini Flash** extracts article text, headlines, bylines, and ad copy
3. Images extracted and saved to `images/` subdirectory
4. Validates image aspect ratios and sizes (rejects artifacts)
5. Outputs `edition.json` conforming to the `OcrEdition` type

**Cost:** ~60K tokens per page ≈ $0.01 per 8-page edition
**Duration:** ~2.5 minutes per page (8 pages ≈ 20 minutes)

#### Step 2: Classify article categories (`enrich_articles.py`)

```bash
python enrich_articles.py --date 1970-01-07
```

Sends article headlines + previews to Gemini. Returns a `categories[]` array (parallel to `articles[]`) with values: News, Sports, Features, Opinion, Arts, Campus Life. Idempotent — use `--force` to re-classify.

#### Step 3: Enrich advertisement metadata (`enrich_ads.py`)

```bash
python enrich_ads.py --date 1970-01-07
```

Extracts from each ad: category, ad_type (display/classified), display_text, phone, address, price. Writes `enriched_ads[]` to `edition.json` alongside original `ads[]`. Idempotent — use `--force` to re-enrich.

#### Step 4: Preview locally (`viewer.py`)

```bash
python viewer.py          # Serves on port 8080
python viewer.py 9000     # Custom port
```

Lightweight HTTP server with HTML frontend for previewing OCR output before deployment.

### Edition JSON Schema

Each edition at `public/editions/YYYY-MM-DD/edition.json` conforms to the `OcrEdition` type:

```json
{
  "edition_date": "1970-01-07",
  "publication_info": "The Ohio Wesleyan Transcript Delaware OH 1970-01-07",
  "articles": [
    {
      "headline": "Article Title",
      "author": "By John Smith, Sports Editor",
      "body": "Full article text...",
      "image_files": ["0001_Page 1_img1.jpg"],
      "images": [{ "caption": "Photo description", "position": "top-left" }],
      "source_pages": ["1", "2"]
    }
  ],
  "ads": [
    { "business_name": "Joe's Pizza", "body": "Ad copy...", "image_files": [] }
  ],
  "enriched_ads": [
    {
      "business_name": "Joe's Pizza", "body": "Ad copy...",
      "category": "Food & Drink", "ad_type": "display",
      "display_text": "Joe's Pizza - Fresh pizza daily",
      "phone": "740-369-1234", "address": "123 Main St", "price": "$5-$15",
      "image_files": []
    }
  ],
  "categories": ["News", "Sports", "Arts"],
  "other_content": [{ "title": "Calendar", "body": "..." }]
}
```

### Adding a New Edition

1. Create folder: `public/editions/YYYY-MM-DD/`
2. Place scanned TIFF pages in the folder
3. Run: `python ocr/convert_scans.py public/editions/YYYY-MM-DD/`
4. Run: `python ocr/enrich_articles.py --date YYYY-MM-DD`
5. Run: `python ocr/enrich_ads.py --date YYYY-MM-DD`
6. Optionally add `scanned-newspaper/page{N}.jpg` for the scan viewer
7. Commit and deploy

---

## 6. Static Data Archives

### Weather Archive

**Location:** `public/data/weather/ohio/`
**Range:** 1950-01-01 to 2000-12-31 (18,628 days)
**Source:** NOAA Global Historical Climatology Network (GHCN) daily data
**Default station:** Delaware, Ohio (40.2987°N, 83.0679°W) — home of Ohio Wesleyan

| File | Description | Size |
|------|-------------|------|
| `meta/stations.json` | 1,479 Ohio weather stations | — |
| `raw/by-year/YYYY.ndjson.gz` | 51 yearly NDJSON files (gzipped) | — |
| `index/delaware-by-date-1950-2000.json` | Fast date lookup (Delaware) | ~7.8 MB |
| `index/statewide-by-date-1950-2000.json` | Fast date lookup (statewide avg) | — |
| `manifest.json` | SHA256 hashes, file sizes | — |

**Data flow:**
1. Client hook `useHistoricalWeather(date)` calls `/api/weather?date=YYYY-MM-DD&scope=delaware`
2. API checks local archive first (`weather-local-archive.ts`)
3. Falls back to live OpenMeteo Archive API for out-of-range dates
4. Returns `DailyWeatherRecord`: `tmax_c`, `tmin_c`, `precip_mm`
5. Hook converts Celsius → Fahrenheit for display

**Rebuild:** `npm run weather:build:ohio` (downloads from NOAA, builds indexes)

### Music Archive

**Location:** `public/data/music/us/hot100/`
**Range:** 1958-08 to 2000-12 (509 months)
**Source:** UTData Billboard Hot 100 historical archive (CSV, 221,300 rows)

| File | Description | Size |
|------|-------------|------|
| `meta/youtube-map.json` | YouTube URL mappings for tracks | — |
| `raw/hot-100-current.snapshot.csv.gz` | Full Billboard CSV snapshot | — |
| `index/monthly-top10-1958-2000.json` | Top 10 tracks per month | ~907 KB |
| `index/tracks-catalog-1958-2000.json` | 20,928 unique track entries | ~2.8 MB |
| `manifest.json` | SHA256 hashes, ETags, metadata | — |

**Data flow:**
1. Client hook `useMonthlyTrendingMusic(date)` calls `/api/music?date=YYYY-MM-DD`
2. API reads local archive (`music-local-archive.ts`)
3. Returns `MonthlyTrendingRecord`: top 10 tracks with rank, title, artist, points
4. Hook provides formatted labels: "August 1970", source attribution

**Track IDs:** SHA1 hash of canonical key (normalized `title|performer`), 16-char hex.

**Rebuild:** `npm run music:build:us-monthly` (downloads CSV, computes monthly rankings)

---

## 7. API Routes

### `GET /api/editions`

Lists all available editions.

**Response:**
```json
{
  "editions": [
    { "id": "1970-01-07", "date": "1970-01-07", "pageCount": 8, "articleCount": 20 }
  ]
}
```

**Caching:** ISR with 60s revalidation.

### `GET /api/editions/[date]`

Fetches a specific edition's articles, ads, and metadata.

**Response:**
```json
{
  "edition": { "id": "1970-01-07", "date": "1970-01-07", "pageCount": 8, "publicationInfo": "..." },
  "articles": [{ "id": "...", "category": "News", "headline": "...", ... }],
  "ads": [{ "title": "...", "body": "...", "category": "Food & Drink", ... }],
  "pagination": { "nextCursor": null, "hasMore": false }
}
```

**Caching:** ISR with 60s revalidation.

### `GET /api/editions/[date]/images/[...path]`

Serves extracted article images. Includes path traversal protection. Returns raw image data with appropriate Content-Type. Cache: immutable (1 year).

### `GET /api/weather`

Historical weather for a single date.

**Parameters:** `date` (required), `scope` ("delaware" | "statewide"), `force_fallback`
**Response:**
```json
{
  "query": { "date": "1970-01-07", "scope": "delaware" },
  "record": { "date": "1970-01-07", "tmax_c": 2.8, "tmin_c": -5.6, "precip_mm": 0, ... },
  "reason": null,
  "attempts": ["LOCAL_ARCHIVE:delaware-by-date"]
}
```

### `GET /api/weather/range`

Weather for a date range (max 366 days). Processes in batches of 10.

**Parameters:** `start_date`, `end_date` (required), `scope`
**Response:** Batch results with statistics (`total_days`, `populated_days`, `missing_days`, etc.)

### `GET /api/music`

Monthly Billboard Hot 100 top 10 for a date.

**Parameters:** `date` (required, YYYY-MM-DD)
**Response:**
```json
{
  "query": { "date": "1970-01-07", "month": "1970-01" },
  "record": {
    "month": "1970-01",
    "source": "BILLBOARD_HOT100_MONTHLY_ARCHIVE",
    "tracks": [
      { "rank": 1, "title": "Raindrops Keep Fallin'...", "artist": "B.J. Thomas", ... }
    ]
  },
  "reason": null,
  "attempts": ["LOCAL_ARCHIVE:hot100-monthly"]
}
```

**Error reasons:** `INVALID_DATE`, `OUT_OF_ARCHIVE_RANGE`, `NO_DATA`

---

## 8. Server-Side Adapter (`src/lib/ocr-adapter.ts`)

The central transformation layer that converts raw OCR JSON into frontend-ready types.

| Function | Purpose |
|----------|---------|
| `listEditions()` | Scans `public/editions/` for valid YYYY-MM-DD folders |
| `loadEdition(date)` | Loads and caches `edition.json` for a date |
| `transformArticles(edition)` | Converts `OcrArticle[]` → `Article[]` with categories, HTML body, image URLs |
| `transformAds(edition)` | Converts `OcrAd[]` / `OcrEnrichedAd[]` → `VintageAd[]` |
| `classifyCategory(article)` | Heuristic categorization from byline tags, keywords |
| `bodyToHtml(text)` | Strips OCR page-break markers, converts to `<p>` tags |
| `extractSummary(text)` | First paragraph, truncated to 300 chars |
| `imageUrls(date, files)` | Maps filenames → `/api/editions/[date]/images/[name]` |
| `computePageCount(edition)` | Calculates total pages from `source_pages` metadata |

**Category classification priority:**
1. Explicit byline tags: "By NAME, Sports" or "Sports Editor"
2. Opinion markers: "Editor, the transcript", "By Editorial", class years ('89, '90)
3. Keyword regex: `SPORTS_RE` and `ARTS_RE` against headline
4. Default: "News"

**Caching:** Module-level caches for edition list and loaded editions (safe for immutable static data).

---

## 9. Type System

All shared types live in `src/types/index.ts` — single source of truth.

### Frontend Types

```typescript
interface Article {
  id: string;
  date: string;
  category: "News" | "Sports" | "Features" | "Opinion" | "Arts" | "Campus Life";
  headline: string;
  summary: string;
  fullText: string;          // HTML
  imageUrls: string[];
  byline?: string | null;
  page: number;
  isHero: boolean;
  isFeatured: boolean;
  imageCaption?: string | null;
}

interface EditionInfo {
  id: string; date: string; pageCount: number; articleCount: number;
}

interface VintageAd {
  title: string; body: string;
  category?: AdCategory; adType?: AdType;
  displayText?: string; phone?: string; address?: string; price?: string;
}

type AdCategory = "Food & Drink" | "Entertainment" | "Services" | "Retail"
  | "Greek Life" | "Jobs" | "Housing" | "Education" | "Events" | "Other";

type SectionId = "Top" | Article["category"] | "Ads" | "Classifieds" | "All";
```

### Weather Types

```typescript
type WeatherSource = "NOAA_GHCN_DAILY_ARCHIVE" | "NOAA_DAILY_SUMMARIES"
  | "ACIS_STNDATA" | "OPEN_METEO_ARCHIVE";

interface DailyWeatherRecord {
  date: string; tmax_c: number | null; tmin_c: number | null;
  precip_mm: number | null; source: WeatherSource;
  source_station_id: string | null; quality_flag: string | null;
  is_estimated: boolean; raw: Record<string, unknown>;
}
```

### Music Types

```typescript
type MusicSource = "BILLBOARD_HOT100_MONTHLY_ARCHIVE";

interface MonthlyTrendingTrack {
  rank: number; track_id: string; title: string; artist: string;
  youtubeId: string | null; points_total: number;
  best_rank: number; weeks_present: number;
}

interface MonthlyTrendingRecord {
  month: string; source: MusicSource; tracks: MonthlyTrendingTrack[];
}
```

### OCR / Server-Side Types

```typescript
interface OcrEdition {
  edition_date: string; publication_info: string;
  articles: OcrArticle[]; ads: OcrAd[];
  enriched_ads?: OcrEnrichedAd[];
  categories?: string[];    // parallel to articles[], from enrich_articles.py
  other_content: { title: string; body: string }[];
}

interface OcrArticle {
  headline: string; author: string; body: string;
  images: OcrImage[]; image_files: string[]; source_pages: string[];
}
```

---

## 10. Styling System

### Architecture

CSS custom properties organized in three layers: **tokens → base → components**.

```
src/styles/index.css          ← orchestrates imports
├── tokens/colors.css         ← OWU brand + semantic color tokens
├── tokens/typography.css     ← font families, type scale (1.25 ratio)
├── tokens/spacing.css        ← spacing (4px base), layout dims, z-index, shadows
├── base/reset.css            ← HTML/body reset, prose utilities
├── base/animations.css       ← all @keyframes
└── components/*.css          ← per-component styles
```

### Color System (3-tier)

**Tier 1 — OWU Brand:**
```css
--owu-red: #DA0037;
--owu-black: #15191d;
--owu-white: #e6e6e6;
--owu-charcoal: #444444;
```

**Tier 2 — Semantic Tokens (dark mode default):**
- Backgrounds: `--color-bg-primary`, `--color-bg-secondary`, `--color-bg-inverse`, `--color-bg-muted`, `--color-bg-glass`
- Text: `--color-text-primary`, `--color-text-secondary`, `--color-text-inverse`, `--color-text-header`
- Accent: `--color-accent` (red), `--color-accent-hover`, `--color-accent-light`
- Borders: `--color-border-default`, `--color-border-accent`

**Tier 3 — Component-specific tokens** for cinema landing, art deco frame, press theme, etc.

**Light mode:** Overridden via `[data-mode='light']` selector in `colors.css`.

### Typography

Three Google Fonts loaded in `layout.tsx`:
- **Libre Baskerville** → `--font-header`, `--font-masthead`, `--font-accent`
- **Crimson Pro** → `--font-body`
- **Work Sans** → `--font-mono` (UI labels, sans-serif contexts)

Type scale: modular 1.25 ratio from `--text-xs` (12px) to `--text-6xl` (48.83px).

### Tailwind 4 Integration

No `tailwind.config.js` — uses Tailwind 4's native CSS plugin. CSS variables mapped in `globals.css`:

```css
@import "tailwindcss";
@import "../styles/index.css";

@theme {
  --color-bg-primary: var(--color-bg-primary);
  --font-header: var(--font-header);
  /* ... */
}
```

Components use Tailwind classes referencing variables: `bg-[var(--color-bg-primary)]`, `text-[var(--color-text-primary)]`.

---

## 11. Layout Variant System

### Top Stories Variants (10)

The "Top Stories" section above the main article feed has 10 visual layout variants. Selected via `localStorage` key `tts-layout-design`.

| Variant | File | Description |
|---------|------|-------------|
| Default | `TopStoriesDefault.tsx` | Standard grid layout |
| Broadside | `TopStoriesBroadside.tsx` | Broadsheet newspaper style |
| Column Split | `TopStoriesColumnSplit.tsx` | Multi-column split |
| Front Page | `TopStoriesFrontPage.tsx` | Classic front page layout |
| Ledger List | `TopStoriesLedgerList.tsx` | Ledger/list format |
| Magazine Spread | `TopStoriesMagazineSpread.tsx` | Magazine-style spread |
| Mosaic | `TopStoriesMosaic.tsx` | Mosaic tile layout |
| Scrapbook | `TopStoriesScrapbook.tsx` | Collage/scrapbook style |
| Tabloid Stack | `TopStoriesTabloidStack.tsx` | Tabloid-style stacked |
| Telegraph | `TopStoriesTelegraph.tsx` | Minimalist telegraph style |

Shared props defined in `TopStoriesVariantProps.ts`. All variants use `ExpandedArticleSlot.tsx` for article detail expansion.

### Navigation Variants (5)

The left sidebar has 5 visual variants that complement the Top Stories layouts:

| Variant | File |
|---------|------|
| Broadsheet Compact | `BroadsheetCompact.tsx` |
| Dispatch Mono | `DispatchMono.tsx` |
| Fleuron Classic | `FleuronClassic.tsx` |
| Ledger Ruled | `LedgerRuled.tsx` |
| Specimen Centered | `SpecimenCentered.tsx` |

Layout mock previews available at `/mocks` route during development.

---

## 12. Key Features Detail

### Scan Viewer

Full-featured modal for viewing original scanned newspaper pages.

**Capabilities:**
- Zoom: 0.75x to 2.5x (0.25 increments)
- Keyboard: Escape closes, Tab focus trapping within modal
- Accessibility: `role="dialog"`, `aria-modal="true"`, `inert` on background, body scroll lock
- Animations: Framer Motion fade + scale transitions
- Thumbnail strip: Horizontal page navigation with page number badges

**Files:** `ScanViewer.tsx` (component) + `useScanViewer.ts` (state hook)

### Landing Page

Cinema-themed landing with animated elements:
- `CinemaBackground.tsx` — Animated background
- `ArtDecoFrame.tsx` — Decorative frame element
- `EditionPicker.tsx` — Edition selection dropdown
- `Ticker.tsx` — Scrolling headline ticker (data from `headlines.ts`)

### Client-Side Caching

Both weather and music hooks implement identical caching patterns:
- LRU cache: max 50 entries
- In-flight request deduplication
- Graceful error handling with descriptive labels

---

## 13. Testing

### Structure

Tests live in `tests/` (not colocated with source). Environment: jsdom. Setup file: `tests/setup.ts` (imports `@testing-library/jest-dom/vitest`).

### Test Files (18 total)

| Domain | Test File | Coverage |
|--------|-----------|----------|
| Edition picker | `edition-picker/edition-picker.test.tsx` | Component rendering |
| Font/color | `font-color/colorPresets.data.test.ts` | Color preset data |
| Font/color | `font-color/customizers.test.tsx` | Customizer components |
| Footer | `footer/edition-footer.test.tsx` | Edition footer |
| Footer | `footer/site-footer.test.tsx` | Site footer |
| Hooks | `hooks/useEditionArticles.test.ts` | Edition data fetching |
| Music | `music/build-us-monthly-hot100-archive.test.ts` | Archive build script |
| Music | `music/music-api-local-first.test.ts` | API local-first logic |
| Music | `music/us-monthly-hot100-archive-integrity.test.ts` | Archive integrity |
| Music | `music/youtube-seed-1988.test.ts` | YouTube mapping |
| Music player | `music-player/sidebar-player-proximity.test.tsx` | Player proximity |
| News feed | `news-feed/news-feed-data-source.test.tsx` | Data source |
| Time controls | `time-controls/time-controls-theme.test.tsx` | Theme integration |
| Weather | `weather/build-ohio-weather-archive.test.ts` | Archive build script |
| Weather | `weather/historical-weather-service.test.ts` | Weather service |
| Weather | `weather/ohio-weather-archive-integrity.test.ts` | Archive integrity |
| Weather | `weather/weather-api-local-first.test.ts` | API local-first logic |

### Configuration

```typescript
// vitest.config.ts
{
  environment: "jsdom",
  globals: true,
  setupFiles: ["./tests/setup.ts"],
  include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
}
```

**Path aliases** in Vitest config must match `tsconfig.json` — keep both in sync.

---

## 14. Configuration Files

| File | Purpose |
|------|---------|
| `tsconfig.json` | TypeScript config with path aliases (`@/*`, `@/features/*`, `@/shared/*`, `@/styles/*`) |
| `next.config.ts` | Next.js config: SVG images, YouTube/placeholder remote patterns |
| `vitest.config.ts` | Test config: jsdom, globals, matching path aliases |
| `eslint.config.mjs` | ESLint: next/core-web-vitals + TypeScript. `no-console` warns. Unused vars error (prefix `_`). |
| `postcss.config.mjs` | PostCSS with `@tailwindcss/postcss` plugin (Tailwind 4) |
| `.prettierrc` | Double quotes, semicolons, 2-space indent, 100 char width, ES5 trailing commas, LF |
| `package.json` | Dependencies, scripts, project metadata |

### Path Aliases

| Alias | Resolves To |
|-------|-------------|
| `@/*` | `./` (project root) |
| `@/features/*` | `./src/features/*` |
| `@/shared/*` | `./src/components/*` |
| `@/shared` | `./src/components` |
| `@/styles/*` | `./src/styles/*` |
| `@/src/*` | `./src/*` |

---

## 15. Conventions

- **Commits:** Conventional Commits — `feat(scope):`, `fix(scope):`, `refactor(scope):`, etc.
- **Formatting:** Prettier with double quotes, semicolons, 2-space indent, 100 char width
- **Linting:** ESLint next/core-web-vitals + TypeScript. `no-console` warns (error/warn allowed). Unused vars error (prefix with `_`).
- **Exports:** Features export through barrel `index.ts` files
- **Types:** All shared types in `src/types/index.ts` — single source of truth
- **Styling:** Semantic CSS tokens, not raw values. `bg-[var(--color-bg-primary)]` not `bg-[#15191d]`.
- **Theme mode:** `data-mode` attribute on `<body>`, not CSS class

---

## 16. Gotchas & Tips

### Data Location
- Edition data **must** be in `public/editions/` to deploy
- Weather/music archives in `public/data/` — large but static, committed to repo
- OCR pipeline code (`ocr/`) is committed but not deployed

### Image Paths
- Images in `edition.json` use relative filenames (e.g., `0001_Page 1_img1.jpg`)
- `ocr-adapter.ts` maps these to `/api/editions/{date}/images/{filename}`
- The image API route includes path traversal protection

### No Database
- ~50 editions is the target scale — JSON files work fine
- ISR (60s revalidation) caches edition data
- Keep total editions under ~100 MB for fast Vercel deploys

### OCR API Keys (dev-only)
- `GEMINI_API_KEY` — required for all OCR scripts
- Gemini 1.5 Flash: ~$0.01 per 8-page edition
- Not needed for running the web app

### Layout Selection
- Top Stories variant stored in `localStorage` key `tts-layout-design`
- Navigation variant matches the Top Stories variant
- Preview all variants at the `/mocks` route

### Build Troubleshooting
```bash
# Clear caches
rm -rf .next node_modules
npm install
npm run build
```

### Edition Not Found
- Check `public/editions/{date}/edition.json` exists
- Verify date format: YYYY-MM-DD
- Check `ocr-adapter.ts` path configuration

### Archive Data Integrity
```bash
npm run weather:verify:ohio        # Verify weather archive
npm run music:verify:us-monthly    # Verify music archive
```

---

## 17. Root Layout & Provider Stack

The app wraps all pages in this provider hierarchy (see `src/app/layout.tsx`):

```
<html>
  <body data-theme="jazz" data-mode="dark">
    <ThemeModeManager />        ← Syncs dark/light mode from localStorage
    <MotionProvider>             ← Framer Motion config (reduced motion support)
      <ArchiveProvider>          ← Edition list, current date, loading state
        <ErrorBoundary>          ← Catches rendering errors
          <PageTransition>       ← Page-level animations
            {children}
          </PageTransition>
        </ErrorBoundary>
      </ArchiveProvider>
    </MotionProvider>
  </body>
</html>
```

Three Google Fonts loaded via Next.js font optimization: Libre Baskerville, Crimson Pro, Work Sans.





