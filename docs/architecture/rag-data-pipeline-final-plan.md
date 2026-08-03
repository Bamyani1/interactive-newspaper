# RAG and Archive Data Pipeline — Final Implementation Plan

Status: **Phases 0–5 locally complete; the backfill cost estimate awaits its
separate approval before any paid embedding work (2026-08-02)**
Branch: `rag-enhancement`  
Starting commit: `652f9fc`  
Prepared: 2026-08-02

## Objective

Make archive retrieval, grounding, citations, database publication, and future
backfills reliable without changing the OCR extraction process or expanding the
live corpus during the RAG rollout.

This is one roadmap with three separately gated programs:

1. stabilize and evaluate RAG against the existing 351-edition corpus;
2. add versioned database, ingestion, and asset foundations;
3. classify and expand the wider CONTENTdm collection only after the first two
   programs are proven.

The programs share identities and provenance, but they must not be deployed as
one irreversible change.

## Locked decisions and guardrails

### Google runtime

- Use Application Default Credentials only. Do not use `GOOGLE_API_KEY` or
  `GEMINI_API_KEY` fallbacks.
- Authenticated local ADC identity: `anwari.works@gmail.com`.
- Vertex/quota project: `project-8e59f30d-8ed4-4166-a9d`.
- Vertex location: `global`; stable API version: `v1`.
- All RAG generation calls use `gemini-3.5-flash-lite`; no Gemini 3.6 RAG call.
- Keep `gemini-embedding-2` for text and image embeddings.
- Keep the already selected RAG thinking levels:
  - reformulation: `MINIMAL`;
  - reranking: `MINIMAL`;
  - answer generation: `MEDIUM`;
  - agent/tool loop: `MEDIUM`.
- Keep structured JSON responses and explicit output-token limits. Do not add
  `temperature`, `topP`, or `topK` overrides.
- The current online `/ask` daily guard remains $0.50. Offline evaluation and
  embedding backfill use separate ledgers and can never consume that guard.
- A live evaluation session has a hard $10 aggregate ceiling. This is a stop
  limit, not a spending target. A full embedding backfill requires its own cost
  estimate and separate approval.

### Scope

- The active 351-edition database corpus is the first rollout corpus.
- The verified source query returns **4,424 matching parent/root records** and
  **41,741 records including compound child pages**. Of the roots, 4,084 are
  classified as issue candidates and 340 remain ambiguous compound records.
  These are records, not automatically publishable editions. No backlog count
  will be described as missing editions until source classification is complete.
- Keep the existing 70% successful-page publication rule. An edition need not
  be complete, but its expected, processed, and failed pages must be explicit.
- Preserve ads and substantive `other_content` in the data model, but keep both
  out of default RAG retrieval during this rollout. Ad quality is not a release
  gate.
- Do not modify OCR prompts, Gemini OCR routing, Document AI behavior, image
  detection, merge behavior, or OCR output contracts.
- Do not store original scans in Neon or R2. Full-resolution source pages remain
  re-downloadable and ephemeral.
- Published visual assets remain non-upscaled WebP derivatives with a maximum
  2,000-pixel long edge and a target below 500 KiB. Store their source and
  derivative hashes and dimensions.
- Do not retain prompt/model snapshots or page-debug artifacts. Retain only
  structured archive records, durable provenance, asset metadata, metrics, and
  a metadata-only failure log.

### Production safety

- No production migration, activation, backfill, deployment, R2 deletion, or
  corpus expansion occurs without a later explicit approval.
- Table existence must never activate a retrieval implementation.
- New records and assets are immutable. Publication changes one active-revision
  pointer atomically; rollback changes that pointer back.
- Existing legacy IDs, database tables, vectors, and R2 paths remain readable
  throughout the rollout.
- No source claim is supported by coverage metadata alone. Positive claims
  require cited archive evidence. Absence answers must say that no evidence was
  found in the indexed corpus, not that an event was absent from the newspaper.

