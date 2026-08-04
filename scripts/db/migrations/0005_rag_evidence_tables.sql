-- Converges the three chunk/image table variants found in the wild to one
-- canonical shape:
--   (a) absent (production / fresh database)              → created here
--   (b) migrate-rag-v2 shape: no index_build_id,
--       UNIQUE(article_id, chunk_index)                    → column added, constraint re-keyed
--   (c) branch draft shape: index_build_id NOT NULL,
--       UNIQUE(index_build_id, article_id, chunk_index)    → NOT NULL dropped, constraint re-keyed
--
-- Canonical shape: index_build_id is NULLABLE. Legacy seed rows carry NULL and
-- can never serve versioned retrieval (runtime SQL filters by an explicit
-- build id); build-scoped rows are written only by the index build tool.
-- Uniqueness is expressed as two partial unique indexes so all variants
-- introspect identically after this migration.

CREATE TABLE IF NOT EXISTS article_chunks (
  id                      TEXT PRIMARY KEY,
  index_build_id          TEXT REFERENCES rag_index_builds(id),
  article_id              TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  chunk_index             INTEGER NOT NULL,
  chunk_text              TEXT NOT NULL,
  search_vector           TSVECTOR,
  embedding               VECTOR(768),
  embedding_model         TEXT,
  embedding_input_version TEXT,
  embedding_input_hash    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS article_images (
  id                      TEXT PRIMARY KEY,
  index_build_id          TEXT REFERENCES rag_index_builds(id),
  article_id              TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  image_index             INTEGER NOT NULL,
  image_url               TEXT NOT NULL,
  caption                 TEXT,
  embedding               VECTOR(768),
  embedding_model         TEXT,
  embedding_input_version TEXT,
  embedding_input_hash    TEXT
);

-- Variant (b): add the missing column (FK constraint name matches the inline
-- REFERENCES name used on the fresh path).
ALTER TABLE article_chunks
  ADD COLUMN IF NOT EXISTS index_build_id TEXT REFERENCES rag_index_builds(id);
ALTER TABLE article_images
  ADD COLUMN IF NOT EXISTS index_build_id TEXT REFERENCES rag_index_builds(id);

-- Variant (c): draft NOT NULL becomes nullable (no-op when already nullable).
ALTER TABLE article_chunks ALTER COLUMN index_build_id DROP NOT NULL;
ALTER TABLE article_images ALTER COLUMN index_build_id DROP NOT NULL;

-- Re-key uniqueness: drop whichever table constraint a variant created, then
-- express both invariants as partial unique indexes.
ALTER TABLE article_chunks
  DROP CONSTRAINT IF EXISTS article_chunks_article_id_chunk_index_key;
ALTER TABLE article_chunks
  DROP CONSTRAINT IF EXISTS article_chunks_index_build_id_article_id_chunk_index_key;
ALTER TABLE article_images
  DROP CONSTRAINT IF EXISTS article_images_article_id_image_index_key;
ALTER TABLE article_images
  DROP CONSTRAINT IF EXISTS article_images_index_build_id_article_id_image_index_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_article_chunks_legacy
  ON article_chunks(article_id, chunk_index) WHERE index_build_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_article_chunks_build
  ON article_chunks(index_build_id, article_id, chunk_index) WHERE index_build_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_article_images_legacy
  ON article_images(article_id, image_index) WHERE index_build_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_article_images_build
  ON article_images(index_build_id, article_id, image_index) WHERE index_build_id IS NOT NULL;

-- The variants define idx_article_chunks_article / idx_article_images_article
-- with different column lists; rebuild deterministically.
DROP INDEX IF EXISTS idx_article_chunks_article;
DROP INDEX IF EXISTS idx_article_images_article;
CREATE INDEX idx_article_chunks_article
  ON article_chunks(index_build_id, article_id, chunk_index);
CREATE INDEX idx_article_images_article
  ON article_images(index_build_id, article_id, image_index);

CREATE INDEX IF NOT EXISTS idx_article_chunks_search ON article_chunks USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_article_chunks_embedding
  ON article_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 128);
CREATE INDEX IF NOT EXISTS idx_article_images_caption_search ON article_images
  USING gin (to_tsvector('english', coalesce(caption, '')));
CREATE INDEX IF NOT EXISTS idx_article_images_embedding
  ON article_images USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 128);

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
