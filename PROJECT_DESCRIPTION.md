# The Transcript Archive — Technical Description

> A deep-dive companion to [`README.md`](./README.md). Describes the architecture, pipelines, design decisions, hardening choices, and skills demonstrated by this project.

---

## Table of Contents

1. [Problem & Solution](#1-problem--solution)
2. [System Architecture](#2-system-architecture)
3. [The OCR Pipeline](#3-the-ocr-pipeline)
4. [The RAG Pipeline](#4-the-rag-pipeline)
5. [Multimodal Image Embedding](#5-multimodal-image-embedding)
6. [Database Schema](#6-database-schema)
7. [Reliability & Hardening](#7-reliability--hardening)
8. [Testing Strategy](#8-testing-strategy)
9. [Skills Demonstrated](#9-skills-demonstrated)
10. [Running the Pipelines Locally](#10-running-the-pipelines-locally)

---

## 1. Problem & Solution

Ohio Wesleyan University's student newspaper, *The Transcript*, has been published weekly since 1867. Decades of print editions from the late 20th century exist only as bulk scanned TIF files in the OCLC ContentDM archive — unsearchable, unstructured, and effectively invisible to anyone who didn't know the exact date they were looking for.

**The goal:** turn 40 years of print history into a searchable, queryable, AI-augmented research tool that anyone can use to ask natural-language questions about campus life from 1960 to 2000.

**The approach, end-to-end:**

1. **Ingest** raw TIF scans from the ContentDM IIIF archive (custom downloader at `scripts/iiif/`).
2. **OCR** each page through a Python pipeline that combines Google Document AI (character-level text), DocLayout-YOLO (photo/illustration region detection), and Google Gemini (structural extraction of articles, headlines, bylines, ads).
3. **Merge** articles that span multiple pages, deduplicate content, and enrich ads with structured metadata.
4. **Store** the structured output in Neon Postgres with both tsvector full-text search *and* 768-dim pgvector embeddings.
5. **Serve** a Next.js 16 application with a period-accurate reading UI and an "Ask the Archive" page powered by a full RAG pipeline.
6. **Search multimodally** — text queries match text content, visual queries (e.g., "protest photos") match article thumbnails and text in a single embedding space.

**Scale today:** 142 editions processed, 80+ fully ingested into the production database, 2000+ articles with vector embeddings, 1800+ ads enriched, offline weather archive spanning 1950–2000 (18,628 daily entries), monthly top-10 music archive 1958–2000.

---

## 2. System Architecture

```
  ┌─────────────────┐         ┌────────────────────┐         ┌──────────────────────┐
  │  OCLC IIIF      │ TIF →   │   Python OCR       │ JSON →  │   Neon Postgres      │
  │  ContentDM      │────────▶│   Pipeline (5 phases)│────────▶│   pgvector + FTS     │
  │  Archive        │         │                    │         │                      │
  └─────────────────┘         └────────┬───────────┘         └──────────┬───────────┘
                                       │                                 │
                                       │                                 │
                                       │                  ┌──────────────▼──────────┐
                                       │                  │   Next.js 16 App        │
                                       │                  │   React 19 + Tailwind v4│
                                       │                  │                         │
                                       │                  │   /api/editions         │
                                       │                  │   /api/search           │
                                       │                  │   /api/ask  (RAG)       │
                                       │                  │   /api/weather          │
                                       │                  └──────────────┬──────────┘
                                       │                                 │
                                       │                                 │
                              ┌────────▼───────────┐         ┌──────────▼───────────┐
                              │ Cloudflare R2 CDN  │◀────────│   Browser            │
                              │ (edition images)   │         │   (period-accurate   │
                              └────────────────────┘         │    reading UI + RAG) │
                                                             └──────────────────────┘
```

**Six cooperating blocks:**

1. **Frontend** — Next.js App Router with server components, streaming API routes, and feature modules in `src/features/` (`news-feed`, `ask-archive`, `search`, `archive`, `time-controls`, `navigation`, `music-player`, `weather`, `context-panel`, `footer`, `theme`). No cross-feature imports.
2. **API layer** — Server routes in `src/app/api/`. `POST /api/ask` runs the full RAG pipeline. `GET /api/editions/[date]` serves full edition data with articles, ads, and metadata.
3. **Database** — Neon serverless Postgres. Tables: `editions`, `articles`, `ads`, `weather`, `music`. Articles have both `search_vector tsvector` (auto-maintained) and `embedding vector(768)` with HNSW index.
4. **OCR pipeline** — Python 3.12 domain-driven package. 5 phases. Parallelized per-page.
5. **Ops scripts** — Shell + Node scripts for seed, embed, cleanup, image upload, weather archive build, migration.
6. **Image CDN** — Cloudflare R2 hosts `.webp` edition images in production via `IMAGE_BASE_URL`; falls back to a local API proxy in dev.

---

## 3. The OCR Pipeline

The pipeline is a Python 3.12 package at `ocr/src/transcript_ocr/` organized by domain responsibility rather than technical layer. A CI-enforced architecture test (`.github/workflows/ocr-architecture.yml`) fails the build if any module violates the allowed dependency direction:

```
application → (recognition, preprocessing, detection, image_linking, merging, postprocessing) → shared
```

No `recognition` module can import from `application`; no `shared` module can import from anywhere except itself. This keeps the pipeline composable and prevents the kind of cyclic bloat that usually kills long-lived Python projects.

### 3.1 Phases

**Phase 1 — DocAI Extraction (parallel per page)**

Each raw TIF is preprocessed (grayscale conversion, CLAHE contrast enhancement, morphological denoising, border crop) and sent to **Google Document AI Layout Parser**. DocAI returns structured text with character-level confidence scores and bounding polygons. In parallel, **DocLayout-YOLO** runs region detection on the same preprocessed image to find photo and illustration regions. Regions are filtered by class (photo/illustration only), minimum area, and aspect ratio.

Module map: `preprocessing/skew.py`, `preprocessing/image_converter.py`, `recognition/docai_provider.py`, `detection/`.

**Phase 2 — Gemini Structuring + Image Linking (parallel per page)**

The raw DocAI text plus YOLO regions are sent to **Google Gemini** with a carefully tuned prompt (`recognition/prompts.py`, loaded via `config/prompts_loader.py`) that asks it to structure the page into articles, ads, and content items — each with headline, byline, category, summary, full body text, continuation markers, and bounding box association.

A **visual matcher** (`image_linking/visual_matcher.py`) then links each detected YOLO region to the most likely article or ad on the page using bounding-box overlap and Gemini-assisted disambiguation for tricky cases.

**Phase 3 — Cross-Page Merging**

Articles flagged with continuation markers (e.g., "Continued on page 7") are merged into single entries across pages. Deterministic rules in `merging/deterministic_merge.py` handle the clean cases; `merging/llm_merge.py` uses Gemini as a tiebreaker for ambiguous merges. Orphan images are consolidated or dropped based on merge decisions. Boundary cleanup (`merging/boundary_cleanup.py`) strips leftover "Continued from page X" markers from merged body text.

**Phase 4 — Ad Enrichment**

`application/ad_enrichment.py` sends each detected ad crop to Gemini with a specialized extraction prompt (`recognition/ad_prompts.py`) to pull structured metadata: advertiser name, phone, address, price, ad type, category, call-to-action.

**Phase 5 — Diagnostics + Issue Reports**

Per-page timing, DocAI mean confidence, Gemini token usage, YOLO statistics, and error context are written to `diagnostics.json`. A separate `issue_report.json` flags detected problems (missing continuations, ambiguous merges, low-confidence pages). The final `edition.json` is written to `public/editions/<date>/`.

### 3.2 The Rescue Pipeline

During an audit of the first 40+ processed editions, a critical failure mode appeared: on rare pages Gemini would silently return zero candidates for successfully-extracted DocAI text, causing complete content loss for that page — no error, no retry, no fallback triggered.

The **rescue pipeline** (`application/content_rescue.py` + `cli/rescue_content.py` + `recognition/rescue_prompts.py`) addresses this. It triages completed editions, detects pages with suspicious zero-content outcomes, and re-runs them through an alternate Gemini prompt path with safety-off settings. This is explicitly a failure-recovery system, not a first-pass pipeline.

### 3.3 Image Conversion

`preprocessing/image_converter.py` runs as an early edition-level preprocessing step, converting TIF scans into normalized page images the rest of the pipeline consumes. Tested independently in `tests/ocr/test_image_converter.py`.

---

## 4. The RAG Pipeline

`POST /api/ask` is the single endpoint that runs the full retrieval-augmented generation flow. Five `src/lib/` modules execute in sequence, each with a timeout and graceful fallback:

```
query-reformulator.ts   →  embeddings.ts   →  db.ts (hybridSearch)   →  reranker.ts   →  answer-generator.ts
```

### 4.1 Query Reformulation

Modern user queries don't match 1960s newspaper language. Asking "what did students think about the Vietnam War?" against text that actually uses phrases like "the war in Indochina" or "the conflict in Southeast Asia" hurts both vector and FTS retrieval.

`query-reformulator.ts` uses Gemini to:
1. **Rewrite** the modern question into period-appropriate vocabulary.
2. **Detect intent** — is this a text query or a visual query? ("show me photos of homecoming" is visual; "what did the editorial board say about Nixon?" is text.)
3. **Produce two distinct outputs**: an `embeddingQuery` tuned for vector search and an `ftsQuery` tuned for keyword match (which uses a different tokenization strategy).

If reformulation fails or times out, the pipeline falls back to the original user query verbatim — degradation, not failure.

### 4.2 Embedding

`embeddings.ts` calls Google's `gemini-embedding-001` model to produce a 768-dim vector. The embedding input is guarded against token-limit truncation — a pre-flight token count check trims the text before sending rather than letting the API silently truncate. For visual queries, the embedding is **multimodal**: the query text is combined with any reference image into a single embedding call (see [Section 5](#5-multimodal-image-embedding)).

### 4.3 Hybrid Search

`db.ts` runs two queries in parallel against Neon Postgres:
- **Vector similarity** via the HNSW index on `articles.embedding` (cosine distance)
- **Full-text search** via the GIN index on `articles.search_vector` (ts_rank_cd with the reformulated FTS query)

The results are combined using **Reciprocal Rank Fusion** with a 0.7 weight on the vector side (text-mode) or adjusted for visual mode. The fusion returns the top 8 candidate articles with their individual rank positions, allowing the frontend and generator to explain *why* a result was included.

### 4.4 Reranking

The 8 candidates are sent to Gemini with the original (not reformulated) question and each article's headline + summary + body snippet. Gemini scores each 0–10 for relevance to the user's actual intent. The reranker:
- Accepts decimal scores (`9.5` is valid, not just integers).
- Strips markdown preambles with a whitespace-tolerant regex.
- Filters to score ≥ 3.
- Caps the output at 5 articles.
- On total rerank failure, falls back to the vector-only top-N with a **fresh** timeout (not the tail of the original one — a subtle bug that was fixed during hardening).

### 4.5 Answer Generation

`answer-generator.ts` sends the **original** user question (not the reformulated one — the user's phrasing reflects what they actually want) plus the reranked articles to Gemini. The prompt asks for a cited answer with inline source references and returns a structured response including:

- `answer` — the synthesized text
- `mode` — `"text"` or `"visual"`
- `imageUrls[]` — populated for visual mode, consumed by the `TimelineGallery` UI
- `sources[]` — the articles used, with FTS rank, vector rank, and rerank score for transparency

Visual queries get a reduced preamble and more aggressive markdown stripping so the answer blends cleanly with the gallery.

---

## 5. Multimodal Image Embedding

The `image-embedding` branch namesake. The goal: allow "show me photos of the homecoming parade" to actually surface article thumbnails, not just text hits that happen to mention homecoming.

### 5.1 Embed-Time

`scripts/db/embed.mjs` now loads each article's primary image (from `image_urls[]`) at embed time and sends it to `gemini-embedding-001` *alongside* the article text as a single multimodal embedding call. The resulting 768-dim vector lives in `articles.embedding` — same table, same column, same HNSW index. There is no separate "image embedding" column; text and image live in a shared embedding space so a single vector search can match both text queries and visual queries.

### 5.2 Query-Time

When the reformulator flags a query as visual:
- The hybrid search increases the candidate limit (more results to consider for visual relevance).
- The reranker is instructed that photo quality and captions matter.
- The generator returns `mode: "visual"` and a curated `imageUrls[]` from the reranked articles.

### 5.3 Rendering

`src/features/ask-archive/components/TimelineGallery.tsx` renders the visual-mode answer as a timeline of article thumbnails with captions — unique to visual-mode responses. Text-mode answers continue to render in the default `AnswerPanel` with source cards.

### 5.4 Data Hygiene

`scripts/cleanup-ai-captions.py` was added to strip AI-generated captions that leaked into some early edition outputs, ensuring the image captions used for retrieval are the original human-authored ones where available.

---

## 6. Database Schema

Defined in `scripts/db/schema.sql`. Designed for Neon serverless Postgres.

```sql
-- Editions (one row per issue)
editions (date PK, publication_info, page_count, article_count)

-- Articles (the core searchable entity)
articles (
  id PK,                   -- '{date}-{index}'
  edition_date FK,
  position, category, headline, summary, full_text, body_plain, byline, page,
  is_hero, is_featured,
  image_urls JSONB,
  image_caption, image_captions JSONB,
  search_vector TSVECTOR,  -- auto-maintained via trigger
  embedding VECTOR(768),   -- multimodal (text + image)
  embedding_model TEXT,    -- provenance: which model produced this vector
  writer_position TEXT
)

-- Indexes:
--   B-tree on edition_date, category, byline (WHERE NOT NULL)
--   GIN on search_vector
--   HNSW on embedding (vector_cosine_ops, m=16, ef_construction=128)

-- Ads (enriched per phase 4 of OCR)
ads (id, edition_date FK, position, title, body, category, ad_type,
     display_text, phone, address, price, image_urls JSONB)

-- Historical context tables
weather (date PK, scope PK, tmax_c, tmin_c, precip_mm, source, ...)
music (year PK, month PK, rank PK, title, artist, youtube_id)
```

### 6.1 FTS Trigger

A plpgsql trigger auto-maintains `articles.search_vector` on every INSERT or UPDATE. Weighting:

```
headline   → weight A (top relevance)
summary    → weight B
byline     → weight C
body_plain → weight C
```

This means `ts_rank_cd` naturally prioritizes headline matches, then summary, then byline/body — matching how a researcher actually thinks about newspaper relevance. The trigger was added as a bug fix (`74d0a50`) when an earlier version left `search_vector` stale on article updates, causing silently wrong FTS results.

### 6.2 HNSW Tuning

`m = 16, ef_construction = 128` — good accuracy/build-time balance for a corpus of ~2000 articles. Pg_vector supports both IVF and HNSW; HNSW was chosen because the corpus is small enough that HNSW's query-time advantage matters more than its build-time cost.

`scripts/db/recreate-hnsw-index.mjs` exists for rebuilding the index after bulk re-embeds (e.g., when migrating to a new embedding model).

---

## 7. Reliability & Hardening

The branch contains 20+ hardening commits that address specific failure modes discovered during the first weeks of production use. Each one is worth surfacing because they each represent a real lesson, not speculative defensive programming.

| Commit | Area | What was wrong |
|---|---|---|
| `18056ce` | Rate limiting | `/api/ask` had no rate limiter; a single user could exhaust the Gemini quota in minutes. Now 10 req/min per IP. |
| `bd0cb13` | Prompt injection | User input was interpolated raw into the generator prompt; a malicious query could override system instructions. Now wrapped in XML delimiters and escaped. |
| `a2c8c2c` | Token limits | Long articles could push embedding input past the token cap and be silently truncated mid-sentence. Now a pre-flight count trims at a sentence boundary before sending. |
| `74d0a50` | FTS correctness | Article updates left `search_vector` stale. Added a plpgsql trigger that auto-maintains on INSERT/UPDATE. |
| `fd0470b` | Retry backoff | Backoff was indexed by *batch position* rather than retry count, so the 5th batch's 1st retry waited as long as the 1st batch's 5th retry. Fixed to retry-count-based. |
| `744e79e` | Fallback timeouts | Vector-only fallback reused the tail of the rerank timeout and usually timed out immediately. Now creates a fresh timeout. |
| `0d89e57` | Confidence threshold | The "low confidence" signal was computed from total article count, not vector-search article count, skewing it for heavily-FTS-weighted results. |
| `964d6af` | Reranker parsing | Reranker rejected decimal scores (`9.5`) as "not an integer." Fixed to parse floats. |
| `f5af4e3` | Preamble stripping | Rerank preamble strip regex required specific whitespace, so some Gemini responses weren't parsed. Relaxed. |
| `80b1017` | FTS NULL vs 0 | When no FTS match existed, distance was emitted as `0` (implying perfect match) instead of `null`. |
| `a3c8c88` | Ad deduplication | Restoring locked editions (like the gold standard) double-inserted ads. Added dedup on restore. |
| `d3fff9d` → `0d792b7` | Multimodal (8 commits) | Full rollout of visual-mode queries end-to-end. |

The common theme: **every bug was found by observing real behavior, not by imagining what could go wrong.** The commits speak for themselves in `git log main..HEAD`.

---

## 8. Testing Strategy

### 8.1 TypeScript (Vitest)

- **Lib tests**: `embeddings.test.ts`, `query-reformulator.test.ts`, `reranker.test.ts`, `answer-generator.test.ts`, `db-vector-search.test.ts`
- **API tests**: `ask-route.test.ts` covers the full `/api/ask` integration path with mocked Gemini
- **Component tests**: `ask-archive/source-list.test.tsx`, `news-feed` variants
- **Runner**: `npm run test:run` (CI) or `npm run test` (watch)

### 8.2 Python (pytest)

- **Unit**: `test_continuation.py`, `test_merging.py`, `test_null_sanitizer.py`, `test_proper_noun.py`, `test_image_converter.py`, `test_merge_helpers.py`
- **Static failure-path tests**: `test_failure_paths_static.py`
- **Architecture/import-boundary tests** (run in CI): `tests/ocr/architecture/`
- **Contract tests**: `test_artifact_schema_contracts.py` auto-activates after a real pipeline run and validates the shape of emitted JSON artifacts.

### 8.3 CI

`.github/workflows/ocr-architecture.yml` runs on every PR. Fails the build if:
- Any module imports in a forbidden direction.
- Wrapper entrypoints (`ocr/convert_scans.py`, `ocr/enrich_ads.py`, `ocr/rescue_content.py`) diverge from their package counterparts.
- Runtime cutover tests detect an import-time regression.

---

## 9. Skills Demonstrated

**Frontend engineering**
- React 19, TypeScript 5, Next.js 16 App Router with server components and streaming
- Tailwind CSS v4 with token-based design system (`src/styles/tokens/`)
- Framer Motion for the period-accurate reading UI
- Three.js / React Three Fiber for the landing page cathedral background

**Backend engineering**
- Next.js API routes with typed envelopes, input validation, correct HTTP status codes
- Neon serverless Postgres with `pgvector`, HNSW indexing, and tsvector FTS
- Cloudflare R2 integration via AWS SDK v3 for image hosting
- Trigger-based auto-maintenance of derived columns

**AI / Machine learning engineering**
- Retrieval-augmented generation end-to-end: query reformulation, hybrid search, reranking, cited generation
- Multimodal embeddings (text + image → single 768-dim vector)
- Hybrid search with Reciprocal Rank Fusion
- Prompt engineering for extraction, structuring, classification, reranking, and generation — each prompt tuned for its specific task
- Hardening against real production failure modes: rate limiting, prompt injection, token truncation, graceful fallbacks, retry logic

**Computer vision / OCR**
- Google Document AI Layout Parser integration with per-page parallelization
- DocLayout-YOLO region detection with class/area/aspect-ratio filtering
- Visual bounding-box matching for region-to-article attribution
- Image preprocessing (CLAHE, denoising, skew correction, border crop)

**System design**
- Domain-driven package layout (Python OCR pipeline) with enforced import boundaries
- Feature modules (Next.js frontend) with no cross-feature imports
- Explicit separation of concerns: `src/server/ocr-adapter/` is the *only* place that transforms `edition.json` into DB shape
- Dataflow-oriented architecture: TIF → OCR → JSON → DB → vector → answer

**Database engineering**
- Schema design for hybrid FTS + vector search
- HNSW tuning (`m = 16, ef_construction = 128`) for small-corpus query performance
- plpgsql trigger for `search_vector` auto-maintenance
- Migration strategy: idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`

**DevOps / ops**
- GitHub Actions CI for architecture tests
- Shell orchestration scripts for batch OCR processing
- IIIF archive downloader for reproducible data sourcing
- Offline weather and music archives (built from public NOAA / Billboard data with integrity verification)

**Testing**
- Vitest for TypeScript (unit + integration)
- pytest for Python (unit + architecture + contract)
- Mock-driven integration tests for the RAG pipeline (no Gemini calls in CI)

**Quality disciplines**
- Conventional commits with consistent scopes (`feat(rag):`, `fix(ocr):`)
- Failure mode audit → targeted fix → regression test (the hardening commits are a direct chain of evidence)
- README / PROJECT_DESCRIPTION split for recruiter vs. engineer audiences

---

## 10. Running the Pipelines Locally

### Frontend + API

```bash
npm install
cp .env.example .env.local   # fill DATABASE_URL, GOOGLE_API_KEY, etc.
npm run db:seed              # creates tables + loads existing edition.json files
npm run db:embed             # generates vector embeddings for all articles
npm run dev                  # http://localhost:3000
```

### OCR Pipeline (new scans)

```bash
# One-time Python setup
cd ocr
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cd ..

# Drop a TIF folder into ocr/inbox/1988-10-12/
# then process it end-to-end:
scripts/ocr/process-edition.sh ocr/inbox/1988-10-12

# Or batch-process every unprocessed folder:
scripts/ocr/process-unprocessed.sh

# After OCR completes:
npm run db:seed             # ingest new edition.json files
npm run db:embed            # embed the new articles
npm run images:upload       # push new images to R2
```

### IIIF Archive Download (optional)

```bash
cd scripts/iiif
python -m pip install -r requirements.txt
python extract-manifests.py   # fetch IIIF manifests from ContentDM
python select-batch.py        # pick which ones to download
python download.py            # grab TIFs into ocr/inbox/
```

### Running Tests

```bash
npm run test:run                     # Vitest (TypeScript)
python -m pytest tests/ocr/ -x       # pytest (Python)
npm run test:invariants              # OCR pipeline invariant tests
```

---

*This document is the resume-facing deep dive. For quickstart, commands, and tech stack at a glance, see [`README.md`](./README.md).*
