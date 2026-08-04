# Data Model

> Deep-dive on the database schema, the `edition.json` contract, embeddings,
> migrations, image storage, and how data flows from OCR output through Neon
> and Cloudflare R2 to the serving APIs.

**See also**: [ocr-pipeline.md](ocr-pipeline.md) for how `edition.json` is produced. [rag-pipeline.md](rag-pipeline.md) for the queries that read from these tables.

## Scale

As of this writing:

| Metric | Value |
|---|---|
| Editions | 351 |
| Articles | 11,705 |
| Ads | 6,846 |
| Embedding dimension | 768 |
| Active vector records | Query with `npm run db:embed -- --dry-run` after migration |

Every tuning decision in this doc is anchored in that scale. "RRF K=40 because the corpus is small" means "small relative to ~12k articles."

## Table of contents

- [End-to-end data flow](#end-to-end-data-flow)
- [Tables](#tables)
- [The `edition.json` contract](#the-editionjson-contract)
- [The ocr-adapter boundary](#the-ocr-adapter-boundary)
- [Embeddings](#embeddings)
- [Hybrid search](#hybrid-search)
- [Migrations](#migrations)
- [Seed flow](#seed-flow)
- [Image storage](#image-storage)
- [Neon specifics](#neon-specifics)
- [Tests](#tests)
- [Operator runbook](#operator-runbook)
- [Start here](#start-here)

---

## End-to-end data flow

### A. Ingest: OCR output to DB rows

```
ocr/inbox/<date>/
  └── (IIIF scans)
        │
        ▼
scripts/ocr/process-edition.sh          (shell wrapper)
        │
        ▼
ocr Python pipeline                      (see docs/architecture/ocr-pipeline.md)
        │
        ▼
public/editions/<date>/edition.json      ← canonical OCR output (OcrEdition shape)
public/editions/<date>/images/*          ← raw scans (legacy) or <sha256>.webp (post-upload)
        │
        ▼
npm run db:seed  →  scripts/db/seed.mjs
        │  imports TS via tsx
        ▼
src/server/ocr-adapter/index.ts
  ├── transformArticles(edition) → Article[]     (category + image + text rules)
  ├── transformAds(edition)      → VintageAd[]
  └── computePageCount(edition)  → number
        │
        ▼
Neon PostgreSQL (via @neondatabase/serverless HTTP)
  ├── editions   (UPSERT on conflict)
  ├── articles   (in-place UPSERT; removed IDs deleted)
  ├── article_chunks (deterministic text evidence)
  ├── article_images (one record per visual)
  └── ads        (DELETE + INSERT)
        │
        ▼
seed.mjs → buildSearchVectors()
  UPDATE articles SET search_vector = …   (FTS trigger also fires on any INSERT)
```

### B. Embeddings pass

```
npm run db:embed  →  scripts/db/embed.mjs
        │
        ▼
SELECT pending article_chunks and article_images   (or all, with --force)
        │
        ▼
src/lib/article-chunking.ts + src/lib/embeddings.ts
  sentence-aware text chunks + separately loaded images
        │
        ▼
Vertex AI via ADC (gemini-embedding-2, 768 dimensions)
        │
        ▼
UPDATE article_chunks/article_images with vector, model, version, and hash
```

### C. Image CDN path

```
public/editions/<date>/images/*
        │
npm run images:upload
        ▼
scripts/db/upload-images.mjs
  sharp: source → WebP (quality ladder; see ocr-pipeline.md)
  rename to <sha256-of-webp-bytes>.webp; rewrite edition.json references
  S3Client PUT → R2 bucket key: ocr-assets/<sha256>.webp
  write asset-manifest.json (schema_version 2)
        │
        ▼
CDN: IMAGE_BASE_URL/ocr-assets/<sha256>.webp    (hash-shaped filenames)
     IMAGE_BASE_URL/<date>/images/<file>.webp   (all other filenames)
                  OR
/api/editions/<date>/images/<file>              (dev proxy, both shapes)
```

### D. Query paths

```
POST /api/ask
  → reformulateQuery(question)
  → embedQuery(semantic query)    (embeddings.ts, 10s timeout, 5-min LRU)
  → hybridSearch()          (db.ts: vector + FTS → RRF, 5-min LRU)
    ├── queryArticlesByEmbedding()   (chunk or image HNSW cosine)
    └── searchArticlesForRag()       (chunk/article FTS)
  → rerankArticles()
  → generateAnswer() or runAgentLoop()

GET /api/search
  → searchArticles()        (FTS only, ts_headline snippets, pagination)

GET /api/editions
  → queryEditions()         (list editions with pagination)

GET /api/editions/[date]
  → queryEditionByDate()    (edition + articles + ads, gold fallback)
```

---

## Tables

### `editions`

Source: `scripts/db/migrations/0002_legacy_core.sql:6-11`.

| Column | Type | Notes |
|---|---|---|
| `date` | `TEXT PRIMARY KEY` | `YYYY-MM-DD` string |
| `publication_info` | `TEXT NOT NULL DEFAULT ''` | masthead text |
| `page_count` | `INTEGER NOT NULL DEFAULT 1` |  |
| `article_count` | `INTEGER NOT NULL DEFAULT 0` |  |

No secondary indexes. `date` is the FK target for `articles` and `ads`. Written by `seed.mjs` with `ON CONFLICT DO UPDATE`.

### `articles`

Source: `scripts/db/migrations/0002_legacy_core.sql:13-45` (table + ALTER TABLE addendums + indexes).

Columns grouped by access pattern:

**Hot — read on every query**

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | `'{date}-{index}'` |
| `edition_date` | `TEXT NOT NULL REFERENCES editions(date)` | filter + join target |
| `headline` | `TEXT NOT NULL DEFAULT ''` | result display + FTS weight A |
| `body_plain` | `TEXT NOT NULL DEFAULT ''` | canonical plain text and legacy fallback evidence |
| `search_vector` | `TSVECTOR` | auto-populated by trigger; GIN indexed |
| `embedding` | `VECTOR(768)` | legacy rollback/cutover vector; active v2 vectors live in child tables |

**Warm — read on result hydration**

| Column | Type | Notes |
|---|---|---|
| `position` | `INTEGER NOT NULL` | preserves adapter ordering |
| `category` | `TEXT NOT NULL DEFAULT 'News'` | filter facet |
| `summary` | `TEXT NOT NULL DEFAULT ''` | result display + FTS weight B |
| `byline` | `TEXT` | result display; FTS weight C |
| `image_urls` | `JSONB NOT NULL DEFAULT '[]'` | result display |
| `image_caption` | `TEXT` | result display |
| `full_text` | `TEXT NOT NULL DEFAULT ''` | HTML body for article reader |

**Cold — written once by adapter, rarely read**

| Column | Type | Notes |
|---|---|---|
| `writer_position` | `TEXT` | ALTER TABLE addition |
| `page` | `INTEGER NOT NULL DEFAULT 1` |  |
| `is_hero` | `BOOLEAN NOT NULL DEFAULT FALSE` | hero card on edition page |
| `is_featured` | `BOOLEAN NOT NULL DEFAULT FALSE` |  |
| `image_captions` | `JSONB NOT NULL DEFAULT '[]'` | parallel to `image_urls` |
| `embedding_model` | `TEXT` | records model name; used for migrations |
| `embedding_input_hash`, `embedding_input_version` | `TEXT` | legacy vector identity metadata |

Indexes:

| Index | Columns | Type |
|---|---|---|
| `idx_articles_edition` | `(edition_date)` | B-tree |
| `idx_articles_category` | `(category)` | B-tree |
| `idx_articles_byline` | `(byline) WHERE byline IS NOT NULL` | partial B-tree |
| `idx_articles_search` | `(search_vector)` | GIN |
| `idx_articles_embedding` | `(embedding vector_cosine_ops)` | HNSW (`m=16, ef_construction=128`) |

The `search_vector` is maintained by a `BEFORE INSERT OR UPDATE` trigger (`articles_search_vector_trig`) that calls `articles_search_vector_update()`. Weights: `headline(A)`, `summary(B)`, `byline(C)`, `body_plain(C)`.

### `article_chunks`

Source: `scripts/db/migrations/0005_rag_evidence_tables.sql` plus `0009_revision_keys_and_corpus.sql` (`content_revision_id`).

Each row is one deterministic sentence-aware article segment. `id` is `{article_id}:{chunk_index padded to four digits}`. `article_id` cascades on delete.

| Column | Type | Notes |
|---|---|---|
| `index_build_id` | `TEXT REFERENCES rag_index_builds(id)` | **nullable** — `NULL` marks legacy seed rows, which versioned retrieval never serves (runtime SQL filters by an explicit build id); build-scoped rows are written only by the index build tool |
| `content_revision_id` | `TEXT REFERENCES content_revisions(id)` | nullable; keys versioned rows to an immutable content revision; legacy rows keep `NULL` |
| `chunk_text` | `TEXT NOT NULL` | evidence sent to reranking/generation when matched |
| `search_vector` | `TSVECTOR` | trigger-maintained and GIN indexed |
| `embedding` | `VECTOR(768)` | HNSW cosine index |
| `embedding_model` | `TEXT` | must equal the query embedding model |
| `embedding_input_version` | `TEXT` | currently `article-chunk-v1` |
| `embedding_input_hash` | `TEXT NOT NULL` | SHA-256 identity of canonical model/version/input |

Uniqueness is two partial unique indexes, not one table constraint: `uq_article_chunks_legacy` on `(article_id, chunk_index) WHERE index_build_id IS NULL` and `uq_article_chunks_build` on `(index_build_id, article_id, chunk_index) WHERE index_build_id IS NOT NULL`.

### `article_images`

Source: `scripts/db/migrations/0005_rag_evidence_tables.sql` plus `0009_revision_keys_and_corpus.sql` (`content_revision_id`).

Each row represents one image, not one article. `id` is `{article_id}:image:{image_index padded to three digits}`.

| Column | Type | Notes |
|---|---|---|
| `index_build_id` | `TEXT REFERENCES rag_index_builds(id)` | **nullable** — `NULL` marks legacy seed rows, never served by versioned retrieval |
| `content_revision_id` | `TEXT REFERENCES content_revisions(id)` | nullable; legacy rows keep `NULL` |
| `image_url` | `TEXT NOT NULL` | source image/CDN identity |
| `caption` | `TEXT` | semantic text paired with the image |
| `embedding` | `VECTOR(768)` | one multimodal vector; HNSW indexed |
| `embedding_model` | `TEXT` | current stable embedding model |
| `embedding_input_version` | `TEXT` | currently `article-image-v1` |
| `embedding_input_hash` | `TEXT` | includes model, version, text, MIME type, and image bytes |

Same uniqueness pattern as chunks: `uq_article_images_legacy` on `(article_id, image_index) WHERE index_build_id IS NULL` and `uq_article_images_build` on `(index_build_id, article_id, image_index) WHERE index_build_id IS NOT NULL`.

### `ads`

Source: `scripts/db/migrations/0002_legacy_core.sql:47-70`.

| Column | Type | Notes |
|---|---|---|
| `id` | `SERIAL PRIMARY KEY` |  |
| `edition_date` | `TEXT NOT NULL REFERENCES editions(date)` |  |
| `position` | `INTEGER NOT NULL` |  |
| `title` | `TEXT NOT NULL DEFAULT ''` | maps from `business_name` |
| `body` | `TEXT NOT NULL DEFAULT ''` |  |
| `category` | `TEXT` | validated against `VALID_AD_CATEGORIES` |
| `ad_type` | `TEXT` | `'display'` or `'classified'` |
| `display_text` | `TEXT` | nullable |
| `phone`, `address`, `price` | `TEXT` | nullable |
| `image_urls` | `JSONB NOT NULL DEFAULT '[]'` |  |

Index: `idx_ads_edition` on `(edition_date)`. The SERIAL PK means ads can't be upserted — seed does a `DELETE WHERE edition_date = $date` before insert.

### `ai_spend_counter`

Source: `scripts/db/migrations/0003_runtime_tables.sql:39-43`.

```sql
CREATE TABLE IF NOT EXISTS ai_spend_counter (
  day         DATE PRIMARY KEY,
  spent_usd   NUMERIC(12, 6) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Written by `cost-tracker.ts :: recordUsage()` as an atomic increment via `INSERT … ON CONFLICT (day) DO UPDATE SET spent_usd = spent_usd + $cost`. Read by `checkDailyBudget()` at the top of every `/api/ask` call. Hard limit: `$0.50/day`.

### `api_rate_bucket`

Source: `scripts/db/migrations/0003_runtime_tables.sql:45-53`.

```sql
CREATE TABLE IF NOT EXISTS api_rate_bucket (
  key         TEXT PRIMARY KEY,            -- "{bucket}:{ip}"
  count       INTEGER NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_rate_bucket_expires ON api_rate_bucket (expires_at);
```

Written by `rate-limit.ts :: checkNeon()` via atomic upsert that resets `count` to 1 if the window is expired, otherwise increments. Falls back to an in-memory Map per limiter-factory instance when Neon is unreachable.

### `ask_session_turns`

Source: `scripts/db/migrations/0003_runtime_tables.sql:21-37`.

```sql
CREATE TABLE IF NOT EXISTS ask_session_turns (
  id                 BIGSERIAL PRIMARY KEY,
  session_id         TEXT NOT NULL,
  question           TEXT NOT NULL,
  answer             TEXT NOT NULL,           -- capped at 8000 chars + marker
  cited_article_ids  TEXT[] NOT NULL DEFAULT '{}',
  citation_snapshots JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ask_session_turns_session_created
  ON ask_session_turns (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ask_session_turns_created
  ON ask_session_turns (created_at DESC);
```

Queries select the last 5 turns within a 30-minute window. Citation snapshots
pin the cited content revision and bounded source-card/evidence metadata so a
later re-OCR cannot rewrite an earlier answer's hydrated sources. The runtime
probes this expand-only column with a 30-second TTL and retains the legacy-ID
fallback for pre-migration rows. Rows age out of the query window (not
automatically purged). User-triggered "Clear conversation" issues a hard
`DELETE`.

### `ask_feedback`

Source: `scripts/db/migrations/0003_runtime_tables.sql:5-19`.

```sql
CREATE TABLE IF NOT EXISTS ask_feedback (
  id           BIGSERIAL PRIMARY KEY,
  request_id   TEXT NOT NULL,                          -- from AskResponse
  question     TEXT NOT NULL,
  answer       TEXT NOT NULL,
  confidence   TEXT,
  mode         TEXT,
  citations    JSONB NOT NULL DEFAULT '[]',
  vote         TEXT NOT NULL CHECK (vote IN ('up', 'down')),
  comment      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Indexes: `idx_ask_feedback_request` on `(request_id)`, `idx_ask_feedback_created` on `(created_at DESC)`. Wired to `/api/ask/feedback`.

### `weather`

Source: `scripts/db/migrations/0002_legacy_core.sql:72-83`. Composite PK `(date, scope)`. Seeded once from `public/data/weather/ohio/index/delaware-by-date-1950-2000.json`. Not consumed by RAG — only by `/api/weather`.

### `music`

Source: `scripts/db/migrations/0002_legacy_core.sql:85-93`. Composite PK `(year, month, rank)`. Seeded from `public/top-10-music/chart-1950-2010.json`. Not consumed by RAG.

### Phase 3 identity and publication tables

Created by migrations `0004` and `0006`–`0009`. Column-by-column detail lives in those migration files, deliberately not duplicated here. Nothing in the runtime writes these yet; the writers are `backfill-identities.mjs`, `register-corpus-version.mjs`, and the Phase 4 publisher below (all data-only, `--yes`-gated, local/test databases only in this phase).

| Table | Purpose |
|---|---|
| `schema_migrations` | Migration ledger: `id`, `checksum`, `applied_at`, `duration_ms`, `runner_version`. Created by the runner itself, not by a numbered migration |
| `rag_index_builds` | Immutable index-build identity + status state machine (`building`→`validated`→`active`/`failed`/`retired`); partial unique index enforces one active build per corpus version |
| `source_records` | Immutable external source identity: `(source_system, pointer)` unique, classified by `kind` |
| `issues` | Stable internal issue identity per canonical date; points at the active edition revision |
| `legacy_edition_aliases` | Maps legacy `editions.date` to an issue id |
| `edition_revisions` | Immutable per-run edition snapshots, unique on `(issue_id, revision_hash)` |
| `edition_revision_pages` | Page-level provenance and `processed`/`failed`/`missing` status per revision |
| `content_items` | Stable content identity per issue: `(issue_id, identity_key)` unique, with identity evidence and an active-revision pointer |
| `content_revisions` | Immutable content snapshots; a `BEFORE UPDATE` trigger (`content_revisions_immutable_trig`) rejects any `UPDATE` |
| `legacy_content_aliases` | Maps legacy article ids to content items/revisions (articles only in Phase 3) |
| `content_identity_conflicts` | Review queue for ambiguous re-OCR identity matches |
| `assets` | Content-addressed asset registry keyed by `sha256`; rows are immutable |
| `asset_references` | Per-revision image references `(content_revision_id, position)` → asset, with role and printed caption |
| `publication_runs` | Publication state machine (`discovered` → … → `active`/`failed`/`rolled_back`) |
| `publication_run_events` | Append-only transition log per run |
| `corpus_versions` | Corpus version registry; the frozen legacy snapshot row is registered by `register-corpus-version.mjs`, never by migrations |

### Versioned publisher (Phase 4)

`src/server/publisher/` drives publication over the Phase 3 tables. It never
writes the legacy tables (`editions`/`articles`/`ads`); those still come from
`db:seed`.

**State machine** (`state-machine.ts`). Each `publication_runs` row advances
one step at a time along `discovered` → `acquired` → `ocr_candidate` →
`assets_staged` → `db_revision_staged` → `validated` → `active`; any
non-terminal state may move to `failed`, and `active` may move to
`rolled_back`. Every transition is one CTE statement in which the
`publication_run_events` INSERT selects from the guarded run UPDATE's
RETURNING set, so the event ledger and run row can never disagree.
`activateRevision` extends the same chain to flip
`issues.active_edition_revision_id` atomically with the `validated` → `active`
move — all three writes or none; `rollbackActiveRevision` repoints the issue
at a prior revision the same way. `resumeRun` is a pure read that tells a
driver what to re-verify and do next from the run's current state; a crashed
run resumes instead of restarting.

**Revision writer** (`revision-writer.ts`). Maps one `edition.json` through
the existing ocr-adapter (never reimplementing its rules) onto immutable rows:
`edition_revisions` + `edition_revision_pages`, plus `content_items` /
`content_revisions` for articles, ads, and substantive `other_content`
(entries with a non-empty body — the legacy seed path still drops all
`other_content`). Everything is planned in memory, then written in one
transaction. Re-staging identical input is idempotent: an existing
`(issue_id, revision_hash)` returns the existing revision and writes nothing.
An ambiguous identity match writes `content_identity_conflicts` review rows
and throws before any content write. Asset rows and per-revision
`asset_references` come from the v2 asset manifest (see
[Image storage](#image-storage)).

`edition_revisions` carries the page lineage the legacy tables drop —
`expected_pages`, `processed_pages`, `failed_pages`, and per-page status rows
— while legacy `editions.page_count` is untouched.

**Ad aliases.** Ads now get `legacy_content_aliases` rows keyed
`'ad:{date}:{position}'` (position = index in the adapter's `transformAds`
output). The key is regenerated per staging and is not stable across differing
inputs — an ad added mid-list shifts later positions. It exists so ads,
deferred from Phase 3, still land in the alias table with a queryable handle.

**Validation** (`validate-revision.ts`). Read-only pre-activation checks:
page-row count vs `expected_pages`, at least one content item, no unpointed
`active_revision_id`, no alias without a revision pin, no `asset_references`
row pointing at an unregistered asset. Embedding readiness is reported
truthfully as `not_applicable_no_index_build` until a Phase 5 index build
exists — never passed.

**CLI.** `npm run db:publish-edition` (`scripts/db/publish-edition.mjs`) runs
`--stage <date>` / `--validate <revId>` / `--activate <revId> --run <id>` /
`--rollback-to <revId> --run <id>` / `--resume <id>`. Requires `DATABASE_URL`
and `--yes`; like the other identity writers, it authorizes local/test
databases only until the Phase 8 rollout approval. `acquire.ts` covers the
`discovered` → `acquired` step for runs that fetch source pages: downloads
stream to a `.part` file and only an atomic rename creates the destination,
and size/MIME/sha256 validation applies even when the destination already
exists — a passing file short-circuits, a failing one is re-downloaded.

---

## The `edition.json` contract

Python source: `ocr/src/transcript_ocr/contracts/content_models.py`.
TypeScript mirror: `src/types/index.ts:147-155` (`OcrEdition`).

### Top-level shape

| Field | Type | Required? | Notes |
|---|---|---|---|
| `edition_date` | `string` | yes | `YYYY-MM-DD` |
| `publication_info` | `string` | yes | masthead text |
| `articles` | `MergedArticle[]` | yes | may be empty |
| `ads` | `Ad[]` | no | raw, no enrichment |
| `enriched_ads` | `EnrichedAd[]` | no | added by Phase 4; adapter prefers this over `ads` |
| `categories` | `string[]` | no | parallel to `articles[]`; optional classification override; adapter checks it before falling back to `article.category` then heuristics |
| `other_content` | `{title, body}[]` | no | triage rejects — not written to the legacy tables; the Phase 4 revision writer stages substantive entries (non-empty body) as versioned content |

### `MergedArticle` per item

| Field | Type | Required? | Notes |
|---|---|---|---|
| `headline` | `string` | yes (default `""`) | primary title only |
| `author` | `string` | no (default `""`) | may include section tag |
| `writer_position` | `string` | no (default `""`) | role line if present |
| `category` | `Literal[...]` | yes (default `"News"`) | one of five fixed values |
| `body` | `string` | yes (default `""`) | raw paragraph text |
| `images` | `ArticleImage[]` | no | each has `caption`, `position` |
| `image_files` | `string[]` | no | filenames; adapter filters to valid extensions |
| `source_pages` | `string[]` | no | used to compute `page` and `page_count` |
| `continues_on`, `continued_from` | `string` | no | normalized; `"?"` means uncertain |

Invariant: `images.length === image_files.length` with matching order. A mismatch fails candidate validation before publication.

### `EnrichedAd`

Extends `Ad` (`business_name`, `body`, `image_files`) with `category`, `ad_type`, `display_text`, `phone`, `address`, `price`. All string fields default to `""`.

---

## The ocr-adapter boundary

`src/server/ocr-adapter/` is the **single place** that writes `edition.json` content to DB rows. Two callers:

1. `scripts/db/seed.mjs` — build/ops time
2. `src/app/api/editions/[date]/route.ts` — runtime gold-edition fallback

The API route reads from DB in the normal case; it only invokes the adapter when `queryEditionByDate` returns null AND the date is `1960-01-13` (the gold edition, which may not be seeded in a fresh environment).

### Why a single boundary?

**Normalization in one place**. Category classification (`classifyCategory`), image-rule filtering (`isAuthorHeadshot`, `isBodyMostlyCaption`, `doesLastParagraphMatchAnyCaption`, `isAdImageDescription`, `isValidImageFile`), text cleaning (`cleanBodyPreamble`, `dehyphenate`, `bodyToHtml`, `extractSummary`), hero/featured assignment — all co-located, all unit-testable without a DB.

**Idempotency on re-seed**. On every `db:seed`, the adapter sees the current `edition.json`, re-runs every rule, and produces a deterministic output. The DB is a view of that computation. If the rules change, reseeding updates the DB; if the rules don't change, reseeding is a no-op (plus embedding preservation, see below).

**Dedup and filtering**. Articles dropped by the adapter (too short, empty, AI-described image artifacts, headline-equals-caption with no body) are also absent after re-seed. The seed path upserts current IDs in place, then deletes only IDs no longer produced by the adapter; child chunk/image records cascade.

**Gold restores**. Per the project's CLAUDE.md: "restores must go through the ocr-adapter path, not raw SQL — dedup lives in the adapter." Direct SQL inserts would bypass the filtering and dedup logic, risking stale content in the DB.

**Ordering invariant**. The adapter's `position` field is deterministic given the same `edition.json` input. The UI and all URL generation depend on this: "the third article on the edition's landing page" is identified by `(edition_date, position=2)`. A refactor that introduces non-deterministic ordering would silently break deep links and cached references. Preserve `position` assignment logic when touching `article-transform.ts`.

### Adapter-layer test coverage

`tests/ocr-adapter/image-rules.test.ts` covers three functions:

- `isAdImageDescription` — 11 cases across all pattern branches
- `isBodyMostlyCaption` — 8 cases (exact, long, >80% ratio, mismatch, empty, whitespace normalization, trailing punctuation)
- `doesLastParagraphMatchAnyCaption` — 3 cases (match, single-paragraph body, no match)

Other adapter modules (`category-rules`, `text-cleaning`, `article-transform`, `ad-transform`) are exercised transitively through integration tests and gold-edition comparison workflows.

---

## Embeddings

### Model and dimensions

Model: stable `gemini-embedding-2` on Vertex AI with ADC. Dimension: `EMBEDDING_DIMS = 768`. Schema: `VECTOR(768)`.

This model uses inline text prefixes rather than `taskType` enums:

- Documents: `"title: {headline} | text: {body}"` via `buildEmbeddingText`
- Queries: `"task: search result | query: {question}"` via `embedQuery`

### Text chunk input

`buildArticleChunkRecords` normalizes whitespace, targets 3,200-character sentence-aware chunks, and overlaps up to 600 characters of complete trailing sentences. Each chunk passes through `buildEmbeddingText`, which assembles:

```
From The Transcript Archive: {date}, {category} section.
Byline: {byline}
Summary: {summary}
{chunk_text}
```

Capped at 30,000 chars to stay under the API's 8,192-token limit.

### Image input

Every `article_images` record is embedded independently. The input combines article context and caption with the exact local image bytes. Missing local files remain pending and are reported; they do not abort text backfill.

### Vector identity

Every active vector stores:

- `embedding_model`;
- `embedding_input_version` (`article-chunk-v1` or `article-image-v1`);
- `embedding_input_hash`, a SHA-256 digest of model, version, exact text, and image data when present.

Seed/migration upserts preserve a vector only when its canonical identity is unchanged. Any changed input clears only that vector. Query SQL filters by model and input version, so old and new embedding spaces are never compared.

### HNSW index

```sql
CREATE INDEX idx_article_chunks_embedding
  ON article_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 128);
CREATE INDEX idx_article_images_embedding
  ON article_images USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 128);
```

At query time, `queryArticlesByEmbedding` runs:

```sql
BEGIN;
  SET LOCAL hnsw.ef_search = 100;   -- default is 40
  SET LOCAL hnsw.iterative_scan = 'relaxed_order';
  SELECT ... ORDER BY embedding <=> $queryVec LIMIT $k;
COMMIT;
```

Iterative scanning improves recall when category/date/image filters would otherwise discard ANN candidates.

### Embedding runs

`db:embed` is always incremental — there is no force flag. Re-embedding everything is
driven by the input version, not by a command-line switch: bump
`RAG_TEXT_EMBEDDING_INPUT_VERSION` or `RAG_IMAGE_EMBEDDING_INPUT_VERSION` in
`src/lib/rag-model-config.ts`, which makes every existing row stale, then run `db:embed`.

| Command | Effect |
|---|---|
| `npm run db:embed -- --dry-run` | Counts pending chunks/images and estimates online cost; no model call |
| `npm run db:embed` | Missing/stale model or version rows only |
| `npm run db:embed -- --legacy-unversioned` | Targets the pre-build legacy article vectors instead of the versioned index |

- Script text batch size: 50 chunks.
- Images are embedded one at a time.
- One script-level transient retry is allowed; `QuotaExhaustedError` stops the run.
- Rerunning resumes pending rows.

---

## Hybrid search

`db.ts :: hybridSearch` combines vector and FTS via Reciprocal Rank Fusion (RRF):

```
score(article) = vectorWeight / (RRF_K + vectorRank)
              + ftsWeight    / (RRF_K + ftsRank)
```

Defaults (all tunable per-call):

| Parameter | Default | Notes |
|---|---|---|
| `vectorWeight` | 0.7 |  |
| `ftsWeight` | 0.3 | = `1 - vectorWeight` |
| `limit` | 8 | final results |
| `fetchK` | `min(3 * limit, 100)` | candidates fetched from each source before fusion |
| `RRF_K` | 40 | standard is 60; lowered for better differentiation on small corpus |

Route.ts overrides by mode:

- `visual` mode → 0.7 vector / 0.3 FTS
- `text` mode → 0.6 vector / 0.4 FTS

Articles appearing in both result sets get both scores summed and their `source` field set to `"both"`. Their unique matched passages are combined. The module-level LRU (50 entries, five-minute TTL) keys on lexical query, semantic-vector digest, filters, pipeline version, and corpus version.

---

## Migrations

Canonical system: numbered SQL files in `scripts/db/migrations/` (`NNNN_snake_case.sql`, currently `0001`–`0009`), applied by `scripts/db/lib/migration-runner.ts` through the CLI `scripts/db/migrate.mjs`. All schema comes from here — nothing else runs DDL. `scripts/db/schema.sql` no longer exists; the old file is frozen as `tests/db/fixtures/legacy-draft-schema.sql`, where the upgrade-path tests prove the canonical migrations converge a database that was created from it.

| Command | Effect |
|---|---|
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:migrate:status` | Show applied/pending without applying |
| `npm run db:schema:snapshot` | Apply every migration to in-memory PGlite and regenerate `scripts/db/schema-snapshot.json`; run after adding a migration |

### Ledger

Applied migrations are recorded in `schema_migrations`, created on demand by the runner:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  id             TEXT PRIMARY KEY,   -- file name without .sql
  checksum       TEXT NOT NULL,      -- SHA-256 of the raw file
  applied_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms    INTEGER,
  runner_version TEXT NOT NULL
);
```

`assertMigrationsCurrent()` is the read-only preflight used by every data-only command (`db:seed`, the backfills): it succeeds only when every on-disk migration is applied with a matching checksum, and otherwise refuses with "run: npm run db:migrate". Data commands never run DDL.

### Batch mechanics

Each pending migration is submitted as **one non-interactive transaction** over the Neon HTTP driver (`scripts/db/lib/neon-executor.ts :: transactionBatch`): `SELECT pg_advisory_xact_lock(727401, 552023)` first, then the migration's statements, then the ledger `INSERT`. The advisory lock is transaction-scoped, so it is held exactly for the duration of the batch. If two runners race past the lock queue, the loser's ledger `INSERT` fails with a `23505` unique violation, which rolls back its entire batch — DDL included — and the runner reports that migration as skipped instead of throwing. Files are split into statements by the comment-safe splitter in `scripts/db/lib/sql-statements.ts`, a quote-aware state machine (`''`/`""` escapes, line comments, nested block comments, `$$`/`$tag$` dollar-quoting) so a string literal containing `--` or `/*` is never corrupted.

### Immutability rules

- **Applied migrations are immutable.** A checksum mismatch against the ledger, or a ledger row whose file is missing on disk, fails every runner entry point by name. Add a new migration; never edit or delete an applied one.
- **`CONCURRENTLY` and `VACUUM` are forbidden** — they cannot run inside a transaction, and discovery rejects any migration containing them (checked against comment-stripped statement text).

### Table registry

`CANONICAL_TABLES` in `migration-runner.ts` registers every migration-managed table with a kind: `reseedable` (derived from `edition.json` or rebuildable artifacts; truncated by `db:reset`) or `runtime` (sessions, feedback, spend, rate limits; preserved by `db:reset` unless `--include-runtime`). See [Seed flow](#seed-flow).

### Deprecated one-off scripts

The pre-ledger one-off `migrate-*.mjs` scripts in `scripts/db/` are kept as production-history artifacts. The canonical migrations converge a database to the same shape regardless of whether they ever ran; do not run them for new work.

| Script | Status |
|---|---|
| `migrate-ai-spend-counter.mjs` | Superseded by `0003_runtime_tables.sql` |
| `migrate-api-rate-bucket.mjs` | Superseded by `0003_runtime_tables.sql` |
| `migrate-ask-sessions.mjs` | Superseded by `0003_runtime_tables.sql` |
| `migrate-ask-feedback.mjs` | Superseded by `0003_runtime_tables.sql` |
| `migrate-rag-v2.mjs` | Renamed to `backfill-rag-records.mjs` (`npm run db:backfill:rag-records`); its DDL moved into `0005_rag_evidence_tables.sql`, leaving a deterministic DML-only backfill |
| `migrate-rag-improvements.mjs` | Legacy whole-article migration, superseded by RAG v2 |
| `recreate-hnsw-index.mjs` | Legacy article-vector index rebuild; the v2 child-table indexes come from `0005` |

Online embedding is deliberately separate from schema migration so it can be cost-previewed, stopped, and resumed (`db:embed`).

---

## Seed flow

### Default mode — `npm run db:seed`

`seed.mjs` is data-only — it never runs DDL. Execution order:

1. **`assertMigrationsCurrent()`** — read-only preflight, run in **both** modes; the script refuses an unmigrated database (missing ledger, pending migration, or checksum mismatch) and points at `npm run db:migrate`. Schema comes exclusively from the canonical migrations.
2. **`restoreLockedEditions(null)`** — no-op in non-reset mode.
3. **`ensureLockedEditions()`** — copies `gold/1960-01-13/gold-edition.json` to `public/editions/1960-01-13/edition.json` if not already present.
4. **`seedEditions(targetDate)`** — for each `public/editions/<date>/` directory:
   - Read `edition.json`
   - Call adapter's `transformArticles` and `transformAds`
   - UPSERT into `editions` (ON CONFLICT DO UPDATE)
   - Build canonical article/chunk/image records and hashes
   - UPSERT current article IDs in place; preserve unchanged vectors
   - Delete article IDs no longer produced by the adapter
   - Synchronize chunk and image child records, invalidating only changed vectors
   - DELETE and re-INSERT `ads`
5. **`seedWeather()`** — bulk insert weather records (batched 500), skipped if `--date` flag set.
6. **`seedMusic()`** — bulk insert music records, skipped if `--date` flag set.
7. **`buildSearchVectors(targetDate)`** — bulk `UPDATE articles SET search_vector = …`. Redundant with the trigger but ensures correctness on first seed when the trigger wasn't yet active.
8. **`embedArticles(targetDate)`** — embeds pending current-version text chunks when ADC is configured. Image backfill remains explicit through `db:embed`.
9. **`ANALYZE`** — updates planner statistics, including the v2 child tables.

### Reset mode — `npm run db:reset`

After the step-1 preflight, the script:

- **`exportLockedEditions()`** — reads `editions`, `articles`, `ads` for every date in `locked-editions.json` and saves them in memory. This protects the gold edition even when the source files aren't locally present.
- **`truncateSeedTables()`** — one `TRUNCATE … RESTART IDENTITY CASCADE` over every `reseedable` table in the `CANONICAL_TABLES` registry. Runtime tables (`ask_session_turns`, `ask_feedback`, `ai_spend_counter`, `api_rate_bucket`) are preserved by default; `--include-runtime` truncates them too. The `schema_migrations` ledger is never touched.

Then `restoreLockedEditions(savedData)` re-inserts the saved gold rows before the general seed loop runs. There is no DROP and no schema re-apply — reset is data-only.

With `--unlock`, the export/restore of locked editions is skipped entirely.

### Embedding preservation — canonical identity

The seed does not delete and recreate current articles. For every active vector it compares the stored canonical hash/version with the newly derived record. Exact matches retain their vector; changed inputs clear it for the next incremental backfill. Record IDs removed by the adapter are deleted, so their child vectors cascade instead of becoming stale search results.

---

## Image storage

Local path: `public/editions/<date>/images/<filename>`

Two R2 namespaces:

- **Content-addressed** (current uploads): `ocr-assets/<sha256>.webp`, where
  the hash is the SHA-256 of the final WebP bytes. Shared across editions —
  no date segment; identical bytes upload once.
- **Legacy** (frozen): `<date>/images/<filename>.webp`. Existing objects stay;
  nothing writes here anymore.

### Upload flow

`scripts/db/upload-images.mjs` (`npm run images:upload`):

1. Collect only image references from `edition.json` (unreferenced local files are deleted)
2. Encode to WebP with `sharp` under the size/dimension policy in [ocr-pipeline.md](ocr-pipeline.md) (quality ladder 85/80/75, capped long edge, <500 KiB per asset)
3. Rename the local file to `<sha256>.webp` and rewrite the `edition.json` references to `images/<sha256>.webp`
4. Upload to Cloudflare R2 via the AWS S3 SDK (key: `ocr-assets/<sha256>.webp`); HEAD check before PUT unless `--force`
5. Write `asset-manifest.json` to the edition directory

### Asset manifest v2

`asset-manifest.json` is `{schema_version: 2, date, total_bytes, assets[]}`.
Each entry (built by `buildAssetManifestEntry`, exported for unit tests):
`hash` (SHA-256 of the uploaded WebP bytes — the asset's identity),
`public_path` (`images/<hash>.webp`), `r2_key` (`ocr-assets/<hash>.webp`),
`size_bytes`, `width`, `height`, `quality`, `source_sha256` (SHA-256 of the
original source bytes, pre-`sharp`), `mime_type` (`image/webp`), and upload
`status`. The Phase 4 revision writer turns these entries into `assets` and
`asset_references` rows, so the manifest is the provenance link between a
content revision's images and the R2 objects behind them.

### URL resolution

`src/lib/image-url.ts :: resolveImageUrl(date, filename)` forks on filename
shape:

- Hash-shaped filename (lowercase 64-hex `<sha256>.webp`, optionally prefixed
  `images/`) with `IMAGE_BASE_URL` set: returns `${IMAGE_BASE_URL}/ocr-assets/<sha256>.webp` — no date segment
- Any other filename with `IMAGE_BASE_URL` set: returns `${IMAGE_BASE_URL}/<date>/images/<file>.webp` (legacy namespace)
- Without `IMAGE_BASE_URL` (dev): returns `/api/editions/<date>/images/<file>` for both shapes — the proxy is unchanged

All 2,876 current production image URLs are legacy-shaped, so the
content-addressed branch is forward-looking: it serves editions published
through the current upload flow, not a migration of existing data.

Called in `article-transform.ts` and `ad-transform.ts` at seed time.

### Dev proxy route

`src/app/api/editions/[date]/images/[...path]/route.ts` serves files from `public/editions/<date>/images/` with path-traversal guards and a gold-directory fallback (`gold/<date>/images/`). Cache headers: `public, max-age=31536000, immutable`.

---

## Neon specifics

`@neondatabase/serverless` uses HTTP for each query. Hot-path RAG transactions pass an `AbortSignal` through `fetchOptions`, allowing the Neon HTTP request to be cancelled.

### Cancellation plus deadline race

```typescript
function runWithDbTimeout<T>(op, operation, timeoutMs, outerSignal) {
  const controller = new AbortController();
  const signal = AbortSignal.any([outerSignal, controller.signal]);
  const aborted = rejectWhenAborted(signal, new DbTimeoutError(op, timeoutMs));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return Promise.race([operation(signal), aborted]).finally(() => clearTimeout(timer));
}
```

The signal is supplied to the real transaction fetch, while the race guarantees the caller returns even if a driver regression or test double ignores cancellation. The eight-second default protects the 30-second request budget. `DbTimeoutError` becomes HTTP 504/SSE stage `retrieve`, and no second fallback query starts after timeout or abort.

This pattern covers vector search, chunk FTS, edition listing for agent tools, and full-article reads used by the agent.

### Lazy `_sql` clients

In `cost-tracker.ts`, `conversation-store.ts`, and `rate-limit.ts`, Neon clients are initialized lazily to avoid throwing at module import time when `DATABASE_URL` is absent. This makes tests work without a DB and allows graceful degradation at runtime.

---

## Tests

### Adapter unit tests

`tests/ocr-adapter/image-rules.test.ts` — 22 tests covering the three image-rule predicates. This is the only dedicated adapter unit test file; other modules (`category-rules`, `text-cleaning`, transforms) are exercised transitively through integration and gold-edition comparison workflows.

### Integration-level coverage

`tests/lib/db-vector-search.test.ts` covers `hybridSearch` and the vector/FTS merge logic with a mocked Neon client.

### Migration-system tests

`tests/db/` runs the canonical migrations against in-memory PGlite (`tests/db/helpers/pglite.ts`): `migration-runner.test.ts` (ledger recording, checksum immutability, forbidden statements, ledger-race rollback and 23505 skip mapping, the SQL splitter), `upgrade-path.test.ts` (the fixtures in `tests/db/fixtures/` — the production baseline, the migrate-rag-v2-era shape, and `legacy-draft-schema.sql`, the frozen old `schema.sql` — all introspect identically to a fresh apply and to the committed `scripts/db/schema-snapshot.json`), `seed-data-only.test.ts` (seed contains no DDL; registry matches created tables), and `identity-and-compat.test.ts` (identity backfill idempotency, immutability trigger, legacy projection hydration).

### Gold-edition regression

The gold edition at `gold/1960-01-13/gold-edition.json` is protected by `scripts/db/locked-editions.json` and serves as a frozen known-good baseline. Changes to adapter rules can be validated by diffing the current DB state against a fresh seed of the gold source.

---

## Known limitations

Accepted tradeoffs. These are intentional, not TODOs.

1. **Schema and online backfill are separate operations.** `db:migrate` and `db:backfill:rag-records` never call Google; `db:embed` is the explicit, resumable online step. During the gap, chunk FTS works while current-model vector coverage is incomplete.
2. **Embedding fingerprints are intentionally exact.** A normalization or chunking change invalidates affected hashes. This may require a broad re-embed, but it prevents stale vectors from being silently reused.
3. **Ads use SERIAL PK and can't be upserted.** Every re-seed does a DELETE + INSERT; ad IDs change across seeds. **Accepted because** the legacy tables give ads no cross-reference surface (no URLs, no deep links). The Phase 4 publisher now gives ads a versioned identity (`content_items` plus `'ad:{date}:{position}'` aliases — positional, regenerated per staging, unrelated to the SERIAL ids), but nothing in the runtime serves it yet; if legacy ad IDs ever grow a reference surface, this needs rethinking.
4. **Per-instance rate-limit fallback under-counts across Vercel instances.** During Neon outages, effective per-IP limit is `N × instance_count`. **Accepted because** the primary path (Neon-backed) handles correctness; the fallback only fires during infrastructure failure.
5. **Neon cancellation is HTTP-driver dependent.** Every hot-path transaction receives `fetchOptions.signal`, and the caller also races the abort event. This guarantees request completion; server-side cancellation still depends on Neon honoring the signal.
6. **Gold edition `locked-editions.json` is the only dated-article protection mechanism.** Any other edition can be destroyed by `db:reset --unlock`. **Accepted because** all other editions are reproducible from `edition.json` on disk; only the gold regression baseline matters for verification.
7. **Missing local images cannot be embedded.** The backfill records them as pending and continues. Their articles remain available through chunk vectors, FTS, and stored captions.

---

## Operator runbook

### Reseed from scratch

```bash
npm run db:migrate
# No-op when current; seed refuses an unmigrated database.

npm run db:reset
# Truncates re-seedable tables (runtime tables and the migration ledger
# are preserved), restores gold, seeds all editions, builds search
# vectors, embeds unembedded articles.
# With --unlock: skips gold protection.
# With --include-runtime: also truncates sessions/feedback/spend/rate-limit tables.
```

If `gold/1960-01-13/gold-edition.json` is present locally, it's automatically restored. If not, the DB export mechanism (pre-truncate snapshot) handles it as long as the table had the data before truncation.

### Migrate and backfill RAG v2

`db:migrate` owns all schema; the backfill is DML-only.

```bash
npm run db:migrate
# Canonical, ledger-tracked schema; no model calls.

npm run db:backfill:rag-records
# Deterministic chunk/image metadata backfill; no DDL, no model calls.

npm run db:embed -- --dry-run
npm run db:embed
# Resumable stable text-chunk and per-image backfill.
```

### Force a full re-embed after changing the canonical input format

Bump the relevant input version in `src/lib/rag-model-config.ts` —
`RAG_TEXT_EMBEDDING_INPUT_VERSION` (`article-chunk-v1`) or
`RAG_IMAGE_EMBEDDING_INPUT_VERSION` (`article-image-v1`) — which marks every existing
row stale, then run the ordinary incremental backfill:

```bash
npm run db:embed -- --dry-run   # confirm the pending count and cost first
npm run db:embed
```

Do this only when the model, canonical input format, or source image bytes changed
without a corresponding hash bump. The version bump *is* the force switch; there is no
`--force` flag.

### Investigate a slow query

1. **Confirm v2 indexes exist**. Use `\d article_chunks` and `\d article_images` in `psql` to verify both HNSW indexes.
2. **Check the daily budget**. `SELECT * FROM ai_spend_counter WHERE day = CURRENT_DATE`. A request that looks stuck may be budget-blocked before the query reached the DB.
3. **Check `api_rate_bucket`**. Look for IP-level throttling.
4. **Hybrid search timeout**. `hybridSearch` has an 8-second timeout (`HYBRID_SEARCH_TIMEOUT_MS`); a `DbTimeoutError` in logs means the DB exceeded that budget.
5. **Neon slow-query log**. Examine the Neon console for slow or repeatedly cancelled queries.

### Restore from gold

The gold edition at `gold/1960-01-13/` is protected by `locked-editions.json`. On any `db:reset`:

1. Pre-truncate: seed exports DB rows for that date
2. Post-truncate: seed re-inserts the saved rows

Alternatively, with gold files on disk, any `db:seed` triggers `ensureLockedEditions()` which copies `gold/1960-01-13/gold-edition.json` → `public/editions/1960-01-13/edition.json`, then seeds through the adapter.

**Direct SQL restore is not supported** — it bypasses the adapter's filtering and dedup logic.

### Run the RAG v2 deployment sequence

```bash
npm run db:migrate
npm run db:backfill:rag-records
npm run db:embed -- --dry-run
npm run db:embed
```

Run in this order. The first two commands never call the model; the dry run reports the online work before it is authorized.

---

## Start here

If you're new and need to make a change, read these in order:

1. `scripts/db/migrations/` — the canonical DDL, eleven numbered files applied by `scripts/db/lib/migration-runner.ts`. Everything else is downstream of this.
2. `ocr/src/transcript_ocr/contracts/content_models.py` — the `edition.json` contract, source of truth for everything that flows into the DB.
3. `src/server/ocr-adapter/article-transform.ts` — where `edition.json` becomes DB rows. Every normalization rule lives here.
4. `src/lib/db.ts` — every runtime read query. `raceWithTimeout` and `DbTimeoutError` patterns apply to every caller.
5. `scripts/db/seed.mjs` — the end-to-end seed flow. The embedding fingerprint logic is the most non-obvious piece.
