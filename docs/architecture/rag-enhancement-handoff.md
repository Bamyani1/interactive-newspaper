# RAG Enhancement — Implementation Handoff

Last verified: 2026-08-02

Implementation checkpoint: `6c40a6b` (Phase 2); Phases 3–5 completed in the
commits listed below

Branch: `rag-enhancement`

Status: Phases 0–6 complete and gated, and the Phase 7 tooling is implemented
and tested. Every remaining action requires an explicit user approval:
read-only production access (exact backfill figures), Neon evaluation
environment creation, the paid backfill, and then the pre-authorized $10
evaluation run itself.

## Read this first

The user intends to complete the full approved roadmap. Their latest explicit
direction is **not to disable or remove any current retrieval, reranking,
embedding, agent, or evaluation capability**. Earlier suggestions to reduce the
scope or switch to FTS-only were explanatory recommendations only and were
rejected. Preserve the current behavior and finish the remaining work in gated,
reviewable phases.

The implementation is in this Git worktree:

```text
/private/tmp/interactive-newspaper-rag-enhancement
```

The shared Git directory belongs to:

```text
/Users/bamyani/Desktop/Projects/interactive-newspaper-main/.git
```

Do **not** continue from `/Users/bamyani/Desktop/interactive-newspaper-main`.
That directory is not a Git repository. Before this documentation-only handoff,
the local `rag-enhancement` branch was four commits ahead of
`origin/rag-enhancement`; none of the RAG commits had been pushed.

Start by running:

```bash
cd /private/tmp/interactive-newspaper-rag-enhancement
git status --short --branch
git log --oneline 652f9fc..HEAD
npm run rag:verify-evaluation-freeze
```

The worktree was clean at the Phase 2 checkpoint. Preserve user changes and do
not reset, overwrite, or regenerate frozen artifacts in place.

## Authoritative roadmap and architecture

Read these documents before changing code:

1. [`rag-data-pipeline-final-plan.md`](rag-data-pipeline-final-plan.md) — the
   approved, phase-gated roadmap and authorization boundaries.
2. [`rag-pipeline.md`](rag-pipeline.md) — the current `/api/ask` runtime,
   retrieval modes, failure behavior, telemetry, and operator notes.
3. [`data-model.md`](data-model.md) — the legacy schema and current draft RAG
   schema.
4. This handoff — what was actually completed, verified, and left undone.

The OCR pipeline was finalized and merged before this branch in PR #49 at
`652f9fc`. RAG work must not alter OCR prompts, model routing, Document AI,
page-processing decisions, image detection, article merging, or OCR output
contracts.

## Locked configuration and user decisions

### Google runtime

| Concern | Locked value |
|---|---|
| Authentication | Application Default Credentials only |
| Authenticated identity | `anwari.works@gmail.com` |
| Vertex/quota project | `project-8e59f30d-8ed4-4166-a9d` |
| Vertex location | `global` |
| Google Gen AI API version | stable `v1` |
| All RAG generation calls | `gemini-3.5-flash-lite` |
| Reformulation thinking | `MINIMAL` |
| Reranking thinking | `MINIMAL` |
| Answer thinking | `MEDIUM` |
| Agent-loop thinking | `MEDIUM` |
| Text/image embedding | `gemini-embedding-2` |
| Document AI location | `us` |

`GOOGLE_API_KEY` and `GEMINI_API_KEY` are not authentication fallbacks. The ADC
preflight verified the identity, project, Vertex `global`/`v1`, required API
access, and the enabled Document AI processor without printing tokens or
secrets. Promotional-credit consumption has not been proven through billing
telemetry yet.

Current generation output limits are:

- reformulation: 350 tokens;
- reranking: 150 tokens;
- direct answer: 8,192 tokens;
- each agent generation/final synthesis: 4,096 tokens;
- agent research: at most three tool rounds, followed by a mandatory no-tools
  synthesis call.

No RAG call configures `temperature`, `topP`, or `topK`.

### Budget

- Online `/ask` daily guard: **$0.50**, unchanged.
- One evaluation run: hard aggregate ceiling of **$10**.
- The user explicitly accepted evaluation spend below $10.
- Evaluation spending is isolated from the online daily ledger.
- A full embedding backfill is not covered by the $10 evaluation approval. It
  still needs a written estimate and separate approval.

Cost accounting currently uses:

- Gemini 3.5 Flash-Lite: $0.30/M input and $2.50/M output;
- Gemini Embedding 2 text: $0.20/M input;
- Gemini Embedding 2 image: $0.00012/image;
- tool-use prompt tokens count as input;
- thought tokens count as output.

