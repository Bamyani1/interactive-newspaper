-- Authoritative asset registry. Rows are immutable; the registry is
-- bootstrapped by a data script (Phase 5), never by migrations.

CREATE TABLE IF NOT EXISTS assets (
  sha256        TEXT PRIMARY KEY,
  byte_count    BIGINT NOT NULL,
  width         INTEGER,
  height        INTEGER,
  mime_type     TEXT NOT NULL,
  source_sha256 TEXT,
  storage_key   TEXT NOT NULL,
  legacy_key    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS asset_references (
  content_revision_id TEXT NOT NULL REFERENCES content_revisions(id),
  position            INTEGER NOT NULL,
  asset_id            TEXT NOT NULL REFERENCES assets(sha256),
  role                TEXT NOT NULL CHECK (role IN ('article_image', 'ad_image')),
  printed_caption     TEXT,
  credit              TEXT,
  PRIMARY KEY (content_revision_id, position)
);

CREATE INDEX IF NOT EXISTS idx_asset_references_asset ON asset_references(asset_id);