## Current checkpoint

The first RAG-v2 draft is preserved in commit `ef2d2b5`. Phase 0 safety changes
are preserved in commit `16af899`: explicit legacy activation, cache identity,
ADC-only initialization, and a read-only Google runtime preflight.

The draft is not production-ready because:

- `article_chunks` and `article_images` activate merely by existing;
- seed operations create/modify RAG-v2 schema;
- retrieval limits evidence rows before selecting the best rows per article;
- visual lexical search does not actually rank captions;
- an embedding failure prevents useful FTS-only degradation;
- date/index article IDs are not stable across re-OCR or reordering;
- citation hydration is not revision-pinned;
- the OCR-to-database adapter drops lineage and substantive content;
- content-addressed R2 uploads and the production URL resolver disagree;
- image backfill expects unavailable local originals and loads too much at once;
- migrations, publication, corpus activation, and rollback are not versioned;
- session tokens and durable cleanup need privacy hardening.

Verified checkpoint gates on 2026-08-02:

- `git diff --check`: pass;
- `npm run typecheck`: pass;
- full unit suite: 78 files passed, 770 tests passed, 12 live golden tests
  skipped by their explicit environment guard;
- production build: pass, 364 pages generated;
- ADC preflight: pass for `anwari.works@gmail.com`, Vertex `global`/`v1`, and
  the enabled `us` Document AI OCR processor; no API keys detected.

Phase 1 measured artifacts:

- corpus version: `legacy-8b8207373510d69e` (351 editions, 11,705 articles,
  6,846 ads, 2,876 legacy image references);
- source inventory: 4,424 matching roots, 41,741 matching records with child
  pages, 351/351 active manifests fetched, and no active-date collision;
- current stable-vector coverage: **0/11,705** articles. Stored vectors are
  labeled `gemini-embedding-2-preview` (9,582) or unlabeled (2,123), while
  runtime SQL requires `gemini-embedding-2`; current service therefore relies
  on lexical retrieval until a separately approved backfill;
- legacy `page_count` equals IIIF canvas count for 329 editions and undercounts
  22. This is not proof of failed OCR because legacy `page_count` is derived
  from article source pages and no processed/failed page ledger exists.

Phase 2 local implementation:

- explicit `legacy` / `shadow` / `versioned` routing with validated build
  identity and a 30-second readiness TTL;
- independent FTS and vector branches, truthful degradation, one canonical
  route/agent/CRAG retrieval service, and shadow isolation;
- article-local SQL evidence ranking, article deduplication before the limit,
  caption search, and exact passage/image preservation;
- citation/link/image allowlisting and explicit untrusted-data instructions;
- deterministic coverage semantics for absence, count, and exhaustive queries;
- legacy content-revision hashes plus bounded citation snapshots used by
  session hydration when the expand-only column is present.

Phase 2 gate results:

- full unit suite: 87 files passed, 834 tests passed, and 12 live/paid golden
  tests skipped by their explicit environment guard;
- lint, TypeScript typecheck, migration/embed script syntax, evaluation-freeze
  verification, and `git diff --check`: pass;
- production build: pass, 364 pages generated.

No production mode, schema, corpus, vector, or asset state has been changed.

## Implementation sequence

Every phase ends with a reviewable commit and a stop gate. A later phase may not
start until the preceding acceptance checks pass.

### Phase 0 — Freeze the starting point

1. Commit the existing uncommitted RAG draft as a clearly labeled checkpoint.
2. Record its commit, package lock, model configuration, schema hash, and test
   results.
3. Force retrieval to legacy mode by default. Neither a table probe nor an
   environment accident may enable the draft index.
4. Add a read-only ADC preflight that verifies Vertex mode, project, location,
   quota project, required APIs, and Document AI processor access without
   printing access tokens or secrets.
5. Remove the Node Gemini API-key compatibility path and test that an API key
   alone cannot initialize a client.