### Safety and scope

- Complete the remaining local implementation; do not disable existing paths.
- Default retrieval remains explicitly `legacy` until a validated build is
  intentionally selected. This is a safety selector, not permission to remove
  candidate retrieval.
- Table existence must never activate candidate retrieval.
- Do not mutate production Neon, R2, the live corpus, or active index state
  without explicit approval at the relevant gate.
- Do not deploy, delete, garbage-collect, expand the corpus, or run a full
  embedding backfill without the approvals required by the final plan.
- Keep ads and substantive `other_content` in storage, but exclude them from
  default RAG retrieval during this rollout.
- Do not retain raw prompts, model responses, or page-debug artifacts. Retain
  structured data, provenance, metrics, and metadata-only failure logs.
- Do not relabel existing preview or unknown vectors as stable vectors.
- Preserve the user's 70% successful-page publication threshold.

## Current `/ask` process

### Shared entry behavior

1. Validate and rate-limit the request, resolve/create a session, enforce the
   online or evaluation budget, and establish the global deadline.
2. Return a valid cache hit before any Google call when the request has no
   conversation context and evaluation mode is off.
3. Reformulate with Gemini 3.5 Flash-Lite. The structured result includes:
   embedding query, FTS query, text/visual mode, simple/complex routing, date
   filters, and `none`/`absence`/`count`/`exhaustive` coverage intent.
4. For coverage-sensitive questions only, query deterministic indexed-edition
   and searchable-article counts. Coverage describes scope; it is never source
   evidence.

### Simple questions

1. Run independent Postgres FTS and query-embedding/vector branches through
   the canonical retrieval service.
2. Use hybrid fusion when both succeed, FTS-only when vector/embedding fails,
   vector-only when FTS fails, and a typed error only if both fail.
3. In `shadow` mode, serve legacy results while measuring the named candidate
   build. Candidate failure cannot change the served answer.
4. Deduplicate at the article level and preserve the exact passages/images that
   earned rank.
5. Rerank with Gemini 3.5 Flash-Lite. If the first rerank removes every
   candidate, perform one CRAG retry: broader reformulation, fresh retrieval,
   and a lower-threshold rerank.
6. Generate or stream the grounded answer with Gemini 3.5 Flash-Lite.
7. Validate every citation, link, and image against retrieved evidence. Reject
   invented IDs/URLs; use stored captions and allow at most three registered
   images belonging to cited articles.
8. Apply deterministic coverage wording, persist a bounded revision-pinned
   citation snapshot when supported, and update the answer cache outside
   evaluation mode.

### Complex questions

1. Enter the constrained agent loop after reformulation/coverage resolution.
2. The agent may call `search_archive`, `read_article`, and `list_editions` for
   at most three tool rounds. All archive/tool/user text is explicitly treated
   as untrusted data.
3. All archive searches use the same canonical retrieval service and truthful
   method reporting as the simple path.
4. A final no-tools Gemini call synthesizes the answer only from gathered
   evidence.
5. The same citation/image grounding, coverage policy, and revision-pinned
   persistence rules apply.

## Git history produced by this work

The branch starts from main commit `652f9fc`, which includes the finalized OCR
pipeline. The RAG implementation commits are:

| Commit | Purpose |
|---|---|
| `ef2d2b5` | Preserve the original RAG-v2 draft before stabilization |
| `16af899` | Enforce ADC-only Google initialization and explicit legacy activation |
| `6d5f54c` | Freeze corpus/source inventory and blind holdout |
| `6c40a6b` | Harden retrieval, grounding, coverage, and provenance |
| `9063aec` | Phase 0–2 handoff documentation |
| `c292c71` | Prep fixes: test typechecking, silent script guards |
| `2bf0c6c` | Phase 3: canonical migrations and immutable identities |
| `2895111` | Phase 4: resumable versioned publisher |
| `071a10c` | Phase 5: asset registry and build-scoped embedding operations |
| `0438dc4` | Phase 6: session, feedback, and privacy hardening |
| (current) | Phase 7 tooling: eval environment setup, run/score harness, blind gate |

The branch had not been pushed at the implementation checkpoint; the user
explicitly chose not to push yet (Vercel preview-deploy risk while vector
coverage is zero). Confirm remote
state before relying on another machine or removing the temporary worktree.

## Work completed

### Phase 0 — Safe starting point

