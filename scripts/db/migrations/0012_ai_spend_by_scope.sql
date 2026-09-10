-- Daily AI spend, one row per UTC day per environment. ai_spend_counter
-- (0003) keyed spend by day alone, so local development, preview
-- deployments and production all drew on one budget: an afternoon of local
-- testing could leave real readers budget-blocked. cost-tracker.ts derives
-- the scope from VERCEL_ENV, and anything outside Vercel is 'local'.
--
-- A new table rather than a new key on the old one: the code already
-- deployed upserts ON CONFLICT (day), which fails once day alone is no
-- longer a unique key, and migrations are applied before the code that
-- needs them ships. ai_spend_counter is left in place and stops growing
-- once this deploys.

CREATE TABLE IF NOT EXISTS ai_spend_by_scope (
  day         DATE NOT NULL,
  scope       TEXT NOT NULL CHECK (scope IN ('production', 'preview', 'development', 'local')),
  spent_usd   NUMERIC(12, 6) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, scope)
);

-- Carry today's shared total over as production spend, so the switch cannot
-- hand production a fresh budget part-way through a day it already spent.
INSERT INTO ai_spend_by_scope (day, scope, spent_usd, updated_at)
SELECT day, 'production', spent_usd, updated_at
FROM ai_spend_counter
WHERE day = (now() AT TIME ZONE 'UTC')::date
ON CONFLICT (day, scope) DO NOTHING;
