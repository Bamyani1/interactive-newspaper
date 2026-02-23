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
  embedding       VECTOR(768)               -- semantic embedding for RAG (gemini-embedding-001)
);

CREATE INDEX IF NOT EXISTS idx_articles_edition ON articles(edition_date);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);
CREATE INDEX IF NOT EXISTS idx_articles_byline ON articles(byline) WHERE byline IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_articles_search ON articles USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_articles_embedding ON articles USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

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
  price         TEXT
);

CREATE INDEX IF NOT EXISTS idx_ads_edition ON ads(edition_date);

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