- Preserved the initial RAG-v2 draft in its own commit.
- Centralized RAG model and embedding identities.
- Removed the Node API-key compatibility path; API keys alone cannot initialize
  the Google client.
- Added a read-only ADC preflight in `scripts/google/verify-adc.ts`.
- Added explicit `legacy`, `shadow`, and `versioned` retrieval configuration.
- Defaulted safely to `legacy`; candidate modes require an immutable
  `RAG_ACTIVE_INDEX_BUILD_ID`.
- Added corpus/index/model/input-version identity to retrieval and cache keys.

### Phase 1 — Frozen source and evaluation truth

Created immutable, committed artifacts under `evaluation/rag/`:

| Artifact | Value |
|---|---|
| Corpus version | `legacy-8b8207373510d69e` |
| Active editions | 351 |
| Articles | 11,705 |
| Ads | 6,846 |
| Legacy image references | 2,876 |
| Source roots | 4,424 |
| Source records including child pages | 41,741 |
| Active manifests fetched | 351/351 |
| Holdout ID | `rag-holdout-v1` |
| Holdout questions | 14 |
| Holdout source editions | 10 |
| Holdout SHA-256 | `c96bf54a335aa00ef958fc13d10d818699b064e0f54eb912d402c9ed7c012f2c` |
| Holdout status | `frozen_unrun` |

Important measured findings:

- Stable `gemini-embedding-2` article-vector coverage is **0/11,705**.
- 9,582 article vectors are labeled `gemini-embedding-2-preview`.
- 2,123 article vectors have no embedding-model label.
- Runtime correctly refuses to compare a stable query vector with those
  incompatible document vectors. Do not bypass or relabel this check.
- `page_count` matches the IIIF canvas count for 329 editions and undercounts
  22. Legacy `page_count` is derived from article source pages, so this alone
  does not prove that OCR pages failed.
- The source totals are records, not automatically publishable editions. The
  4,424 roots include 4,084 issue candidates and 340 ambiguous compound roots.

Added scripts and tests for corpus snapshotting, CONTENTdm inventory, freeze
report generation, and freeze validation. The broad credential-oriented JSON
ignore rule now has a narrow exception for `evaluation/rag/**/*.json`. The
committed evaluation JSON was scanned for API keys and common credential fields;
none were found.

Evaluation mode now:

- requires an explicit run ID and frozen corpus version;
- rejects a cap above $10;
- bypasses retrieval and answer caches;
- keeps conversation turns process-local and TTL-bound;
- returns feedback acceptance without a database write;
- keeps evaluation spend out of the online Neon ledger;
- reserves worst-case Google-call cost before dispatch so concurrent calls
  cannot race past the cap.

### Phase 2 — Retrieval and grounding correctness

Implemented one canonical retrieval service used by the route, agent tools, and
CRAG retry. Key changes:

- FTS and embedding/vector retrieval begin independently and degrade truthfully.
- `shadow` mode always serves legacy results and isolates candidate failures.
- `versioned` and `shadow` validate the exact `rag_index_builds` identity,
  state, corpus, pipeline, embedding model, and input versions.
- Build readiness uses a 30-second TTL instead of being cached forever.
- Versioned SQL ranks evidence within each article, retains the best bounded
  passages/images, deduplicates to articles before the final limit, and avoids
  one article appearing once per chunk.
- Visual lexical search now ranks `article_images.caption`.
- Exact matched passages and the image responsible for a rank are preserved.
- Fusion reports actual FTS/vector participation and fallback method.
- Positive answers do not lose confidence merely because unrelated editions
  are outside scope.
- Absence answers state that no matching evidence was found in the indexed
  corpus; they do not claim historical absence.
- Count/exhaustive questions receive deterministic coverage metadata and scope
  wording.
- Model-produced citation IDs, dates, Markdown links, bare URLs, and image URLs
  are allowlisted against retrieved evidence.
- Images require a cited owner article, use the stored caption, and are capped
  at three.
- Prompts explicitly treat user text, history, article text, and tool results as
  untrusted instructions.
- Legacy retrieval computes a deterministic content revision hash.
- Conversation turns may store bounded citation snapshots: at most 2,000
  evidence characters and 10 images per source snapshot.
- Session hydration prefers the stored revision-pinned snapshot and falls back
  to the current article row only for legacy turns without snapshots.
- `migrate-ask-sessions.mjs` contains an expand-only draft addition for the
  `citation_snapshots` JSONB column. It has not been run in production.

### Phase 3 — Canonical migrations and immutable identities

