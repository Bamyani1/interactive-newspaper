-- Corpus version registry plus revision keys on the evidence tables, so
-- versioned chunks/images are keyable to BOTH content_revision_id and
-- index_build_id. Legacy rows keep NULL in both columns. The frozen legacy
-- corpus row is registered by a data script, never here.

CREATE TABLE IF NOT EXISTS corpus_versions (
  id            TEXT PRIMARY KEY,
  manifest_hash TEXT,
  edition_count INTEGER,
  article_count INTEGER,
  ad_count      INTEGER,
  image_count   INTEGER,
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE article_chunks
  ADD COLUMN IF NOT EXISTS content_revision_id TEXT REFERENCES content_revisions(id);
ALTER TABLE article_images
  ADD COLUMN IF NOT EXISTS content_revision_id TEXT REFERENCES content_revisions(id);

CREATE INDEX IF NOT EXISTS idx_article_chunks_content_revision
  ON article_chunks(content_revision_id) WHERE content_revision_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_article_images_content_revision
  ON article_images(content_revision_id) WHERE content_revision_id IS NOT NULL;
