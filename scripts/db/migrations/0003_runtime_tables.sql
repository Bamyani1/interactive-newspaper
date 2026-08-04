-- Runtime/privacy tables that previously lived only in one-off migrate-*.mjs
-- scripts. The ALTER converges a production ask_session_turns created before
-- the citation_snapshots column existed.

CREATE TABLE IF NOT EXISTS ask_feedback (
  id          BIGSERIAL PRIMARY KEY,
  request_id  TEXT NOT NULL,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  confidence  TEXT,
  mode        TEXT,
  citations   JSONB NOT NULL DEFAULT '[]',
  vote        TEXT NOT NULL CHECK (vote IN ('up', 'down')),
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ask_feedback_request ON ask_feedback(request_id);
CREATE INDEX IF NOT EXISTS idx_ask_feedback_created ON ask_feedback(created_at DESC);

CREATE TABLE IF NOT EXISTS ask_session_turns (
  id                 BIGSERIAL PRIMARY KEY,
  session_id         TEXT NOT NULL,
  question           TEXT NOT NULL,
  answer             TEXT NOT NULL,
  cited_article_ids  TEXT[] NOT NULL DEFAULT '{}',
  citation_snapshots JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ask_session_turns
  ADD COLUMN IF NOT EXISTS citation_snapshots JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_ask_session_turns_session_created
  ON ask_session_turns(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ask_session_turns_created
  ON ask_session_turns(created_at DESC);

CREATE TABLE IF NOT EXISTS ai_spend_counter (
  day         DATE PRIMARY KEY,
  spent_usd   NUMERIC(12, 6) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_rate_bucket (
  key         TEXT PRIMARY KEY,
  count       INTEGER NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_rate_bucket_expires
  ON api_rate_bucket(expires_at);