- Canonical migration directory `scripts/db/migrations/0001–0009` with a
  `schema_migrations` ledger, checksum-immutable applied migrations, and a
  transaction-scoped advisory lock; a concurrent runner's duplicate ledger
  INSERT rolls back its entire batch (DDL included), which closes the
  apply race over Neon's non-interactive HTTP transactions.
- Runner (`scripts/db/lib/migration-runner.ts`) is executor-injectable:
  production uses the Neon HTTP driver (`neon-executor.ts`); tests use PGlite
  (`@electric-sql/pglite` + `pglite-pgvector`, dev-only — HNSW, plpgsql
  triggers, tsvector, and advisory locks all verified in-process).
- Resolved the chunk/image shape divergence expand-only: `index_build_id` is
  now nullable with partial unique indexes (legacy rows `WHERE NULL`,
  build-scoped rows `WHERE NOT NULL`); migration `0005` converges the
  production-absent, rag-v2, and branch-draft variants to one shape without
  dropping any row or vector. Old `scripts/db/schema.sql` is frozen as the
  upgrade fixture `tests/db/fixtures/legacy-draft-schema.sql`.
- Expand-only identity/publication tables: `source_records`, `issues`,
  `legacy_edition_aliases`, `edition_revisions`, `edition_revision_pages`,
  `content_items`, `content_revisions` (immutability trigger),
  `legacy_content_aliases`, `content_identity_conflicts`, `assets`,
  `asset_references`, `publication_runs`, `publication_run_events`,
  `corpus_versions`.
- `seed.mjs` is data-only: it refuses unmigrated databases and its `--reset`
  is a TRUNCATE that preserves runtime/privacy tables (sessions, feedback,
  spend, rate buckets) unless `--include-runtime` is passed. The ledger is
  never touched. `migrate-rag-v2.mjs` became DML-only
  `backfill-rag-records.mjs`.
- Stable identity module `src/server/identity/content-identity.ts`: identity
  keys from source pages + headline/byline (never positional index or body
  text), revision hashes from normalized content, typed
  `AmbiguousIdentityMatchError` for re-OCR ambiguity (Phase 4 persists these
  to `content_identity_conflicts` and stops). `backfill-identities.mjs` maps
  every legacy article ID to issues/items/revisions/aliases idempotently
  (articles only; ad aliases deferred to Phase 4 by user decision);
  `register-corpus-version.mjs` registers the frozen corpus row. Both are
  local-only in this phase and guarded accordingly.
- Compatibility: zero runtime SQL changes; a test proves revision-backed
  hydration deep-equals the legacy article read.
- New commands: `npm run db:migrate`, `db:migrate:status`,
  `db:schema:snapshot` (regenerates the committed
  `scripts/db/schema-snapshot.json`), `db:backfill:rag-records`.

Phase 3 verification: 40 new tests in `tests/db/` (migration runner, splitter,
fresh-vs-upgraded snapshot equality across all three legacy shapes with
row/vector survival, seed data-only enforcement with a drop-list drift guard,
identity/immutability/alias/compat). Full gate: 874 tests passed with 12
live/paid golden tests skipped, ESLint clean, app and test typechecks clean,
production build passed, evaluation-freeze verification passed,
`git diff --check` clean. Production Neon/R2 untouched.

### Phase 4 — Resumable versioned publisher

- `src/server/publisher/state-machine.ts`: publication pipeline
  `discovered → acquired → ocr_candidate → assets_staged →
  db_revision_staged → validated → active` (plus `failed`/`rolled_back`) over
  `publication_runs`/`publication_run_events`. Every transition is one
  CTE-chained statement inside one non-interactive transaction, so the state
  change, its event row, and (for activation) the issue pointer are
  all-or-nothing; mutators re-read after the batch and fail closed on guard
  misses. `activateRevision` switches `issues.active_edition_revision_id`
  atomically; `rollbackActiveRevision` switches it back.
- `src/server/publisher/revision-writer.ts`: stages an edition.json into
  immutable revisions, preserving expected/processed/failed page lineage,
  fragment/continuation evidence, and articles, ads, and substantive
  `other_content` as distinct content types (retrieval policy — not the
  writer — keeps ads/other out of default RAG). Idempotent re-staging on
  `(issue_id, revision_hash)`; ambiguous re-OCR matches persist to
  `content_identity_conflicts` and abort atomically. Ad legacy aliases
  (`ad:<date>:<position>`, deferred from Phase 3) are minted here. Asset
  rows/references come from asset-manifest v2 and are stored by ID, never
  reconstructed from filenames.
