# Phase 8 production rollout runbook

Rolls the evaluated candidate build `build-01KZ43MP8XEGE3J7RAJH3K7W45` into
production **without re-embedding** (vectors import from the verified local
export). Every step below was rehearsed end-to-end on 2026-08-03 against
`prod_mirror`, a local database restored from production's actual schema
dump — including the migration convergence, the vector import, activation,
versioned serving, and the rollback drill.

## Hard preconditions (all must hold before step 1)

1. **Explicit user approval** for production writes (this document is not
   approval).
2. **Neon quota headroom** — the free-tier monthly allowance has reset (or
   the plan changed). The import writes ~180 MB and builds HNSW indexes.
3. **Code deployed** — the `rag-enhancement` branch is merged/pushed per the
   user's Vercel decision. The serving flip (step 7) requires the new code
   in production; steps 1–6 are safe under the OLD code (expand-only schema,
   no serving change).
4. Fresh ADC (`npx tsx scripts/dev/verify-adc.ts`), and `DATABASE_URL` set
   to production for each command below.
5. The import artifact directory (chunks/images JSONL + manifest, final
   counts 13,143 / 2,875) is present and hash-verifies:
   `production-import-build-01KZ43MP8XEGE3J7RAJH3K7W45/` (scratchpad; also
   recoverable by re-export from the local `evaldb_local`).

## Sequence

Abort at ANY unexpected output; every step is idempotent or reversible.

| # | Step | Command | Expected |
|---|------|---------|----------|
| 1 | Drift check | `pg_dump --schema-only` prod, diff vs the rehearsal dump | No new drift beyond the documented legacy `entities`/`article_entities` |
| 2 | Migrations | `npm run db:migrate` | 0001–0009 applied; `db:migrate:status` clean; legacy tables untouched |
| 3 | Identity backfill | `npx tsx scripts/db/backfill-identities.mjs --yes` | ~351 issues / 11,692 items / 11,703 revisions / 11,705 aliases, 0 skipped (~31 batched requests) |
| 4 | Register corpus | `npx tsx -e` one-liner calling `registerCorpusVersion` from `scripts/rag/setup-eval-db.mjs` with the frozen corpus JSON | row `legacy-8b8207373510d69e` in `corpus_versions` |
| 5 | Import vectors | `npx tsx scripts/db/import-build-vectors.mjs --dir <export> --yes` | `insertedChunks: 13143, insertedImages: 2875`; build lands **validated** (never active) |
| 6 | Activate | `npm run rag:index:build -- --activate build-01KZ… --yes` | status `active`; serving is STILL legacy (env unchanged) |
| 7 | Shadow | Set `RAG_RETRIEVAL_MODE=shadow`, `RAG_ACTIVE_INDEX_BUILD_ID=build-01KZ…`, `RAG_CORPUS_VERSION=legacy-8b8207373510d69e` in Vercel; redeploy | Users still get legacy answers; shadow telemetry populates |
| 8 | Canary | After ≥24 h clean shadow: `RAG_RETRIEVAL_MODE=versioned` | New retrieval serves; watch error rate + latency + feedback |
| 9 | Rollback (if needed) | Flip `RAG_RETRIEVAL_MODE=legacy` in Vercel (instant). Only then, optionally `--rollback-activation` | Legacy serving restored — rehearsed: env flip alone is sufficient and instant |

Order caution (rehearsed): **never** demote the active build while
`RAG_RETRIEVAL_MODE=versioned` — versioned mode fail-closes on a non-active
build. Env flip first, demotion second.

## Known accepted gaps

- One image (`1989-10-25-1`, image 0) has no R2 object (pre-existing, Phase
  5 registry); the build serves without its vector by design.
- `entities` / `article_entities` are orphaned legacy production tables with
  no code references: never dropped, never migrated, excluded from schema
  verification via the documented allowlist in `setup-eval-db.mjs`.

## Phase 9 (after ≥7 days of clean versioned serving)

Garbage collection of superseded artifacts runs ONLY after promotion is
verified stable and ONLY via the gated GC tool (dry-run by default). Legacy
retrieval code paths stay until a separately approved cleanup change.
