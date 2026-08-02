# RAG Enhancement — Implementation Handoff

Last verified: 2026-08-02

Implementation checkpoint: `6c40a6b`

Branch: `rag-enhancement`

Status: Phases 0–2 complete and gated; Phase 3 is next

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

The branch had not been pushed at the implementation checkpoint. Confirm remote
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
| Draft schema/scripts | `scripts/db/schema.sql`, `scripts/db/migrate-rag-v2.mjs`, `scripts/db/migrate-ask-sessions.mjs`, `scripts/db/embed.mjs` |
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

1. **Do not run the current draft RAG migration against production.** Phase 3
   must introduce the canonical migration directory, migration ledger,
   advisory lock, fresh-schema tests, and upgrade tests first.
2. `CREATE TABLE IF NOT EXISTS` does not upgrade an older draft table missing
   newer columns. Runtime candidate activation therefore validates and fails
   closed; Phase 3 must own the real upgrade path.
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

### Phase 3 — Canonical migrations and immutable identities

- Add a canonical migration directory, `schema_migrations` ledger, and
  transaction-scoped advisory lock.
- Ensure seed commands perform data operations only and never DDL.
- Add expand-only source, issue, revision, content, alias, asset, publication,
  corpus, index-build, chunk, and visual-evidence tables.
- Establish stable issue/content identity and immutable revision identity.
- Preserve legacy API shapes through compatibility reads.
- Prove fresh-schema and legacy-upgrade paths in isolated databases.

### Phase 4 — Resumable versioned publisher

- Implement the publication state machine from discovery through atomic active
  revision selection.
- Keep the OCR pipeline unchanged.
- Preserve manifest canvases, processed/failed pages, continuation lineage,
  all content types, images, captions, credits, and source provenance.
- Stage validated content-addressed WebP derivatives and activate only after all
  checks pass.
- Add crash/retry and rollback tests at every boundary.

### Phase 5 — Asset and embedding operations

- Bootstrap the asset registry from current database and R2 references.
- Repair the known missing live image against source evidence.
- Implement bounded, streaming, resumable text/image backfills keyed by exact
  model-input hashes.
- Record failures per item without aborting unrelated text indexing.
- Write the cost estimate before any full embedding backfill.
- Do not run destructive R2 garbage collection.

### Phase 6 — Session, feedback, and privacy hardening

- Replace short random session IDs with cryptographically random client tokens
  and store only hashes server-side.
- Add scheduled expiry independent of future user writes.
- Make session deletion report real database failures.
- Persist revision IDs/snapshots with turns and feedback.
- Implement configurable feedback retention and exclude all private runtime
  tables from evaluation exports.

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
3. Implement Phase 3 only; do not mix publisher/backfill work into its commit.
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

The immediate next implementation task is Phase 3, not disabling current RAG
components and not running the blind holdout prematurely.
