-- Drop the Gemini-era 768-dimension vectors and the unused answer cache.
-- Ask serves only build-scoped Voyage vectors (embedding_1024, 0013) through
-- the serving pointer (0014); the legacy and shadow retrieval modes that read
-- articles.embedding are gone, and no code reads these columns or table.
--
-- Old Gemini builds keep their rows in article_chunks / article_images but
-- lose their vectors; gc-index-builds.mjs prunes them like any unpinned build.

DROP INDEX IF EXISTS idx_articles_embedding;
DROP INDEX IF EXISTS idx_article_chunks_embedding;
DROP INDEX IF EXISTS idx_article_images_embedding;

ALTER TABLE articles DROP COLUMN IF EXISTS embedding;
ALTER TABLE article_chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE article_images DROP COLUMN IF EXISTS embedding;

DROP TABLE IF EXISTS answer_cache;