- `src/server/publisher/validate-revision.ts`: read-only pre-activation
  checks (page lineage, non-empty content, active-revision pointers, alias
  revision pins, asset existence); embedding readiness truthfully reports
  not-applicable until a Phase 5 index build exists.
- `src/server/publisher/acquire.ts`: atomic `.part`-then-rename source
  acquisition that validates bytes, dimensions, MIME magic, and SHA-256 even
  when the destination already exists.
- `scripts/db/publish-edition.mjs` (`npm run db:publish-edition`):
  stage/validate/activate/rollback/resume; requires `DATABASE_URL` plus
  `--yes` and is authorized for local/test databases only in this phase.
- `src/lib/image-url.ts`: content-addressed fork — a bare 64-hex `.webp`
  filename resolves to `ocr-assets/<sha256>.webp`; every legacy filename
  keeps `<date>/images/<name>.webp`. All 2,876 current production URLs are
  legacy-shaped, so behavior for existing data is unchanged.
- `scripts/db/upload-images.mjs`: asset-manifest schema v2 (adds per-asset
  `source_sha256` and `mime_type`; optimization/upload logic untouched).
- The OCR pipeline (`ocr/`, `scripts/ocr/process-edition.sh`) was not
  modified; the planned optional staging hook was deliberately skipped to
  keep the locked pipeline untouched — the CLI is invoked manually instead.

### Phase 6 — Session, feedback, and privacy hardening

- Session tokens are 256-bit `crypto.randomBytes(32)` base64url values (43
  chars, still matching the client-facing `^[A-Za-z0-9_-]{1,128}$` contract —
  no client change). The conversation store hashes tokens with SHA-256 at its
  SQL boundary; plaintext tokens never reach the database, proven by a
  capture test asserting no SQL parameter ever equals the raw token.
  Pre-cutover plaintext rows stop matching and age out via the 30-minute
  window plus the retention sweep.
- `DELETE /api/ask/session` reports real database failures (500 with an
  error body) instead of returning 204 unconditionally;
  `deleteConversationTurns` returns a truthful `{ ok, error? }` result.
- Feedback citations accept an optional validated `contentRevisionId`
  (string, ≤200 chars, strict charset) persisted inside the existing
  citations JSONB — no schema change.
- `src/lib/retention.ts` — `runRetentionSweep` deletes expired session turns
  (30 min), feedback rows (90 days, `FEEDBACK_RETENTION_DAYS` override), and
  expired rate-bucket rows using injected clocks (never the DB clock).
  Exposed three ways: `/api/internal/retention` (GET+POST, timing-safe
  `CRON_SECRET` bearer auth), a new `vercel.json` cron at 04:17 UTC daily
  (pure config — inert until the Phase 8 deploy), and the operator script
  `npm run db:retention-sweep` (env-guarded, migration preflight).
- `scripts/rag/export-public-corpus.ts` (`npm run rag:export-public-corpus`)
  — the Phase 7 isolation proof. Exports exactly
  `editions/articles/ads/weather/music` as deterministic JSONL plus a
  self-hashed manifest that affirmatively lists the excluded private tables
  (`ask_session_turns`, `ask_feedback`, `api_rate_bucket`,
  `ai_spend_counter`, plus the ledger) with reasons; the importer verifies
  the manifest self-hash, every file hash, and row counts before its first
  INSERT, and refuses unknown tables. `articles.search_vector` is excluded
  and regenerated by trigger on import; schema provenance comes from on-disk
  migration checksums, never from reading private tables.

Phase 6 verification: new and extended tests (token format and
no-plaintext-in-SQL capture, delete failure propagation, feedback revision
pins, retention sweeps with injected clocks incl. boundary and idempotency
cases, cron-route auth matrix, exporter manifest/determinism/tamper/
round-trip/hard-fail; 28 net-new). Full gate: 983 tests passed with 12 live/paid golden
tests skipped, ESLint clean, app and test typechecks clean, production build
passed, evaluation-freeze verification passed, `git diff --check` clean.
Production untouched.

### Phase 7 tooling — isolated rehearsal harness (no external resource touched)

- `scripts/rag/setup-eval-db.mjs` (`npm run rag:setup-eval-db`): bootstraps
  the isolated evaluation database from `EVAL_DATABASE_URL` only, with a
  belt-and-braces production-URL refusal (host/db comparison against every
  `*DATABASE_URL*` env value plus an `eval`-name requirement). Applies
  canonical migrations, deep-verifies the live schema against the committed
  snapshot, imports the allowlist-only public corpus export (manifest and
  per-file hashes verified before any write), registers the frozen corpus
  version, runs the identity backfill, and verifies row counts against the
  frozen corpus manifest.
