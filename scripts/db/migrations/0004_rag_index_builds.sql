-- Immutable index-build identity. Identical shape to the branch draft so a
-- development database that already created it converges; the ledger simply
-- records it. No code inserts rows here until the Phase 5 build tool.

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
