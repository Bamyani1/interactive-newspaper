-- Semantic answer cache: paraphrase-matched cached responses keyed by
-- question embedding. Rows are scoped to a cache_identity string (pipeline
-- version + models + corpus + retrieval identity) so any serving change
-- invalidates by scoping, never by deletion. Low volume: exact scan, no
-- vector index needed.

CREATE TABLE IF NOT EXISTS answer_cache (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cache_identity     TEXT NOT NULL,
  filters_hash       TEXT NOT NULL,
  question           TEXT NOT NULL,
  question_embedding VECTOR(768) NOT NULL,
  response           JSONB NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS answer_cache_scope_idx
  ON answer_cache (cache_identity, filters_hash, created_at DESC);