- `scripts/rag/run-eval.ts` / `score-eval.ts` / `lib/eval-records.ts`:
  in-process route driver with injectable transport; per-question records
  with per-stage capture (gaps in the response envelope are recorded as
  unavailable, never invented); cost accumulation aborts at the ledger cap;
  self-hashed run files plus a frozen-candidate receipt
  (order-independent answers hash). Scoring computes recall@3/@8, MRR,
  nDCG@8, evidence-group recall, citation precision/recall, claim support,
  visual accuracy, no-answer calibration, injection resistance, per-stage
  latency percentiles, tokens, fallback rate, and cost/question;
  `lockAcceptanceBands` locks non-inferiority bands from the development
  baseline only.
- Blindness is mechanized, not procedural: `verify-evaluation-freeze.ts`
  gained `assertHoldoutScoringAllowed` (`--check-holdout-gate`) — holdout
  runs and holdout scoring both refuse unless committed acceptance bands
  exist and the frozen-candidate receipt matches the run file's answers
  hash. The runner strips holdout questions to id/question/turn/dependsOn;
  a static test asserts the runner source never references the evidence
  fields. Existing freeze verification is byte-compatible and still passes.

Phase 7 tooling verification: 54 new tests (eval-DB bootstrap incl.
production-URL matrix, count/schema divergence; hand-computed metric
expectations; band lock/compare matrices; the holdout-gate refusal matrix
and lexical blindness proof). Full gate: 1,037 tests passed with 12
live/paid golden tests skipped, ESLint clean, app and test typechecks clean,
production build passed, evaluation-freeze verification passed,
`git diff --check` clean. No external resource was touched.

### Phase 5 — Asset registry and build-scoped embedding operations

- `scripts/db/build-rag-index.mjs` (`npm run rag:index:build`) — the first
  writer of `rag_index_builds` anywhere. Lifecycle: create (`building`) →
  populate build-scoped chunk/image rows (build-prefixed IDs;
  `content_revision_id` attached via legacy aliases) → resumable text/image
  embedding keyed by exact `(model, input version, input hash)` with
  per-item/per-batch failure isolation → finalize to `validated` only on
  full text coverage. Image gaps are recorded, never fatal, and never block
  text indexing. Images stream from R2 one at a time (both key layouts,
  10 MiB cap, magic-byte validation, per-iteration buffer release). No
  `--force` exists: a changed input, model, or version means a new immutable
  build.
- `scripts/db/embed.mjs` fenced to legacy rows only: requires
  `--legacy-unversioned`, every statement carries `index_build_id IS NULL`,
  and `--force` was removed (`db:embed:force` script deleted).
- `scripts/db/bootstrap-asset-registry.mjs` (`npm run assets:bootstrap`) —
  builds a deterministic, self-hashed registry artifact from database image
  references plus listings of BOTH R2 namespaces; reports matched/orphan/
  missing/unknown; artifacts are immutable; `--apply` (double-flag-guarded)
  writes `assets` rows for content-addressed objects only.
- `scripts/db/gc-r2-assets.mjs` reworked: refuses to run without a verified
  registry artifact (self-hash, non-empty references, no known-missing
  objects); protects the union of artifact and live database references
  across both namespaces; compare-and-swap guard on the grace ledger;
  `--apply` additionally requires `GC_APPROVAL_TOKEN`. GC still never runs
  before Phase 9.
- `docs/architecture/embedding-backfill-cost-estimate.md` — the written cost
  estimate (central ≈ $1.7 text-only / ≈ $2.2 with images per pass; worst
  case ≈ $7 across eval + production passes; exact figures pending the
  approval-gated read-only dry-run).
- No production Neon or R2 contact of any kind occurred in this phase.

Phase 5 verification: 36 new tests (build lifecycle, exact-hash no-op
resumption, failure isolation, image streaming with missing-object handling,
concurrent-build disjointness, legacy-row isolation, dry-run cost math pinned
to cost-tracker constants; registry parsing/pagination/join/immutability/
apply; GC refusal matrix, partial-world protection, CAS conflict). Full gate:
955 tests passed with 12 live/paid golden tests skipped, ESLint clean, app
and test typechecks clean, production build passed, evaluation-freeze
verification passed, `git diff --check` clean.