**Gate:** clean local checks, explicit legacy retrieval, and no billable call.

### Phase 1 — Freeze source truth and evaluation truth

#### Corpus snapshot

1. Build an immutable manifest of the active 351 editions and public archive
   rows, including counts and normalized content hashes.
2. Record edition dates, known source pointers, expected/processed/failed page
   counts where available, article/ad/image counts, active asset references,
   legacy vector coverage, and database schema version.
3. Assign a `corpus_version` to this exact snapshot. Every retrieval result,
   answer, metric, and cache key must carry it.

#### Source inventory

1. Read CONTENTdm metadata and manifests without downloading or OCR-processing
   the full backlog.
2. Classify records as issue parent, child page, supplement, duplicate,
   excluded/non-issue, or ambiguous.
3. Detect multiple issues or supplements sharing a publication date.
4. Write a machine-readable lineage catalog with source authority,
   transformation, field consumers, revision rule, retention, and privacy
   class.
5. Report coverage by year/decade and by state: discovered, acquired, OCR
   candidate, published, database-active, asset-complete, and RAG-indexed.

#### Evaluation set

1. Treat every question already used during development as development data.
2. Create a new scan/database-verified holdout whose evidence is frozen before
   testing the new retriever.
3. Cover exact names/dates/numbers, thematic search, multi-edition synthesis,
   visual questions, date filters, absence/exhaustive questions, multi-turn
   follow-ups, no-answer cases, and direct/indirect prompt injection.
4. Store evidence spans and acceptable evidence groups, not just expected prose.
5. Evaluation mode disables answer/retrieval caches and disables conversation
   and feedback writes.
6. Capture independently: reformulation, raw FTS, raw vector, fusion, rerank,
   cited evidence, answer claims, rendered citations/images, latency, tokens,
   retries, and cost.

**Gate:** immutable corpus and holdout hashes; no comparison run yet.

### Phase 2 — Fix retrieval and grounding on the legacy-compatible schema

1. Replace table-existence routing with explicit modes:
   - `legacy`: current production retrieval;
   - `shadow`: run the candidate retriever for metrics but serve legacy output;
   - `versioned`: use one validated active index build.
2. Add `rag_index_builds` with `building`, `validated`, `active`, `failed`, and
   `retired` states. Exactly one build may be active for a corpus.
3. Include `corpus_version`, `index_build_id`, pipeline version, embedding model,
   and embedding-input version in retrieval telemetry and cache keys. Do not
   cache readiness indefinitely.
4. Correct SQL ranking:
   - rank evidence rows within each article;
   - retain the best bounded passages/images per article;
   - deduplicate to articles before applying the final article limit;
   - emit an article-level FTS match only once instead of once per chunk;
   - lexical visual search ranks `article_images.caption` evidence;
   - preserve the exact matched passages and image that earned the rank.
5. Make lexical and vector retrieval independent:
   - hybrid when both succeed;
   - FTS-only when embedding/vector search fails;
   - vector-only when FTS fails;
   - typed failure only when neither signal succeeds.
6. Consolidate route and agent search behind one retrieval service. Log the
   truthful method, candidates per signal, deduplication, fusion, rerank, and
   fallback path.
7. Validate all citations against the retrieved evidence set. Reject invented
   IDs, dates, links, and source metadata.
8. Allow generated image Markdown only for a cited, registered image belonging
   to retrieved evidence. Never accept an arbitrary model-produced URL.
9. Supply deterministic corpus/date coverage metadata for absence, count, and
   exhaustive questions. Do not reduce confidence for a supported positive
   claim merely because unrelated editions are absent.
10. Pin citation hydration to a content revision and retain a minimal citation
    snapshot so a later re-OCR cannot rewrite an earlier answer's evidence.

**Gate:** unit/integration tests for exact routing, SQL deduplication, caption
search, each degradation path, cache isolation, citation/image allowlisting,
coverage wording, and injection resistance. No production activation.

