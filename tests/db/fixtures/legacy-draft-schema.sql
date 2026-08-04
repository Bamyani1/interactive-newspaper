-- The Transcript Archive — PostgreSQL Schema
-- Designed for Neon serverless PostgreSQL
-- Run via: npm run db:seed (or db:reset to drop + recreate)

-- ─── Extensions ──────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS vector;

-- ─── Editions ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS editions (
  date             TEXT PRIMARY KEY,
  publication_info TEXT NOT NULL DEFAULT '',
  page_count       INTEGER NOT NULL DEFAULT 1,
  article_count    INTEGER NOT NULL DEFAULT 0
);

-- ─── Articles ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS articles (
  id              TEXT PRIMARY KEY,         -- '{date}-{index}'
  edition_date    TEXT NOT NULL REFERENCES editions(date),
  position        INTEGER NOT NULL,         -- preserves ordering
  category        TEXT NOT NULL DEFAULT 'News',
  headline        TEXT NOT NULL DEFAULT '',
  summary         TEXT NOT NULL DEFAULT '',
  full_text       TEXT NOT NULL DEFAULT '',  -- HTML body
  body_plain      TEXT NOT NULL DEFAULT '',  -- plain text for FTS
  byline          TEXT,
  page            INTEGER NOT NULL DEFAULT 1,
  is_hero         BOOLEAN NOT NULL DEFAULT FALSE,
  is_featured     BOOLEAN NOT NULL DEFAULT FALSE,
  image_urls      JSONB NOT NULL DEFAULT '[]',
  image_caption   TEXT,
  image_captions  JSONB NOT NULL DEFAULT '[]',
  search_vector   TSVECTOR,                 -- auto-populated for FTS
  embedding       VECTOR(768),              -- legacy article vector during chunk-index migration
  embedding_input_hash TEXT,
  embedding_input_version TEXT
);

CREATE INDEX IF NOT EXISTS idx_articles_edition ON articles(edition_date);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);
CREATE INDEX IF NOT EXISTS idx_articles_byline ON articles(byline) WHERE byline IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_articles_search ON articles USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_articles_embedding ON articles USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 128);

-- ─── RAG chunks and image vectors ───────────────────────────────