Phase 4 verification: 45 new tests (publisher state machine incl. crash/retry
at every boundary, illegal-transition and concurrent-guard cases, atomic
activation under injected failure, rollback with both revisions surviving;
revision-writer contract fixtures incl. the golden proof that staged revisions
hydrate byte-identically to the legacy adapter output, expand-only row-count
proof, idempotent re-stage, ambiguity atomicity; validation; acquisition;
image-URL fork). Full gate: 919 tests passed with 12 live/paid golden tests
skipped, ESLint clean, app and test typechecks clean, production build passed,
evaluation-freeze verification passed, `git diff --check` clean. Production
Neon/R2 untouched.

## Main implementation files

| Area | Files |
|---|---|
| Model/index identity | `src/lib/rag-model-config.ts`, `src/lib/rag-index-config.ts` |
| Google ADC client/preflight | `src/lib/gemini-client.ts`, `scripts/google/verify-adc.ts` |
| Canonical retrieval | `src/lib/retrieval.ts`, `src/lib/db.ts` |
| Reformulation and coverage | `src/lib/query-reformulator.ts`, `src/lib/rag-coverage.ts` |
| Rerank and answer | `src/lib/reranker.ts`, `src/lib/answer-generator.ts` |
| Agent path | `src/lib/agent-loop.ts`, `src/lib/agent-tools.ts` |
| Grounding | `src/lib/answer-grounding.ts` |
| Citation provenance | `src/lib/citation-snapshot.ts`, `src/lib/conversation-store.ts` |
| Evaluation/cost | `src/lib/rag-evaluation.ts`, `src/lib/cost-tracker.ts` |
| API orchestration | `src/app/api/ask/route.ts`, `src/app/api/ask/session/route.ts`, `src/app/api/ask/feedback/route.ts` |
| Canonical migrations | `scripts/db/migrations/`, `scripts/db/lib/migration-runner.ts`, `scripts/db/lib/neon-executor.ts`, `scripts/db/lib/sql-statements.ts`, `scripts/db/migrate.mjs`, `scripts/db/schema-snapshot.json` |
| Identity and backfills | `src/server/identity/content-identity.ts`, `src/server/identity/ulid.ts`, `scripts/db/backfill-identities.mjs`, `scripts/db/register-corpus-version.mjs` |
| Versioned publisher | `src/server/publisher/state-machine.ts`, `src/server/publisher/revision-writer.ts`, `src/server/publisher/validate-revision.ts`, `src/server/publisher/acquire.ts`, `scripts/db/publish-edition.mjs` |
| Data scripts | `scripts/db/seed.mjs`, `scripts/db/backfill-rag-records.mjs`, `scripts/db/embed.mjs` (legacy), `scripts/db/migrate-ask-sessions.mjs` (deprecated) |
| Isolated DB tests | `tests/db/` (PGlite harness, frozen legacy fixtures, runner/upgrade/seed/identity suites) |
| Frozen evidence | `evaluation/rag/` |

## Verification already completed

The Phase 2 gate passed with:

- 87 test files passed;
- 834 tests passed;
- 12 live/paid golden tests skipped by their explicit guard;
- ESLint passed with no warnings;
- TypeScript typecheck passed;
- production Next.js build passed and generated 364 pages;
- syntax checks passed for the session migration, RAG migration, and embedding
  scripts;
- evaluation-freeze verification passed;
- `git diff --check` passed.

Commands used:

```bash
npm run test:run
npm run lint
npm run typecheck
npm run build
node --check scripts/db/migrate-ask-sessions.mjs
node --check scripts/db/migrate-rag-v2.mjs
node --check scripts/db/embed.mjs
npm run rag:verify-evaluation-freeze
git diff --check
```

The skipped tests are live/paid tests, not unexplained failures. No paid blind
holdout run was performed.

## Production state: unchanged

As of this handoff:

- no production migration was applied;
- no production table or column was added;
- no RAG mode or active index was changed;
- no stable embedding backfill was run;
- no R2 object was uploaded, repaired, moved, or deleted;
- no edition was added, removed, reseeded, or re-OCRed;
- no application deployment occurred;
- no blind holdout comparison occurred;
- no post-Phase-2 browser smoke test occurred;
- promotional-credit billing attribution was not verified.

## Known boundaries and gotchas

1. **Production has still never been migrated.** The canonical migration
   system exists and its fresh/upgrade paths are proven on isolated PGlite
   databases, but `npm run db:migrate` has not been run against production
   Neon and must not be without the explicit Phase 8 approval.