### Phase 3 — Add expand-only identities, revisions, and migrations

1. Introduce a canonical migration directory, `schema_migrations` ledger, and a
   transaction-scoped advisory migration lock. Ordinary seed commands must not
   execute DDL.
2. Add expand-only tables alongside the legacy schema:
   - `source_records` for immutable external IDs such as
     `contentdm:p15963coll9:<pointer>`;
   - `issues` for stable internal issue identity independent of date;
   - `edition_revisions` and issue-page lineage;
   - `content_items` and immutable `content_revisions`;
   - `legacy_content_aliases` for every current date/index ID;
   - `assets` and `asset_references`;
   - `publication_runs` and publication state transitions;
   - `corpus_versions` and `rag_index_builds`;
   - versioned text chunks and visual evidence keyed to both
     `content_revision_id` and `index_build_id`.
3. Stable content identity is assigned from source page/region lineage plus
   headline/byline evidence. A normalized text hash identifies a revision, not
   the permanent item. Ambiguous re-OCR matches stop for review.
4. Put all runtime tables—including sessions, feedback, rate/spend data, and
   indexes—under canonical migrations. Generate a fresh-schema snapshot from
   migrations and verify it against an upgraded schema.
5. Preserve the existing API response shapes through compatibility queries or
   views while internal reads move to active revisions.

**Gate:** fresh-schema and upgrade tests pass on isolated databases; migrations
are idempotent, locked, reversible where possible, and do not activate data.

**Phase 3 actuals (2026-08-02):** implemented as designed, entirely local.
Canonical migrations `scripts/db/migrations/0001–0009` with a
`schema_migrations` ledger, transaction-scoped `pg_advisory_xact_lock`, and
checksum-immutable applied migrations (a concurrent runner's duplicate ledger
INSERT rolls back its whole batch, closing the race over Neon's non-interactive
HTTP transactions). The chunk/image draft divergence was converged expand-only:
`index_build_id` is nullable, uniqueness moved to partial indexes (legacy rows
`WHERE NULL`, build-scoped `WHERE NOT NULL`), and existing rows/vectors survive
upgrade from all three legacy shapes. `seed.mjs` is data-only (migration
preflight; TRUNCATE-based reset preserving runtime/privacy tables unless
`--include-runtime`); `migrate-rag-v2.mjs` became DML-only
`backfill-rag-records.mjs`. Stable identity lives in
`src/server/identity/content-identity.ts` (source-page/headline/byline identity
keys, immutable revision hashes, typed ambiguity errors backed by
`content_identity_conflicts`); `backfill-identities.mjs` and
`register-corpus-version.mjs` are idempotent local-only data scripts. Isolated
tests run on PGlite (dev-dependency; pgvector HNSW verified): 40 tests across
four `tests/db/` files, including fresh-vs-upgraded schema-snapshot equality
against frozen production-shape, rag-v2-shape, and branch-draft fixtures.
Gate: 874 tests passed / 12 live-golden skipped, lint, typecheck (app + tests),
production build, evaluation-freeze verification, and `git diff --check` all
pass. Production Neon was not touched; ad aliases were deferred to Phase 4 by
user decision.

### Phase 4 — Build a resumable, versioned publisher

Publication is a state machine, not a transaction across Google, filesystem,
R2, and Neon:

`discovered → acquired → OCR candidate → assets staged → DB revision staged → validated → active`

1. Acquire source pages with atomic downloads and validate bytes, dimensions,
   MIME type, and SHA-256 even when a destination file already exists.
2. Run the unchanged OCR pipeline into an immutable candidate revision.
3. Preserve through the adapter:
   - expected manifest canvases;
   - processed and failed page sets plus reasons;
   - every source page for each item;
   - fragment and continuation lineage;
   - image page, position, printed caption, credit, and attachment;
   - articles, ads, and substantive `other_content` as distinct types.