CREATE TABLE IF NOT EXISTS rag_index_builds (
  id                            TEXT PRIMARY KEY,
  corpus_version                TEXT NOT NULL,
  status                        TEXT NOT NULL CHECK (
    status IN ('building', 'validated', 'active', 'failed', 'retired')
  ),
  pipeline_version              TEXT NOT NULL,
  embedding_model               TEXT NOT NULL,
  text_embedding_input_version  TEXT NOT NULL,
  image_embedding_input_version TEXT NOT NULL,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  validated_at                  TIMESTAMPTZ,
  activated_at                  TIMESTAMPTZ,
  failure_reason                TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_index_builds_one_active_per_corpus
  ON rag_index_builds(corpus_version) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS article_chunks (
  id                      TEXT PRIMARY KEY,
  index_build_id          TEXT NOT NULL REFERENCES rag_index_builds(id),
  article_id              TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  chunk_index             INTEGER NOT NULL,
  chunk_text              TEXT NOT NULL,
  search_vector           TSVECTOR,
  embedding               VECTOR(768),
  embedding_model         TEXT,
  embedding_input_version TEXT,
  embedding_input_hash    TEXT NOT NULL,
  UNIQUE (index_build_id, article_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_article_chunks_article
  ON article_chunks(index_build_id, article_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_article_chunks_search ON article_chunks USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_article_chunks_embedding ON article_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 128);

CREATE TABLE IF NOT EXISTS article_images (
  id                      TEXT PRIMARY KEY,
  index_build_id          TEXT NOT NULL REFERENCES rag_index_builds(id),
  article_id              TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  image_index             INTEGER NOT NULL,
  image_url               TEXT NOT NULL,
  caption                 TEXT,
  embedding               VECTOR(768),
  embedding_model         TEXT,
  embedding_input_version TEXT,
  embedding_input_hash    TEXT,
  UNIQUE (index_build_id, article_id, image_index)
);

CREATE INDEX IF NOT EXISTS idx_article_images_article
  ON article_images(index_build_id, article_id, image_index);
CREATE INDEX IF NOT EXISTS idx_article_images_caption_search ON article_images
  USING gin (to_tsvector('english', coalesce(caption, '')));
CREATE INDEX IF NOT EXISTS idx_article_images_embedding ON article_images USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 128);

-- ─── Ads ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ads (
  id            SERIAL PRIMARY KEY,
  edition_date  TEXT NOT NULL REFERENCES editions(date),
  position      INTEGER NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  body          TEXT NOT NULL DEFAULT '',
  category      TEXT,
  ad_type       TEXT,
  display_text  TEXT,
  phone         TEXT,
  address       TEXT,
  price         TEXT,
  image_urls    JSONB NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_ads_edition ON ads(edition_date);

-- ─── Migrations (safe to re-run) ───────────────────────────────────

ALTER TABLE articles ADD COLUMN IF NOT EXISTS writer_position TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS embedding_model TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS embedding_input_hash TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS embedding_input_version TEXT;

ALTER TABLE ads ADD COLUMN IF NOT EXISTS image_urls JSONB NOT NULL DEFAULT '[]';
ALTER TABLE ads ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE ads ADD COLUMN IF NOT EXISTS ad_type TEXT;
ALTER TABLE ads ADD COLUMN IF NOT EXISTS display_text TEXT;
ALTER TABLE ads ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE ads ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE ads ADD COLUMN IF NOT EXISTS price TEXT;

-- ─── Weather ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS weather (
  date              TEXT NOT NULL,
  scope             TEXT NOT NULL DEFAULT 'delaware',
  tmax_c            REAL,
  tmin_c            REAL,
  precip_mm         REAL,
  source            TEXT NOT NULL,
  source_station_id TEXT,
  quality_flag      TEXT,
  is_estimated      BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (date, scope)
);

-- ─── Music ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS music (
  year       INTEGER NOT NULL,
  month      TEXT NOT NULL,
  rank       INTEGER NOT NULL,
  title      TEXT NOT NULL,
  artist     TEXT NOT NULL,
  youtube_id TEXT NOT NULL,
  PRIMARY KEY (year, month, rank)
);

-- ─── Ask feedback (👍 / 👎 on RAG answers) ──────────────────────

CREATE TABLE IF NOT EXISTS ask_feedback (
  id          BIGSERIAL PRIMARY KEY,
  request_id  TEXT NOT NULL,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  confidence  TEXT,
  mode        TEXT,
  citations   JSONB NOT NULL DEFAULT '[]',
  vote        TEXT NOT NULL CHECK (vote IN ('up', 'down')),
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ask_feedback_request ON ask_feedback(request_id);
CREATE INDEX IF NOT EXISTS idx_ask_feedback_created ON ask_feedback(created_at DESC);

-- ─── Search Vector Trigger ──────────────────────────────────────

CREATE OR REPLACE FUNCTION articles_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.headline, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.byline, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.body_plain, '')), 'C');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'articles_search_vector_trig'
  ) THEN
    CREATE TRIGGER articles_search_vector_trig
    BEFORE INSERT OR UPDATE ON articles
    FOR EACH ROW EXECUTE FUNCTION articles_search_vector_update();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION article_chunks_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', coalesce(NEW.chunk_text, ''));
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'article_chunks_search_vector_trig'
  ) THEN
    CREATE TRIGGER article_chunks_search_vector_trig
    BEFORE INSERT OR UPDATE OF chunk_text ON article_chunks
    FOR EACH ROW EXECUTE FUNCTION article_chunks_search_vector_update();
  END IF;
END $$;
