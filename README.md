# The Transcript Archive

> AI-powered searchable archive of Ohio Wesleyan University's student newspaper — 40 years of scanned print editions (1960–2000) turned into a multimodal RAG-powered research tool.

![Next.js](https://img.shields.io/badge/Next.js-16-black)
![React](https://img.shields.io/badge/React-19-61dafb)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)
![Python](https://img.shields.io/badge/Python-3.12-3776ab)
![Postgres](https://img.shields.io/badge/Postgres-pgvector-336791)
![Gemini](https://img.shields.io/badge/Gemini-embedding_001-4285f4)
![License](https://img.shields.io/badge/License-MIT-green)

---

## What It Does

- **Browse the archive** — Navigate 80+ digitized editions with period-accurate typography, date controls, and an era-aware reading experience.
- **Ask the Archive** — Natural-language Q&A powered by a full RAG pipeline: query reformulation, hybrid vector + full-text search, Gemini reranking, and cited answer generation.
- **Multimodal visual queries** — Ask "show me protest photos" and get a visual-mode answer with a `TimelineGallery` of matching article thumbnails. Text and image embeddings live in the same vector space (`gemini-embedding-001`).
- **End-to-end OCR pipeline** — A Python pipeline turns raw TIF scans into structured `edition.json`: DocAI layout parsing, DocLayout-YOLO region detection, Gemini structuring, cross-page article merging, ad enrichment, and per-run diagnostics.
- **Historical context** — Offline Ohio weather archive (1950–2000) and monthly US top-10 music archive (1958–2000) for period-accurate sidebars.

> For a deep technical walkthrough — architecture, pipeline internals, hardening decisions, and skills demonstrated — see [`PROJECT_DESCRIPTION.md`](./PROJECT_DESCRIPTION.md).

---

## Tech Stack

**Frontend**
- Next.js 16 (App Router) · React 19 · TypeScript 5
- Tailwind CSS v4 · Framer Motion · Three.js / React Three Fiber
- Server Components + streaming API routes

**Backend**
- Next.js API routes (Node.js runtime)
- Neon Postgres (serverless) with `pgvector` and tsvector full-text search
- Cloudflare R2 for edition image hosting (via AWS SDK v3)
- Vitest (TypeScript) and pytest (Python) for testing

**AI / ML**
- **Google Gemini** (`@google/genai`) — OCR structuring, embeddings (`gemini-embedding-001`, 768-dim), reranking, RAG answer generation
- **Google Document AI** — layout parser for character-level OCR with confidence scoring
- **DocLayout-YOLO** — photo/illustration region detection on scanned pages

**Python OCR Pipeline**
- Python 3.12, `ocr/src/transcript_ocr/` package
- Domain-driven layout: `application/`, `recognition/`, `preprocessing/`, `detection/`, `merging/`, `postprocessing/`, `image_linking/`, `export/`, `diagnostics/`
- Import-boundary and architecture tests enforced in CI (`.github/workflows/ocr-architecture.yml`)

---

## Quickstart

**Prerequisites:** Node.js 20+, Python 3.12, a Neon Postgres database, Google Cloud project with Document AI, Google Gemini API key.

```bash
# 1. Clone and install
git clone https://github.com/<your-username>/transcript-archive.git
cd transcript-archive
npm install

# 2. Configure environment
cp .env.example .env.local
# Edit .env.local and fill in DATABASE_URL, GOOGLE_API_KEY, etc.

# 3. Seed the database
npm run db:seed          # creates tables + loads existing edition.json files
npm run db:embed         # generates 768-dim vector embeddings for all articles

# 4. Run the app
npm run dev              # http://localhost:3000
```

For the **OCR pipeline** (processing new scans), see the Python setup below.

```bash
cd ocr
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cd ..

# Drop TIF folders into ocr/inbox/<date>/ then:
scripts/ocr/process-edition.sh ocr/inbox/1988-10-12
scripts/ocr/process-unprocessed.sh   # batch-process everything unprocessed
```

---

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Start Next.js dev server (hot reload) |
| `npm run build` | Production build (runs `tsc`) |
| `npm run lint` | ESLint |
| `npm run test` | Vitest watch mode |
| `npm run test:run` | Vitest run (CI mode) |
| `npm run test:invariants` | OCR pipeline invariant tests |
| `npm run db:seed` | Seed editions into Neon Postgres |
| `npm run db:reset` | Drop + recreate tables, then seed |
| `npm run db:embed` | Generate vector embeddings for articles |
| `npm run db:embed:force` | Force re-embed all articles |
| `npm run images:upload` | Upload edition images to Cloudflare R2 |
| `npm run weather:build:ohio` | Build offline weather archive (1950–2000) |
| `npm run weather:verify:ohio` | Verify archive integrity |
| `scripts/ocr/process-edition.sh <folder>` | Process a single edition end-to-end |
| `scripts/ocr/process-unprocessed.sh` | Batch OCR all new inbox folders |
| `python -m pytest tests/ocr/ -x` | Python OCR test suite |

---

## Environment Variables

Create `.env.local` from `.env.example`:

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Neon Postgres connection string |
| `GOOGLE_API_KEY` | Yes | Gemini — OCR structuring, embeddings, RAG generation |
| `GOOGLE_CLOUD_PROJECT` | Yes (OCR) | Document AI project ID |
| `DOCUMENT_AI_PROCESSOR_ID` | Yes (OCR) | Document AI layout parser processor |
| `DOCUMENT_AI_LOCATION` | Yes (OCR) | Typically `us` |
| `LAYOUT_PARSER_PROCESSOR_ID` | Optional | Secondary layout processor |
| `R2_ACCOUNT_ID` | Optional | Cloudflare R2 account (production image CDN) |
| `R2_ACCESS_KEY_ID` | Optional | R2 access key |
| `R2_SECRET_ACCESS_KEY` | Optional | R2 secret key |
| `R2_BUCKET_NAME` | Optional | R2 bucket name |
| `IMAGE_BASE_URL` | Optional | R2 public CDN base URL (falls back to local API proxy in dev) |

**Never commit `.env.local`** — it is already in `.gitignore`.

---

## Project Structure

```
.
├── src/                          # Next.js frontend
│   ├── app/                      # App Router pages + API routes
│   │   ├── api/                  # /api/ask, /api/editions, /api/search, /api/weather
│   │   ├── ask/                  # Ask the Archive page (RAG UI)
│   │   └── edition/[date]/       # Edition reader
│   ├── features/                 # Feature modules (news-feed, ask-archive, etc.)
│   ├── lib/                      # Shared: db, embeddings, answer-generator, reranker, query-reformulator, gemini-client
│   └── server/                   # Server-only: ocr-adapter (edition.json → DB rows)
│
├── ocr/                          # Python OCR pipeline
│   ├── src/transcript_ocr/       # Domain-driven package
│   │   ├── application/          # edition_pipeline, page_pipeline, ad_enrichment, content_rescue
│   │   ├── recognition/          # DocAI provider, Gemini page extractor, prompts
│   │   ├── preprocessing/        # skew correction, image conversion
│   │   ├── detection/            # DocLayout-YOLO region detection
│   │   ├── merging/              # cross-page article merge, continuation, deduplication
│   │   ├── postprocessing/       # deduplication, ad reclassification, null sanitization
│   │   ├── image_linking/        # visual matcher — region-to-article attribution
│   │   └── contracts/            # typed data models
│   ├── convert_scans.py          # Main OCR entry point
│   ├── enrich_ads.py             # Post-OCR ad enrichment
│   └── rescue_content.py         # Failure-triage CLI for rescue pipeline
│
├── scripts/
│   ├── db/                       # seed, embed, migrate, recreate-hnsw-index
│   ├── ocr/                      # Shell wrappers around the Python pipeline
│   ├── iiif/                     # IIIF archive download tool (OCLC ContentDM)
│   └── weather/                  # Weather archive builders
│
├── public/
│   ├── editions/<date>/          # OCR output: edition.json + images (gitignored)
│   └── data/weather/ohio/        # Offline weather archive
│
└── tests/
    ├── api/, lib/, news-feed/    # Vitest suites
    └── ocr/                      # pytest suite + architecture tests
```

---

## RAG Pipeline (how `/api/ask` works)

```
POST /api/ask
  ↓
query-reformulator    → rewrite modern query in 1960s newspaper language
                        detect intent (text-only vs visual)
                        produce separate embeddingQuery + ftsQuery
  ↓
embeddings            → multimodal embed (text + optional image) via gemini-embedding-001
                        guard against token-limit truncation
  ↓
db.hybridSearch       → vector similarity (HNSW) + FTS with Reciprocal Rank Fusion (0.7 vector weight)
                        returns top-8 candidate articles
  ↓
reranker              → Gemini scores each candidate 0–10 for relevance
                        filters to score ≥ 3, max 5 articles
  ↓
answer-generator      → Gemini produces cited answer from original question + reranked articles
                        visual-mode returns imageUrls for TimelineGallery rendering
```

Every step has a timeout, a typed error envelope, and a graceful fallback (e.g., reformulation failure → use original query; rerank failure → vector-only retrieval with a fresh timeout). Rate-limited at 10 req/min. User input wrapped in XML delimiters for prompt-injection defense.

---

## OCR Pipeline (how `convert_scans.py` works)

```
ocr/inbox/<date>/*.tif
  ↓
Phase 1: DocAI Extraction (parallel per page)
  → preprocess (grayscale, CLAHE, denoise, border crop)
  → Document AI layout parser (char-level OCR + confidence)
  → DocLayout-YOLO region detection (photos/illustrations)
  ↓
Phase 2: Gemini Structuring + Image Linking (parallel per page)
  → Gemini structures DocAI text into articles/ads with headlines, bylines, categories
  → Visual matcher links YOLO regions to article/ad bounding boxes
  ↓
Phase 3: Cross-Page Merging
  → merge articles by continuation markers ("Continued on page X")
  → deduplicate overlapping content
  → consolidate orphan images
  ↓
Phase 4: Ad Enrichment
  → Gemini extracts metadata (advertiser, category, call-to-action) from ad crops
  ↓
Phase 5: Diagnostics + Issue Reports
  → per-page timing, confidence, token usage, YOLO stats
  → issue_report.json flags detected problems
  ↓
public/editions/<date>/edition.json + images/
```

Then: `npm run db:seed` ingests the `edition.json` into Neon Postgres, and `npm run db:embed` generates 768-dim vectors for every article.

---

## Testing

| Suite | Command | Covers |
|---|---|---|
| TypeScript | `npm run test:run` | UI components, hooks, API routes, lib utilities, OCR adapter |
| Python | `python -m pytest tests/ocr/ -x` | OCR pipeline logic, architecture boundaries, artifact contracts |
| CI | `.github/workflows/ocr-architecture.yml` | Import rules, wrapper entrypoints, runtime cutover |

Architecture tests fail the build if any module violates the `application → (recognition/preprocessing/detection) → shared` dependency direction.

---

## Conventions

- **Conventional commits** — `feat(rag):`, `fix(ocr):`, `chore:`, `docs:`, etc.
- **Feature modules** — business logic lives in `src/features/<feature>/`; no cross-feature imports
- **API routes** — always validate inputs, return typed JSON, use correct HTTP status codes
- **OCR adapter** — `src/server/ocr-adapter/` is the *only* place that transforms `edition.json` → DB shape
- **Dates** — always `YYYY-MM-DD` strings; never `Date` objects across API boundaries

---

## License

MIT — see [LICENSE](./LICENSE).