4. Compute edition page count from expected manifest pages, not only article
   source pages. Keep the 70% publication threshold and expose incompleteness.
5. Preserve all substantive content in revisions. Retrieval policy—not the
   ingestion adapter—decides which types or short records are indexed.
6. Stage immutable optimized assets under `ocr-assets/<sha256>.webp` and record
   source/derivative hashes, byte counts, dimensions, MIME type, and references.
7. Fix URL compatibility immediately:
   - content-addressed image references resolve to
     `ocr-assets/<sha256>.webp`;
   - legacy filenames retain `<date>/images/<filename>.webp` resolution.
8. Store asset IDs in new revision rows instead of reconstructing object keys
   from filenames.
9. Validate counts, foreign keys, legacy aliases, page lineage, provenance,
   content hashes, asset existence, and embedding readiness.
10. Activate only by atomically switching the issue's active revision and
    incrementing corpus version. Resume is idempotent; rollback switches the
    pointer back.
11. Delete ephemeral source pages and staging work only after successful
    validation/activation. Failed runs retain only the required metadata and
    failure reason, not raw model/debug artifacts.

**Gate:** crash/retry tests at every state boundary prove no partial revision or
asset becomes active and pointer rollback restores the prior corpus.

**Phase 4 actuals (2026-08-02):** implemented as designed, entirely local; the
OCR pipeline was not modified. `src/server/publisher/` provides the state
machine over `publication_runs` (CTE-guarded transitions so state, event, and
pointer writes are all-or-nothing within one non-interactive transaction;
atomic `activateRevision`/`rollbackActiveRevision` pointer switches), the
revision writer (immutable edition/content revisions for articles, ads, and
substantive `other_content`; page lineage with expected/processed/failed
status; asset rows from manifest v2; idempotent re-staging keyed by
`(issue_id, revision_hash)`; ambiguity persists to
`content_identity_conflicts` and stops atomically), read-only pre-activation
validation (page lineage, content pointers, alias pins, asset existence;
embedding readiness truthfully reported as not-applicable until an index build
exists), and atomic source acquisition with re-validation of existing files.
`npm run db:publish-edition` drives stage/validate/activate/rollback/resume
and is guarded to local/test databases. `src/lib/image-url.ts` now resolves
64-hex content-addressed filenames to `ocr-assets/<sha256>.webp` while every
legacy filename keeps its `<date>/images/` resolution (all 2,876 production
URLs are legacy-shaped; the fork is forward-looking). `upload-images.mjs`
emits asset-manifest schema v2 with per-asset source/derivative hashes and
MIME type. Ad aliases (`ad:<date>:<position>`) landed here as deferred from
Phase 3. Crash/retry is proven at every state boundary, activation is proven
atomic under injected failure, and a golden test proves freshly staged
revisions hydrate byte-identically to the legacy adapter output. Gate: 919
tests passed / 12 live-golden skipped (45 new), lint, app+test typechecks,
production build, evaluation-freeze verification, and `git diff --check` all
pass. Production Neon/R2 untouched.

### Phase 5 — Repair asset and embedding operations safely

1. Bootstrap the asset registry from current database references and both
   legacy and content-addressed R2 namespaces.
2. Audit the known missing live image against the correct source before repair.
   Do not delete its reference merely to make validation green.
3. Rewrite image backfill to stream one bounded R2 WebP object at a time,
   validate MIME/bytes/dimensions, optionally create an in-memory embedding
   derivative, hash the exact model input, and release memory immediately.
4. A missing or invalid image records a per-item failure and does not abort text
   chunk indexing.
5. Text and image backfills are resumable by input/model/version hash and emit
   planned, completed, skipped, failed, token, image, and cost counts.
6. Do not run R2 garbage collection yet. After active revision references are
   authoritative, mark candidates and apply a 30-day grace period. Never delete
   an object referenced by an active or rollback-retained revision.

