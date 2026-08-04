-- Immutable edition/content revisions, stable content identity, legacy
-- aliases, and the review queue for ambiguous re-OCR matches.

CREATE TABLE IF NOT EXISTS edition_revisions (
  id               TEXT PRIMARY KEY,
  issue_id         TEXT NOT NULL REFERENCES issues(id),
  revision_hash    TEXT NOT NULL,
  publication_info TEXT NOT NULL DEFAULT '',
  expected_pages   INTEGER,
  processed_pages  INTEGER,
  failed_pages     JSONB NOT NULL DEFAULT '[]',
  created_by_run   TEXT REFERENCES publication_runs(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (issue_id, revision_hash)
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_issues_active_edition_revision'
  ) THEN
    ALTER TABLE issues
      ADD CONSTRAINT fk_issues_active_edition_revision
      FOREIGN KEY (active_edition_revision_id) REFERENCES edition_revisions(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS edition_revision_pages (
  edition_revision_id TEXT NOT NULL REFERENCES edition_revisions(id),
  page_number         INTEGER NOT NULL,
  source_record_id    TEXT REFERENCES source_records(id),
  iiif_canvas_id      TEXT,
  status              TEXT NOT NULL CHECK (status IN ('processed', 'failed', 'missing')),
  PRIMARY KEY (edition_revision_id, page_number)
);

CREATE TABLE IF NOT EXISTS content_items (
  id                 TEXT PRIMARY KEY,
  issue_id           TEXT NOT NULL REFERENCES issues(id),
  content_type       TEXT NOT NULL CHECK (content_type IN ('article', 'ad', 'other')),
  identity_key       TEXT NOT NULL,
  identity_evidence  JSONB NOT NULL DEFAULT '{}',
  active_revision_id TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (issue_id, identity_key)
);

CREATE TABLE IF NOT EXISTS content_revisions (
  id                  TEXT PRIMARY KEY,
  content_item_id     TEXT NOT NULL REFERENCES content_items(id),
  edition_revision_id TEXT REFERENCES edition_revisions(id),
  revision_hash       TEXT NOT NULL,
  category            TEXT NOT NULL DEFAULT 'News',
  headline            TEXT NOT NULL DEFAULT '',
  summary             TEXT NOT NULL DEFAULT '',
  full_text           TEXT NOT NULL DEFAULT '',
  body_plain          TEXT NOT NULL DEFAULT '',
  byline              TEXT,
  writer_position     TEXT,
  page                INTEGER NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (content_item_id, revision_hash)
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_content_items_active_revision'
  ) THEN
    ALTER TABLE content_items
      ADD CONSTRAINT fk_content_items_active_revision
      FOREIGN KEY (active_revision_id) REFERENCES content_revisions(id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION content_revisions_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'content_revisions rows are immutable; write a new revision instead';
END $$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'content_revisions_immutable_trig'
  ) THEN
    CREATE TRIGGER content_revisions_immutable_trig
    BEFORE UPDATE ON content_revisions
    FOR EACH ROW EXECUTE FUNCTION content_revisions_immutable();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS legacy_content_aliases (
  legacy_id           TEXT PRIMARY KEY,
  content_item_id     TEXT NOT NULL REFERENCES content_items(id),
  content_revision_id TEXT REFERENCES content_revisions(id),
  alias_kind          TEXT NOT NULL CHECK (alias_kind IN ('article', 'ad'))
);

CREATE INDEX IF NOT EXISTS idx_legacy_content_aliases_item
  ON legacy_content_aliases(content_item_id);

CREATE TABLE IF NOT EXISTS content_identity_conflicts (
  id                 BIGSERIAL PRIMARY KEY,
  issue_id           TEXT REFERENCES issues(id),
  candidate_evidence JSONB NOT NULL DEFAULT '{}',
  candidate_item_ids TEXT[] NOT NULL DEFAULT '{}',
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
