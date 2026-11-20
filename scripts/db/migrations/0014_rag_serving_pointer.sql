-- The build Ask serves, named in the database so switching builds (and
-- switching back) needs no redeploy. One row; build-rag-index.mjs --switch
-- writes it together with the builds' statuses. RAG_ACTIVE_INDEX_BUILD_ID and
-- RAG_CORPUS_VERSION still win when set, as an emergency override.
--
-- The serving build cannot be deleted while it serves (no ON DELETE); the
-- previous one can, which only ends the option to switch back to it.

CREATE TABLE IF NOT EXISTS rag_serving_pointer (
  id                      SMALLINT PRIMARY KEY CHECK (id = 1),
  index_build_id          TEXT NOT NULL REFERENCES rag_index_builds(id),
  corpus_version          TEXT NOT NULL,
  previous_build_id       TEXT REFERENCES rag_index_builds(id) ON DELETE SET NULL,
  previous_corpus_version TEXT,
  switched_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