**Gate:** bounded-memory tests, corrupt/missing-object tests, exact hash
resumption, zero broken active asset references, and an approved backfill cost.

**Phase 5 actuals (2026-08-02):** implemented entirely local; no production
Neon or R2 contact of any kind (the read-only registry scan and dry-run that
produce exact figures are approval-gated and have not run).
`scripts/db/build-rag-index.mjs` (`npm run rag:index:build`) is the first
writer of `rag_index_builds` anywhere: create (`building`) → populate
build-scoped chunk/image rows (ids prefixed by build; `content_revision_id`
attached via legacy aliases) → resumable text/image embedding keyed by exact
`(model, input version, input hash)` with per-item failure isolation →
finalize to `validated` only on full text coverage (image gaps are recorded,
never fatal, never blocking). Images stream from R2 one at a time (both key
layouts, 10 MiB cap, magic-byte validation, per-iteration buffer release).
There is no `--force`: a changed input means a new immutable build.
`embed.mjs` is fenced to legacy rows only (`--legacy-unversioned` required;
`index_build_id IS NULL` on every statement; `--force` removed).
`bootstrap-asset-registry.mjs` (`npm run assets:bootstrap`) builds a
deterministic, self-hashed registry artifact from database references plus
both R2 namespaces (matched/orphan/missing/unknown reported; artifacts are
immutable; `--apply` writes `assets` rows for content-addressed objects only
and is double-flag-guarded). `gc-r2-assets.mjs` now refuses to run without a
verified registry artifact, protects the union of artifact and live database
references across BOTH namespaces, guards its grace ledger with a
compare-and-swap, and requires an approval token even for `--apply` — GC
still never runs before Phase 9. The written cost estimate is
`docs/architecture/embedding-backfill-cost-estimate.md` (central ≈ $1.7
text-only / ≈ $2.2 with images per pass; worst case ≈ $7 across eval +
production passes; exact figures pending the approved dry-run). 36 new tests
(build lifecycle, exact-hash no-op resumption, failure isolation, streaming,
concurrent-build disjointness, legacy-row isolation, dry-run cost math pinned
to cost-tracker constants; registry parse/join/pagination/immutability/apply;
GC refusal matrix, partial-world protection, CAS conflict). Gate: 955 tests
passed / 12 live-golden skipped, lint, app+test typechecks, production build,
evaluation-freeze verification, and `git diff --check` all pass.

### Phase 6 — Harden sessions, feedback, and evaluation privacy

1. Replace `Math.random()` session IDs with cryptographically random tokens and
   store only token hashes server-side.
2. Keep conversation context active for 30 minutes and add scheduled deletion;
   cleanup must not depend on a future user write.
3. Make the session DELETE endpoint report a real failure instead of returning
   success after a failed database delete.
4. Store cited `content_revision_id` values and minimal citation snapshots in
   turns and feedback.
5. Apply a proposed 90-day feedback retention policy, configurable by
   environment and enforced by scheduled deletion.
6. Never copy conversation, feedback, rate-limit, IP-derived, or spend rows into
   an evaluation database.

**Gate:** token-entropy/hash tests, deletion/TTL tests, revision-hydration tests,
and a staging export manifest proving only approved public tables were copied.

### Phase 7 — Rehearse and compare in isolation

1. Create a Neon schema-only evaluation branch/database and load only the
   frozen public corpus export. Do not use a full data branch containing private
   runtime tables.
2. Apply canonical migrations and import the frozen corpus.
3. Stage a versioned text index first. Stage image embeddings only after the
   asset probe and a written cost estimate.
4. Force legacy FTS and candidate hybrid retrieval over the identical
   `corpus_version`; do not compare systems using different archive coverage.
5. Tune weights/configuration only on the development set.
6. Lock quality, latency, and cost acceptance bands from the measured legacy
   baseline before revealing candidate holdout results.
