-- Voyage embeddings: 1024-dimension vectors beside the 768-dimension Gemini
-- ones. Additive, so a Gemini build keeps serving from `embedding` while a
-- Voyage build fills `embedding_1024`; runtime SQL picks the column from the
-- active build's embedding_dims.
--
-- Text chunks and photos use different Voyage models (voyage-context-4 and
-- voyage-multimodal-3.5), so a build records both. A NULL
-- image_embedding_model means the build used one model for both, and a NULL
-- embedding_dims means 768: every build made before this migration.

ALTER TABLE rag_index_builds ADD COLUMN IF NOT EXISTS image_embedding_model TEXT;
ALTER TABLE rag_index_builds ADD COLUMN IF NOT EXISTS embedding_dims INTEGER;

ALTER TABLE article_chunks ADD COLUMN IF NOT EXISTS embedding_1024 VECTOR(1024);
ALTER TABLE article_images ADD COLUMN IF NOT EXISTS embedding_1024 VECTOR(1024);

-- A Claude-written line placing the chunk in its article and edition. It is
-- indexed for keyword search with the chunk; NULL indexes the chunk alone,
-- exactly as before.
ALTER TABLE article_chunks ADD COLUMN IF NOT EXISTS context_text TEXT;

CREATE INDEX IF NOT EXISTS idx_article_chunks_embedding_1024
  ON article_chunks USING hnsw (embedding_1024 vector_cosine_ops)
  WITH (m = 16, ef_construction = 128);
CREATE INDEX IF NOT EXISTS idx_article_images_embedding_1024
  ON article_images USING hnsw (embedding_1024 vector_cosine_ops)
  WITH (m = 16, ef_construction = 128);

CREATE OR REPLACE FUNCTION article_chunks_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', concat_ws(' ', NEW.context_text, NEW.chunk_text));
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS article_chunks_search_vector_trig ON article_chunks;
CREATE TRIGGER article_chunks_search_vector_trig
  BEFORE INSERT OR UPDATE OF chunk_text, context_text ON article_chunks
  FOR EACH ROW EXECUTE FUNCTION article_chunks_search_vector_update();
