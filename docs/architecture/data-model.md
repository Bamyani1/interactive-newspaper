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
| Embedded articles | 11,705 (100%) |
| Embedding dimension | 768 |
| Vector data size | ~7 MB |
| FTS index size | ~14 MB |
| HNSW index size | ~18 MB |

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
- [File map](#file-map)

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
public/editions/<date>/images/*.jpg      ← raw JPEG scans
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
  ├── articles   (DELETE + INSERT + embedding restore)
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
SELECT articles WHERE embedding IS NULL   (or all, with --force)
        │
        ▼
src/lib/embeddings.ts :: buildEmbeddingText()
  prepend "From The Transcript Archive..., {date}, {category} section"
  then byline, summary, [Photo: {caption}]?, body_plain
        │
        ▼
Google Gemini API (gemini-embedding-2-preview, 768-dim)
        │
        ▼
UPDATE articles SET embedding = '[…]'::vector, embedding_model = '…'
        │
        ▼  (after all articles embedded)
scripts/db/recreate-hnsw-index.mjs
  DROP INDEX idx_articles_embedding;
  CREATE INDEX idx_articles_embedding ON articles USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 128);
```

### C. Image CDN path

```
public/editions/<date>/images/*.jpg
        │
npm run images:upload
        ▼
scripts/db/upload-images.mjs
  sharp: JPEG → WebP (quality 85)
  S3Client PUT → R2 bucket key: <date>/images/<file>.webp
        │
        ▼
CDN: IMAGE_BASE_URL/<date>/images/<file>.webp   (production)
                  OR
/api/editions/<date>/images/<file>              (dev proxy)
```

### D. Query paths

```
POST /api/ask
  → embedQuery(question)    (embeddings.ts, 10s timeout, 5-min LRU)
  → hybridSearch()          (db.ts: vector + FTS → RRF, 5-min LRU)
    ├── queryArticlesByEmbedding()   (HNSW cosine, hnsw.ef_search=100)
    └── searchArticlesForRag()       (websearch_to_tsquery + ts_rank)
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

Source: `scripts/db/schema.sql:11-16`.

| Column | Type | Notes |
|---|---|---|
| `date` | `TEXT PRIMARY KEY` | `YYYY-MM-DD` string |
| `publication_info` | `TEXT NOT NULL DEFAULT ''` | masthead text |
| `page_count` | `INTEGER NOT NULL DEFAULT 1` |  |
| `article_count` | `INTEGER NOT NULL DEFAULT 0` |  |

No secondary indexes. `date` is the FK target for `articles` and `ads`. Written by `seed.mjs` with `ON CONFLICT DO UPDATE`.

### `articles`

Source: `scripts/db/schema.sql:20-45` (table + indexes) plus ALTER TABLE addendums at lines 68-69.

Columns grouped by access pattern:

**Hot — read on every query**

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | `'{date}-{index}'` |
| `edition_date` | `TEXT NOT NULL REFERENCES editions(date)` | filter + join target |
| `headline` | `TEXT NOT NULL DEFAULT ''` | result display + FTS weight A |
| `body_plain` | `TEXT NOT NULL DEFAULT ''` | FTS source + embedding source + reranker input |
| `search_vector` | `TSVECTOR` | auto-populated by trigger; GIN indexed |
| `embedding` | `VECTOR(768)` | `gemini-embedding-2-preview`; HNSW indexed |

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

Indexes:

| Index | Columns | Type |
|---|---|---|
| `idx_articles_edition` | `(edition_date)` | B-tree |
| `idx_articles_category` | `(category)` | B-tree |
| `idx_articles_byline` | `(byline) WHERE byline IS NOT NULL` | partial B-tree |
| `idx_articles_search` | `(search_vector)` | GIN |
| `idx_articles_embedding` | `(embedding vector_cosine_ops)` | HNSW (`m=16, ef_construction=128`) |

The `search_vector` is maintained by a `BEFORE INSERT OR UPDATE` trigger (`articles_search_vector_trig`) that calls `articles_search_vector_update()`. Weights: `headline(A)`, `summary(B)`, `byline(C)`, `body_plain(C)`.

### `ads`

Source: `scripts/db/schema.sql:49-77`.

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

Source: `scripts/db/migrate-ai-spend-counter.mjs:35-41`.

```sql
CREATE TABLE IF NOT EXISTS ai_spend_counter (
  day         DATE PRIMARY KEY,
  spent_usd   NUMERIC(12, 6) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Written by `cost-tracker.ts :: recordUsage()` as an atomic increment via `INSERT … ON CONFLICT (day) DO UPDATE SET spent_usd = spent_usd + $cost`. Read by `checkDailyBudget()` at the top of every `/api/ask` call. Hard limit: `$0.50/day`.

### `api_rate_bucket`

Source: `scripts/db/migrate-api-rate-bucket.mjs:37-43`.

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

Source: `scripts/db/migrate-ask-sessions.mjs:35-49`.

```sql
CREATE TABLE IF NOT EXISTS ask_session_turns (
  id                 BIGSERIAL PRIMARY KEY,
  session_id         TEXT NOT NULL,
  question           TEXT NOT NULL,
  answer             TEXT NOT NULL,           -- capped at 8000 chars + marker
  cited_article_ids  TEXT[] NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ask_session_turns_session_created
  ON ask_session_turns (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ask_session_turns_created
  ON ask_session_turns (created_at DESC);
```

Queries select the last 5 turns within a 30-minute window. Rows age out of the query window (not automatically purged). User-triggered "Clear conversation" issues a hard `DELETE`.

### `ask_feedback`

Source: `scripts/db/schema.sql:107-122` and `scripts/db/migrate-ask-feedback.mjs:38-51`.

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

Source: `scripts/db/schema.sql:82-93`. Composite PK `(date, scope)`. Seeded once from `public/data/weather/ohio/index/delaware-by-date-1950-2000.json`. Not consumed by RAG — only by `/api/weather`.

### `music`

Source: `scripts/db/schema.sql:97-104`. Composite PK `(year, month, rank)`. Seeded from `public/top-10-music/chart-1950-2010.json`. Not consumed by RAG.

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
| `other_content` | `{title, body}[]` | no | triage rejects — not written to DB |
| `content_triaged` | `boolean` | no | added by Phase 5 |

### `MergedArticle` per item

| Field | Type | Required? | Notes |
|---|---|---|---|
| `headline` | `string` | yes (default `""`) | primary title only |
| `author` | `string` | no (default `""`) | may include section tag |
| `writer_position` | `string` | no (default `""`) | role line if present |
| `category` | `Literal[...]` | yes (default `"Campus News"`) | one of five fixed values |
| `body` | `string` | yes (default `""`) | raw paragraph text |
| `images` | `ArticleImage[]` | no | each has `caption`, `position` |
| `image_files` | `string[]` | no | filenames; adapter filters to valid extensions |
| `source_pages` | `string[]` | no | used to compute `page` and `page_count` |
| `continues_on`, `continued_from` | `string` | no | normalized; `"?"` means uncertain |

Invariant: `images.length === image_files.length` with matching order. Mismatches are flagged in `issue_report.json`.

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

**Dedup and filtering**. Articles dropped by the adapter (too short, empty, AI-described image artifacts, headline-equals-caption with no body) are also absent from the DB after re-seed, since the delete-then-insert cycle removes anything not in the adapter's output.

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

Model: `gemini-embedding-2-preview`. Dimension: `EMBEDDING_DIMS = 768`. Schema: `VECTOR(768)`.

This model uses inline text prefixes rather than `taskType` enums:

- Documents: `"title: {headline} | text: {body}"` via `buildEmbeddingText`
- Queries: `"task: search result | query: {question}"` via `embedQuery`

### Document input assembly

`buildEmbeddingText` assembles:

```
From The Transcript Archive: {date}, {category} section.
Byline: {byline}
Summary: {summary}
[Photo: {image_caption}]              ← if present
{body_plain}
```

Capped at 30,000 chars to stay under the API's 8,192-token limit.

For articles with images, `embed.mjs` optionally loads the first image as base64 and sends a multimodal embedding request. Multimodal inputs are sent individually (not batched) due to the Gemini API's 6-image-per-request ceiling.

The `embedding_model` column records which model produced each vector, enabling future model migrations without losing which articles need re-embedding.

### HNSW index

Creation script: `scripts/db/recreate-hnsw-index.mjs`.

```sql
DROP INDEX IF EXISTS idx_articles_embedding;
CREATE INDEX idx_articles_embedding
  ON articles USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 128);
```

The original schema had `ef_construction = 64`; raised to 128 for better index quality. `schema.sql` line 45 reflects 128.

At query time, `queryArticlesByEmbedding` runs:

```sql
BEGIN;
  SET LOCAL hnsw.ef_search = 100;   -- default is 40
  SELECT ... ORDER BY embedding <=> $queryVec LIMIT $k;
COMMIT;
```

The tradeoff is slightly slower scan for better recall on a small corpus.

### When to rebuild

- After any model change (different dimension or prefix format invalidates all stored vectors)
- After `db:embed --force` completes
- When `migrate-rag-improvements.mjs` drops the old index

The script verifies at least one embedding exists before building.

### Sequential scan fallback

If `idx_articles_embedding` does not exist — e.g., dropped by `migrate-rag-improvements.mjs` and not yet rebuilt — pgvector falls back to a full sequential scan. With ~10k articles this is noticeably slower but not catastrophic. CLAUDE.md's "migrate-rag-improvements.mjs follow-up" reminder means: after running that migration, immediately run:

```bash
npm run db:embed:force
node --import tsx scripts/db/recreate-hnsw-index.mjs
```

### Incremental vs force

| Command | Effect |
|---|---|
| `npm run db:embed` | `WHERE embedding IS NULL` — only unembedded articles |
| `npm run db:embed:force` | All articles; used after changing model or text format |

- Batch size: 50 articles per API call
- Quota handling: `QuotaExhaustedError` breaks the loop immediately rather than retrying. Daily quota failures will recur on every batch and waste wall time.
- Per-minute RPM quota: 3 exponential retries (1s, 2s, 4s) via `retryOnQuota` in `embeddings.ts`.

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

Articles appearing in both result sets get both scores summed and their `source` field set to `"both"`. Result is a sorted, deduplicated list up to `limit`. Module-level LRU cache (50 entries, 5-min TTL, keyed on question + filters) short-circuits repeated identical queries.

---

## Migrations

Convention: standalone `.mjs` scripts in `scripts/db/`, each idempotent via `IF NOT EXISTS` or `CREATE OR REPLACE`. No migration framework — one-off scripts run manually.

| Script | What it does | Follow-up required? |
|---|---|---|
| `schema.sql` | Core DDL — all tables, indexes, FTS trigger. Applied by `seed.mjs :: applySchema()` on every seed run | no |
| `migrate-ai-spend-counter.mjs` | Creates `ai_spend_counter` table | no |
| `migrate-api-rate-bucket.mjs` | Creates `api_rate_bucket` + expiry index | no |
| `migrate-ask-sessions.mjs` | Creates `ask_session_turns` + 2 indexes | no |
| `migrate-ask-feedback.mjs` | Creates `ask_feedback` + 2 indexes (also in `schema.sql`) | no |
| `migrate-rag-improvements.mjs` | Updates FTS trigger to include `summary(B)`, drops old HNSW index | **yes** — run `db:embed:force` then `recreate-hnsw-index.mjs` |
| `recreate-hnsw-index.mjs` | Drops and rebuilds HNSW with `ef_construction=128` | no (is itself the follow-up) |

The `migrate-rag-improvements.mjs` follow-up is the one called out in CLAUDE.md. The migration intentionally drops the old HNSW index, leaving vector search on sequential scan until the index is rebuilt with the new parameters.

---

## Seed flow

### Default mode — `npm run db:seed`

`seed.mjs` execution order:

1. **`applySchema()`** — reads `schema.sql`, splits statements respecting dollar-quoted PL/pgSQL blocks, executes each. All DDL uses `IF NOT EXISTS` so it's safe on an existing DB.
2. **`restoreLockedEditions(null)`** — no-op in non-reset mode.
3. **`ensureLockedEditions()`** — copies `gold/1960-01-13/gold-edition.json` to `public/editions/1960-01-13/edition.json` if not already present.
4. **`seedEditions(targetDate)`** — for each `public/editions/<date>/` directory:
   - Read `edition.json`
   - Call adapter's `transformArticles` and `transformAds`
   - UPSERT into `editions` (ON CONFLICT DO UPDATE)
   - **Snapshot existing embeddings by content fingerprint**
   - DELETE all `articles` for the date
   - Re-INSERT via transaction
   - **Restore matching embeddings**
   - DELETE and re-INSERT `ads`
5. **`seedWeather()`** — bulk insert weather records (batched 500), skipped if `--date` flag set.
6. **`seedMusic()`** — bulk insert music records, skipped if `--date` flag set.
7. **`buildSearchVectors(targetDate)`** — bulk `UPDATE articles SET search_vector = …`. Redundant with the trigger but ensures correctness on first seed when the trigger wasn't yet active.
8. **`embedArticles(targetDate)`** — embeds only articles with `embedding IS NULL`. Hard-stops on quota exhaustion.
9. **`ANALYZE`** — updates planner statistics for `editions`, `articles`, `ads`, `weather`, `music`.

### Reset mode — `npm run db:reset`

Before step 1, the script:

- **`exportLockedEditions()`** — reads `editions`, `articles`, `ads` for every date in `locked-editions.json` and saves them in memory. This protects the gold edition even when the source files aren't locally present.
- **`dropAllTables()`** — `DROP TABLE IF EXISTS` for `ask_feedback`, `music`, `weather`, `ads`, `articles`, `editions` in that order (reverse FK order).

Then continues from step 1. After `applySchema`, `restoreLockedEditions(savedData)` re-inserts the saved gold rows before the general seed loop runs.

With `--unlock`, the export/restore of locked editions is skipped entirely.

### Embedding preservation — the fingerprint mechanism

Critical design detail. The delete-then-insert cycle would destroy all embeddings on every seed if not for the fingerprint mechanism.

**How it works**:

1. Before DELETE, `seed.mjs` snapshots `{embedding, embedding_model}` keyed by `JSON.stringify([headline, byline, body_plain, category])`.
2. After INSERT, articles whose fingerprint matches get their embedding restored.
3. Articles whose content changed (or are new) are left `NULL` for `embed.mjs` to fill in.

**Worked example**:

- Article A before reseed: `headline="Students March"`, `body_plain="Hundreds marched..."`. Fingerprint computed, embedding snapshotted.
- Reseed runs adapter, produces the same headline and body. Fingerprint matches; embedding restored. No API call.
- Article B before reseed: `headline="Fire Destroys Gymnasium"`. After an OCR fix, `body_plain` now has corrected text. Fingerprint differs; B is left with `NULL` embedding. `embed.mjs` re-embeds only B — ~$0.0001 vs re-embedding the whole corpus at ~$1.

**Failure mode**: any whitespace-only diff in `body_plain` (e.g., `"\n\n"` normalization) produces a different fingerprint and triggers a spurious re-embed. The adapter's text-cleaning pipeline is deterministic, so this is rare in practice but worth knowing before you introduce whitespace changes mid-pipeline.

---

## Image storage

Local path: `public/editions/<date>/images/<filename>.(jpg|jpeg|png|gif|tif|tiff)`

R2 CDN path: `{IMAGE_BASE_URL}/<date>/images/<filename>.webp`

### Upload flow

`scripts/db/upload-images.mjs`:

1. Iterate the local images directory
2. For each file, convert to WebP at quality 85 using `sharp`
3. Upload to Cloudflare R2 via the AWS S3 SDK (key: `<date>/images/<filename>.webp`)
4. Idempotent: HEAD check before PUT unless `--force`
5. Write `upload-manifest.json` to the edition directory

### URL resolution

`src/lib/image-url.ts :: resolveImageUrl(date, filename)`:

- If `IMAGE_BASE_URL` is set (production): returns `${IMAGE_BASE_URL}/<date>/images/<file>.webp`
- Otherwise (dev): returns `/api/editions/<date>/images/<file>`

Called in `article-transform.ts` and `ad-transform.ts` at seed time.

### Dev proxy route

`src/app/api/editions/[date]/images/[...path]/route.ts` serves files from `public/editions/<date>/images/` with path-traversal guards and a gold-directory fallback (`gold/<date>/images/`). Cache headers: `public, max-age=31536000, immutable`.

---

## Neon specifics

`@neondatabase/serverless` uses HTTP for every query. No persistent TCP connection, no connection pool. Ideal for Vercel serverless but with one critical limitation: **no `AbortSignal` support**.

The implication: once `sql\`...\`` is called, the query runs to completion on Neon's server regardless of client-side cancellation. `AbortController` or `AbortSignal` have no effect.

### The `raceWithTimeout` pattern

```typescript
function raceWithTimeout<T>(op, promise, timeoutMs) {
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DbTimeoutError(op, timeoutMs)), timeoutMs);
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeoutPromise]);
}
```

`DbTimeoutError` unblocks the caller. The underlying Neon query may still be running server-side — orphaned. The 8-second default (`HYBRID_SEARCH_TIMEOUT_MS`) protects the `/api/ask` response budget (30s global deadline) from a stuck DB call. All callers that receive `DbTimeoutError` convert it to HTTP 504.

This pattern applies to `hybridSearch` and `queryArticlesByEmbedding`. It is not applied to simpler point-lookup queries (`queryEditionByDate`, `searchArticles`) which don't participate in the RAG hot path.

### Lazy `_sql` clients

In `cost-tracker.ts`, `conversation-store.ts`, and `rate-limit.ts`, Neon clients are initialized lazily to avoid throwing at module import time when `DATABASE_URL` is absent. This makes tests work without a DB and allows graceful degradation at runtime.

---

## Tests

### Adapter unit tests

`tests/ocr-adapter/image-rules.test.ts` — 22 tests covering the three image-rule predicates. This is the only dedicated adapter unit test file; other modules (`category-rules`, `text-cleaning`, transforms) are exercised transitively through integration and gold-edition comparison workflows.

### Integration-level coverage

`tests/lib/db-vector-search.test.ts` covers `hybridSearch` and the vector/FTS merge logic with a mocked Neon client.

### Gold-edition regression

The gold edition at `gold/1960-01-13/gold-edition.json` is protected by `scripts/db/locked-editions.json` and serves as a frozen known-good baseline. Changes to adapter rules can be validated by diffing the current DB state against a fresh seed of the gold source.

---

## Known limitations

Accepted tradeoffs. These are intentional, not TODOs.

1. **`migrate-rag-improvements.mjs` drops the HNSW index.** After running the migration, you *must* run `db:embed:force` then `recreate-hnsw-index.mjs`, or vector search silently falls back to sequential scan. **Accepted because** bundling the re-embed step into the migration would make it un-cancelable on a multi-hour embed job. The sharp edge is documented.
2. **Embedding fingerprint is whitespace-sensitive.** A normalization change to `body_plain` produces fingerprint misses on every article, triggering a full re-embed. **Accepted because** the adapter's text-cleaning pipeline is deterministic and rarely changes. The cost of a false miss (~$1 corpus re-embed) is acceptable for a portfolio project.
3. **Ads use SERIAL PK and can't be upserted.** Every re-seed does a DELETE + INSERT; ad IDs change across seeds. **Accepted because** ads have no cross-reference surface (no URLs, no deep links). If they ever do, this needs rethinking.
4. **Per-instance rate-limit fallback under-counts across Vercel instances.** During Neon outages, effective per-IP limit is `N × instance_count`. **Accepted because** the primary path (Neon-backed) handles correctness; the fallback only fires during infrastructure failure.
5. **Neon orphan queries accumulate on timeout.** `raceWithTimeout` unblocks the caller but the query continues server-side. **Accepted because** the HTTP driver has no cancellation mechanism; at current scale the connection pool tolerates it.
6. **No schema-version column.** There's no automated check that the DB has every migration applied. **Accepted because** all migrations are idempotent (`IF NOT EXISTS`); running them all is safe and fast. Manual verification via `psql \d+ articles` is the fallback.
7. **Gold edition `locked-editions.json` is the only dated-article protection mechanism.** Any other edition can be destroyed by `db:reset --unlock`. **Accepted because** all other editions are reproducible from `edition.json` on disk; only the gold regression baseline matters for verification.
8. **Multimodal embedding batch atomicity.** `embedDocuments` fails the whole batch on one image failure. **Accepted because** splitting on error doubles API calls on the common path. See `docs/issues/` for the full analysis.

---

## Operator runbook

### Reseed from scratch

```bash
npm run db:reset
# Drops all tables, applies schema, restores gold, seeds all editions,
# builds search vectors, embeds unembedded articles.
# With --unlock: skips gold protection.
```

If `gold/1960-01-13/gold-edition.json` is present locally, it's automatically restored. If not, the DB export mechanism (pre-drop snapshot) handles it as long as the table had the data before DROP.

### Re-embed after changing embedding model or text format

```bash
npm run db:embed:force
# Re-embeds all ~10k articles. ~50 min at gemini-embedding-2-preview rates.
# Stops early on daily quota exhaustion; resume next day.

node --import tsx scripts/db/recreate-hnsw-index.mjs
# MUST run after embed completes. Drops and recreates the HNSW index.
# Without this, vector search falls back to sequential scan.
```

### Rebuild HNSW index without re-embedding

```bash
node --import tsx scripts/db/recreate-hnsw-index.mjs
```

Only needed if the index was dropped (e.g., by `migrate-rag-improvements.mjs`) and embeddings are already current.

### Investigate a slow query

1. **Confirm HNSW index exists**. Use `\d articles` in `psql` to verify `idx_articles_embedding`. If missing, vector search is on sequential scan.
2. **Check the daily budget**. `SELECT * FROM ai_spend_counter WHERE day = CURRENT_DATE`. A request that looks stuck may be budget-blocked before the query reached the DB.
3. **Check `api_rate_bucket`**. Look for IP-level throttling.
4. **Hybrid search timeout**. `hybridSearch` has an 8-second timeout (`HYBRID_SEARCH_TIMEOUT_MS`); a `DbTimeoutError` in logs means the DB exceeded that budget.
5. **Neon slow-query log**. Examine the Neon console for server-side slow queries that may indicate orphaned queries accumulating.

### Restore from gold

The gold edition at `gold/1960-01-13/` is protected by `locked-editions.json`. On any `db:reset`:

1. Pre-DROP: seed exports DB rows for that date
2. Post-DROP + schema recreation: seed re-imports the saved rows

Alternatively, with gold files on disk, any `db:seed` triggers `ensureLockedEditions()` which copies `gold/1960-01-13/gold-edition.json` → `public/editions/1960-01-13/edition.json`, then seeds through the adapter.

**Direct SQL restore is not supported** — it bypasses the adapter's filtering and dedup logic.

### Run the migration follow-up sequence

```bash
node --import tsx scripts/db/migrate-rag-improvements.mjs
npm run db:embed:force
node --import tsx scripts/db/recreate-hnsw-index.mjs
```

Run in this exact order. Skipping or reordering leaves vector search degraded.

---

## Start here

If you're new and need to make a change, read these in order:

1. `scripts/db/schema.sql` — the canonical DDL. Everything else is downstream of this.
2. `ocr/src/transcript_ocr/contracts/content_models.py` — the `edition.json` contract, source of truth for everything that flows into the DB.
3. `src/server/ocr-adapter/article-transform.ts` — where `edition.json` becomes DB rows. Every normalization rule lives here.
4. `src/lib/db.ts` — every runtime read query. `raceWithTimeout` and `DbTimeoutError` patterns apply to every caller.
5. `scripts/db/seed.mjs` — the end-to-end seed flow. The embedding fingerprint logic is the most non-obvious piece.