7. Run the frozen holdout once for retrieval and repeated generation runs only
   where stochasticity must be measured.
8. Report recall@K, MRR/nDCG, evidence-group recall, citation precision/recall,
   claim support, visual attachment accuracy, no-answer calibration, injection
   resistance, latency by stage, token use, fallback rate, and cost/question.
9. Hard safety requirements are zero fabricated citation IDs, zero unregistered
   image/link output, and zero successful instruction-injection behavior.

**Gate:** candidate is non-inferior on the locked holdout acceptance bands,
passes all hard safety requirements, and stays below the $10 evaluation ceiling.

### Phase 8 — Controlled rollout

1. Deploy expand-only code with `legacy` retrieval still active.
2. Build the production candidate index in `building` state and validate its
   corpus, row, embedding, and asset completeness.
3. Run `shadow` mode first, then a small explicit canary by index version.
4. Monitor corpus/index versions, actual FTS/vector participation, fallbacks,
   citations, asset failures, coverage wording, latency, tokens, and cost.
5. Promote the exact validated build by one atomic active-index change.
6. Retain old index/vectors/assets for at least 30 days. Roll back by switching
   the active index and corpus pointer; no reverse backfill is required.

**Gate:** explicit user approval for production activation, followed by a
documented observation period and rollback drill.

### Phase 9 — Separately approved cleanup and corpus expansion

Only after the RAG rollout is stable:

1. Remove obsolete vectors/tables/static duplicates through separately reviewed
   migrations after dependency checks.
2. Garbage-collect unreferenced R2 objects only through the asset registry and
   grace-period rules.
3. Decide how same-date supplements/multiple issues appear in the UI based on
   classified source evidence.
4. Estimate acquisition, OCR, asset, embedding, and storage cost per classified
   issue; sample quality before authorizing a batch.
5. Expand coverage in bounded, resumable batches. Each activated edition creates
   a new corpus version and cannot silently overwrite a date collision.

## Verification matrix

Each implementation phase runs the smallest relevant checks immediately and the
full gate before handoff:

- formatting and `git diff --check`;
- TypeScript typecheck, ESLint, unit/integration tests, and production build;
- fresh-schema, upgrade, migration-lock, idempotency, and rollback tests;
- SQL fixtures for article-level deduplication, caption search, signal failure,
  corpus/index isolation, and partial embedding coverage;
- contract tests for stable IDs, aliases, page lineage, all source pages,
  content types, assets, and unchanged external API shapes;
- evaluation fixtures for citations, coverage semantics, visuals, multi-turn,
  no-answer behavior, and prompt injection;
- browser `/ask` tests for normal, filtered, agent/tool, visual, follow-up,
  streaming, fallback, source-reader, and citation/image behavior;
- live ADC smoke only after local gates and billing-credit verification;
- no production mutation unless the phase explicitly states it and the user has
  approved that boundary.

## Deliverables

1. versioned migrations and schema snapshot;
2. source inventory and lineage catalog;
3. immutable corpus and evaluation manifests;
4. canonical retrieval service and corrected SQL;
5. explicit index-build activation and telemetry;
6. stable issue/content/revision identities and legacy aliases;
7. resumable publisher, asset registry, and bounded backfill tools;
8. privacy/retention migrations and cleanup jobs;
9. machine-readable A/B results plus a concise quality/cost report;
10. rollout, monitoring, rollback, and later-expansion runbooks.

## Approval boundary

Approval of this plan authorizes local code, test, documentation, and isolated
schema-only evaluation work. It does **not** authorize production database/R2
mutation, a paid full embedding backfill, deployment, deletion, or corpus
expansion. Each of those remains a separate explicit approval.

## Operational references

- [Neon branching and schema-only test environments](https://neon.com/docs/guides/branching-intro)
- [Neon serverless driver and non-interactive transactions](https://neon.com/docs/serverless/serverless-driver)
