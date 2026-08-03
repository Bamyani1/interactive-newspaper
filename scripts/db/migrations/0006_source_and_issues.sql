-- Immutable external source identity, stable internal issue identity, and the
-- publication state machine. Expand-only: nothing here reads or rewrites
-- legacy tables.

CREATE TABLE IF NOT EXISTS source_records (
  id            TEXT PRIMARY KEY,
  source_system TEXT NOT NULL,
  pointer       TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (
    kind IN ('issue_parent', 'child_page', 'supplement', 'duplicate', 'excluded', 'ambiguous')
  ),
  metadata      JSONB NOT NULL DEFAULT '{}',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_system, pointer)
);

CREATE TABLE IF NOT EXISTS issues (
  id                         TEXT PRIMARY KEY,
  canonical_date             TEXT NOT NULL,
  source_record_id           TEXT REFERENCES source_records(id),
  active_edition_revision_id TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_issues_canonical_date ON issues(canonical_date);

CREATE TABLE IF NOT EXISTS legacy_edition_aliases (
  date     TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id)
);

CREATE TABLE IF NOT EXISTS publication_runs (
  id             TEXT PRIMARY KEY,
  issue_id       TEXT REFERENCES issues(id),
  state          TEXT NOT NULL CHECK (
    state IN ('discovered', 'acquired', 'ocr_candidate', 'assets_staged',
              'db_revision_staged', 'validated', 'active', 'failed', 'rolled_back')
  ),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  failure_reason TEXT,
  metadata       JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_publication_runs_issue ON publication_runs(issue_id);

CREATE TABLE IF NOT EXISTS publication_run_events (
  id         BIGSERIAL PRIMARY KEY,
  run_id     TEXT NOT NULL REFERENCES publication_runs(id),
  from_state TEXT,
  to_state   TEXT NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  note       TEXT
);

CREATE INDEX IF NOT EXISTS idx_publication_run_events_run ON publication_run_events(run_id);