2. The chunk-table shape divergence is resolved in the canonical migrations
   (0005 converges all three variants expand-only). The retired one-off
   `migrate-*.mjs` scripts remain only as production-history artifacts; do
   not use them for new work.
3. `citation_snapshots` is optional until its expand-only migration is applied.
   The conversation store probes for the column with a 30-second TTL and falls
   back to the legacy insert without dropping a turn.
4. There is no validated active versioned index build. `shadow` or `versioned`
   requires both explicit environment configuration and a matching validated
   database row.
5. Current stable vector coverage is zero. The vector path must stay implemented
   per user direction, but meaningful hybrid evaluation requires a correctly
   versioned backfill later. Do not silently mix preview vectors.
6. Keep the holdout blind. Tune only on the development questions. Freeze
   candidate outputs before using holdout evidence for scoring or diagnosis.
7. Do not regenerate an artifact under the same corpus, freeze, lineage, or
   holdout ID. A real correction requires an audit note and a new version/hash.
8. Search-source counts include compound records and child pages. Never describe
   41,741 records or 4,424 roots as missing newspaper editions.
9. The current source-page completeness problem cannot be fixed by changing
   legacy `page_count`; Phase 4 must preserve expected, processed, and failed
   page lineage separately.
10. The repository contains a large committed corpus snapshot. Most of the diff
    line count is frozen JSON, not application-code growth.

## Remaining work

The detailed acceptance criteria are in the final plan. The next agent should
complete these phases sequentially and make one reviewable commit per phase.

### Pending Phase 5 follow-ups (approval-gated)

- Run the read-only production SELECT + R2 LIST (registry bootstrap) and the
  read-only backfill dry-run to replace the bracketed cost estimate with
  exact figures. Requires explicit user approval for the production access.
- Audit the known missing live image against source evidence
  (`assets:bootstrap` reports it; repair remains a separately approved
  action).
- The paid backfill itself requires approval of the written estimate.

### Phase 6 follow-ups

- The retention cron in `vercel.json` and all hardened session/feedback
  behavior reach production only at the Phase 8 deploy; until then production
  keeps the previous behavior. `CRON_SECRET` must be provisioned at deploy
  time (Phase 8 checklist).
- At the deploy boundary, pre-cutover plaintext session rows stop matching
  (worst case: one-time loss of at most 30 minutes of follow-up context).

### Phase 7 — Isolated rehearsal and blind comparison

- Create a schema-only Neon evaluation environment containing only the frozen
  public corpus.
- Apply canonical migrations and build the candidate index.
- Establish acceptance bands on development data before revealing holdout
  results.
- Run the frozen holdout once, with the aggregate live evaluation capped below
  $10.
- Report retrieval, evidence, citation, visual, no-answer, injection, latency,
  token, fallback, and cost metrics.

### Phase 8 — Controlled rollout

- Deploy expand-only code while serving legacy retrieval.
- Build and validate the exact production candidate.
- Exercise `shadow`, then a bounded canary.
- Promote only the validated immutable build and retain rollback state.
- This phase requires explicit production/deployment approval.

### Phase 9 — Separately approved cleanup and expansion

- Remove obsolete schema/vectors only after dependency and rollback checks.
- Garbage-collect R2 only through authoritative references and a grace period.
- Resolve same-date supplement/issue behavior.
- Estimate and approve OCR/storage/embedding costs before bounded corpus
  expansion.
- Destructive cleanup and corpus expansion require separate explicit approval.

## Recommended continuation protocol

1. Confirm the correct worktree, branch, clean status, and freeze hash.
2. Read the final plan and this handoff completely.
3. Implement Phase 6 only; do not mix evaluation work into
   its commit. The Phase 5 read-only production access and paid backfill each
   still require their own explicit approvals before running; nothing in
   Phase 6 depends on them.
4. Run the smallest relevant tests while editing and the full gate before the
   phase commit.
5. Record actual results and newly discovered constraints in the final plan and
   this handoff; do not report planned work as completed.
6. Continue local phases sequentially, preserving a reviewable commit boundary
   for each.
7. Stop and obtain explicit approval before any production mutation, deploy,
   paid full backfill, deletion, or corpus expansion.
8. Do not inspect/tune against blind holdout evidence before candidate output is
   frozen.

The immediate next implementation task is Phase 6 (after the Phase 5 approval
gate), not disabling current RAG components and not running the blind holdout
prematurely.
