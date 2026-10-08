# RAG Pipeline — Ask the Archive

This document describes the `/api/ask` pipeline and the versioned RAG-v2 index it retrieves from. That index was validated and then activated on 2026-08-03: production runs `RAG_RETRIEVAL_MODE=versioned` against one explicit build, and `legacy` is retained only as an escape hatch (see [Legacy cutover behavior](#legacy-cutover-behavior) for what it actually serves now). OCR is intentionally out of scope; see `ocr-pipeline.md` for that system.

## Core decisions

| Work                                          | Model                   | Thinking  | Output                   |
| --------------------------------------------- | ----------------------- | --------- | ------------------------ |
| Query reformulation and intent classification | `gemini-3.5-flash-lite` | `MINIMAL` | Structured JSON          |
| Candidate reranking                           | `gemini-3.8-flash`      | `LOW`     | Structured JSON          |
| Grounded answer generation                    | `gemini-3.8-flash`      | `LOW`     | Structured JSON          |
| Complex-question agent loop                   | `gemini-3.8-flash`      | `MEDIUM`  | Text plus function calls |
| Agent final write-up (no tools)               | `gemini-3.8-flash`      | `LOW`     | Text                     |
| Text and image embeddings                     | `gemini-embedding-2`    | N/A       | 768-dimensional vectors  |

Gemini runs only on Vertex AI (`src/lib/gemini-client.ts`). Local dev, the data pipeline, and the Vercel serving runtime (production and previews) all set `GOOGLE_CLOUD_PROJECT`, and clients use Vertex AI in `GOOGLE_CLOUD_LOCATION` (default `global`). Locally and offline, credentials come from ADC; Vercel has no ADC, so it supplies `GOOGLE_SERVICE_ACCOUNT_JSON` (key JSON, raw or base64), and a malformed value throws rather than falling back. Serving on Vertex also embeds queries on the endpoint that built the index. Without `GOOGLE_CLOUD_PROJECT` the client throws instead of using an API key: keys bill prepaid Gemini API credits, not the Cloud account, and production failed on 2026-09-09 when those ran out. Every client uses the stable `v1` endpoint. Gemini 3 requests omit `temperature`, `topP`, and `topK`. Reranking and answering deliberately run on the full Flash tier: the lite model consistently judged every candidate for broad survey questions as tangential (a total-veto that surfaced as false no-evidence refusals) and wrote weaker prose than the previously served `gemini-3-flash-preview`.

The model and thinking configuration lives in `src/lib/rag-model-config.ts`. `RAG_PIPELINE_VERSION` is part of the retrieval identity and must equal the active build's `pipeline_version`; bumping it without a new index build fails every versioned retrieval.

## Request flow

`POST /api/ask` supports JSON and Server-Sent Events (`?stream=1`). Both paths apply input validation, the daily cost guard, a 55-second global deadline, session history, and the same retrieval/ranking rules; rate limiting runs earlier, in `middleware.ts`. Only JSON dedups identical in-flight requests. The UI uses SSE; JSON serves the evaluation harness.

```text
question
  └─ reformulate + classify
       ├─ simple → independent FTS + vector retrieval → fuse → rerank → optional CRAG retry → answer
       ├─ complex → agent loop → canonical search/read/list tools → cited answer
       └─ coverage intent or compared periods → scope counts (+ year digest) added to either path
```

The reformulator returns:

- `embeddingQuery`: natural-language, era-aware semantic query;
- `ftsQuery`: keyword query for PostgreSQL full-text search;
- `mode`: `text` or `visual`;
- `complexity`: `simple` or `complex`;
- `coverageIntent`: `none`, `absence`, `count`, or `exhaustive`;
- `startDate` / `endDate`: database filters inferred only from an explicit year, decade, or bounded range in the question;
- `periods`: for explicit comparisons, up to three `{startDate, endDate}` spans, each counted separately.

The semantic query may contain era-aware vocabulary. The lexical query stays at 1–3 essential names/nouns (or one quoted phrase), with no model-generated synonym/`OR` chain. Explicit caller filters remain authoritative over inferred dates.

If the rewrite fails or exceeds 8 s, the original question drives the vector leg, FTS gets a locally derived keyword set (`fallbackFtsQuery`), the question stays simple, and the response carries `meta.reformulationDegraded`. If the question is complex, the agent's `search_archive` tool calls the same canonical reformulate/embed/hybrid/rerank/CRAG service as the simple path.

## Authentication and environment

Required runtime variables:

```bash
DATABASE_URL=postgresql://...
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_CLOUD_LOCATION=global
RAG_CORPUS_VERSION=legacy-8b8207373510d69e
RAG_RETRIEVAL_MODE=versioned    # `legacy` is the rollback value
RAG_ACTIVE_INDEX_BUILD_ID=...   # the one active build for this corpus
GOOGLE_SERVICE_ACCOUNT_JSON=... # Vercel only: Vertex service-account key
```

`RAG_RETRIEVAL_MODE` defaults to `legacy` in code; production has set
`versioned` since 2026-08-03. `shadow` and `versioned` require an explicit
`RAG_ACTIVE_INDEX_BUILD_ID`; table existence never changes behavior.
The active build, corpus, pipeline, embedding model, and text/image input
versions are part of retrieval telemetry and readiness. A versioned
build must match every configured identity field and be in the allowed state;
readiness is rechecked after a 30-second TTL. `versioned` additionally requires
exactly one active build for the corpus. `shadow` serves legacy results while
measuring a validated candidate, and a candidate failure never changes the
served answer.

Local ADC setup is external to the application:

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project "$GOOGLE_CLOUD_PROJECT"
npm run google:verify-adc
```

ADC is required for the data pipeline — index builds (`npm run rag:index:build`), the OCR path, and every offline script — because project attribution and promotional-credit verification depend on it. The Vercel runtime has no ADC and authenticates to the same Vertex project with `GOOGLE_SERVICE_ACCOUNT_JSON`. Every path bills the Cloud project, so Ask and OCR stop together if the project's billing is disabled.

## Retrieval index

### Why the old representation was replaced

The legacy index stored one vector for an entire article and mixed the primary image into that same vector. This caused three major problems:

1. facts late in long articles were diluted or omitted;
2. text and visual intent competed inside one vector;
3. a changed input could silently retain a stale vector.

The RAG-v2 index, active since 2026-08-03, stores text and visual evidence separately.

### `article_chunks`

Article bodies are normalized and split deterministically at sentence boundaries. Defaults:

- target size: 3,200 characters;
- sentence overlap: up to 600 characters;
- stable ID: `{index_build_id}:{article_id}:{4-digit chunk_index}` (legacy NULL-build rows drop the build prefix);
- input version: `article-chunk-v1`.

Every record stores the chunk text, FTS vector, 768-dimensional embedding, model, input version, and SHA-256 canonical input hash. The hash includes the model, version, and exact embedding input.

The query ranks evidence within each article, retains a bounded set of the best
passages, deduplicates articles, and only then applies the final article limit.
Reranking and answer generation receive the exact passages that earned the
rank instead of blindly taking the first part of `body_plain`.

### `article_images`

Each article image has its own record and vector:

- stable ID: `{index_build_id}:{article_id}:image:{3-digit image_index}` (legacy rows drop the build prefix);
- image URL and caption;
- model and input version (`article-image-v1`);
- canonical input hash including the image bytes.

Visual queries search this index. The closest matched image is promoted to the first image position returned to the UI and model. Index builds read image bytes from R2; an object that can't be fetched fails that image only and never blocks text retrieval.

### Legacy cutover behavior

The old `articles.embedding` column remains for rollback. Legacy retrieval filters by `embedding_model = 'gemini-embedding-2'`, so it never compares a stable query vector against preview-model document vectors — but no row carries that stamp: all 11,705 articles are stamped `gemini-embedding-2-preview` (9,582) or `NULL` (2,123). The filtered query succeeds with zero rows, so nothing errors and no fallback fires; the pipeline silently degrades to keyword-only FTS. `RAG_RETRIEVAL_MODE=legacy` is therefore a way to keep answering during an incident, not a way to keep answering well, and production must run `versioned`. Restoring real legacy vectors would mean re-embedding `articles.embedding` under the current model, which nothing in the pipeline does any more.

Retrieval never switches on table existence: `article_chunks` and `article_images` are served only when `RAG_RETRIEVAL_MODE=versioned` names an explicit build.

## Hybrid search

The canonical retrieval service starts PostgreSQL FTS immediately and runs
query embedding/vector search as an independent branch. It returns hybrid when
both succeed, FTS-only when embedding or vector retrieval fails, vector-only
when FTS fails, and a typed error only when neither signal succeeds. Route,
agent, visual, and CRAG-retry searches all use this service. Fusion is
Reciprocal Rank Fusion with k = 40. Pools: 40 candidates (50 visual) for the
route, at least 24 (30) per agent search; date ranges of 90 days or more use
month-stratified vector selection. Vector weights are:

- text: `0.6` vector / `0.4` FTS;
- visual: `0.7` vector / `0.3` FTS.

Vector queries set `hnsw.ef_search = 100` and `hnsw.iterative_scan = 'relaxed_order'` for filtered ANN recall. Versioned FTS searches article, chunk, and `article_images.caption` evidence. Article-level matches are emitted once, and the exact matched caption/image is promoted for downstream use.

Retrieval results are not cached. A timeout or abort never launches duplicate work under the same expired deadline.

## Reranking and corrective retrieval

By default Gemini scores candidates from 0–10 using structured JSON. When `VOYAGE_API_KEY` is set, a dedicated Voyage cross-encoder (`rerank-2.5`) scores instead, with its 0–1 relevance mapped onto the same 0–10 scale; any failure (or an unset key) falls back to the Gemini judge, so the Voyage path can never make results worse. The scorer sees the retrieval-local passages and image captions. Sources that directly disprove a question's premise remain highly relevant because non-occurrence may be the answer. In visual mode, captions are the evidence for whether the requested subject is actually pictured; a prose mention beside an unrelated portrait is not a visual match. The normal thresholds are:

- text: keep score 4 or higher;
- visual: keep score 3 or higher.

If retrieval found candidates but the reranker rejects all of them, the pipeline performs exactly one corrective retry:

1. ask the reformulator for broader search terms;
2. embed and retrieve once more;
3. rerank at 3 (text) / 2 (visual).

No second corrective retry is attempted. A still-vetoed text search sends the top fused candidates on at the neutral score 5; a vetoed visual search returns nothing and the answer becomes an explicit archive-insufficiency response. The Gemini judge gets 12 s and re-judges the top half of the pool (at most 20) once on its own timeout; other failures keep fused order flagged `rerankDegraded` (confidence low), and a spent quota fails the request. Follow-ups pass the previous question to the judge.

## Grounded answer generation

The generator receives the original question and up to 12 reranked sources (15 visual), each body capped at 5,000 characters. If the mean of the three best reranker scores is below 5, it skips the model and returns a no-evidence answer. Questions are encoded as JSON strings inside prompts rather than interpolated into fake XML boundaries.

The model returns:

```json
{
  "answer": "Grounded prose with [Source 1] markers.",
  "follow_ups": ["Up to three archive-answerable questions"]
}
```

Post-processing:

1. remove out-of-range `[Source N]` markers;
2. build citations only from markers visible in the final answer;
3. map each marker to an article actually supplied to the model;
4. downgrade confidence when citations are missing or weak;
5. remove arbitrary Markdown links and bare model-produced web URLs;
6. allow an inline image only when it is registered to a cited retrieved article, replace model alt text with the stored caption, and cap output at three images;
7. attach the immutable content-revision identity to each accepted citation.

Questions classified as absence, count, or exhaustive receive a read-only
database count of the editions and searchable articles in the effective
date/category scope. Coverage metadata is explicitly marked as metadata, never
evidence. With no verified citation, model prose is replaced by deterministic
"no matching evidence was found in the indexed scope" wording; the system never
turns retrieval silence into a claim that an event was absent from the paper.
A supported positive answer keeps its evidence-derived confidence and receives
only a scope note.

Confidence no longer depends on hardcoded embedding-distance thresholds. It is based on the model-independent 0–10 reranker rubric and verified cited sources. A single source can support a medium-confidence answer, but never a high-confidence synthesis.

Thinking and the user-facing answer share the model's output ceiling, so generation reserves 8,192 tokens and caps the answer field at 12,000 characters. The answer stage runs at `LOW` rather than `MEDIUM` — grounded single-hop QA over pre-retrieved context is the canonical low-thinking case, and thinking bills at the output rate. If a response stops abnormally, the finish reason is logged. A complete answer field can be recovered from a truncated outer envelope; malformed structured output is otherwise discarded rather than displayed as raw JSON.

The SSE generator decodes the answer string out of the streaming JSON (`AnswerFieldExtractor`) and emits it as `delta` events, so JSON syntax and `follow_ups` never reach the client. Grounding and coverage policy run on the buffered response; the `done` event's answer is authoritative and replaces the streamed text.

## Complex-question agent

The agent has three validated tools:

| Tool             | Purpose                                                                              |
| ---------------- | ------------------------------------------------------------------------------------ |
| `search_archive` | Canonical reformulation, chunk/image hybrid retrieval, reranking, and one CRAG retry |
| `read_article`   | Full article text and image metadata for a returned article ID                       |
| `list_editions`  | Paginated dates and article counts                                                   |

Tool arguments are type-checked, date ranges are validated, categories are allow-listed, and limits are clamped. Route-level date/category filters are enforced inside every tool so a model call cannot widen the requested scope. The loop preserves function-call IDs, names, order, model parts, and response counts during research. Independent calls in one model round run in parallel. It allows three tool rounds and, if the model has not answered, performs one final call with a dedicated synthesis-only system instruction and `FunctionCallingConfigMode.NONE`. That call starts a fresh turn from up to 12 deduplicated returned articles (ranked by relevance, with exact IDs, passages/body evidence, metadata, and captions) rather than replaying prior model function-call parts. Research stops before a new round when fewer than 20 s remain before the deadline (round 0 always searches), and after round 0 any search still running when that 20 s reserve begins is cut off and the answer marked degraded. The forced synthesis thinks at `LOW`: at `MEDIUM` it spent 10-19 s thinking before its first word. Every round, including the forced synthesis, streams.

The model receives full relevant passages, once each (`excerpt` is sent only when no passage matched), and complete `read_article` bodies. The 300-character `bodySnippet` truncation applies only to UI metadata, not the evidence returned to the model.

Agent citations use `[YYYY-MM-DD-index]`. A citation is accepted only if that exact ID appeared in a successful tool result. The response reports the truthful aggregate retrieval method used by those searches. Citation count alone cannot create high confidence; verified reranker scores and tool success are also required.

## Deadlines and cancellation

| Stage                 |                     Local budget |
| --------------------- | -------------------------------: |
| Reformulation         |                              8 s |
| Query embedding       |                             10 s |
| Hybrid/DB retrieval   |   8 s default, 10 s route budget |
| Reranking             |   12 s, plus one half-size retry |
| Answer generation     |                             30 s |
| Agent writing reserve |                        last 20 s |
| History/budget reads  |                         2 s each |
| Turn persistence      |                            1.5 s |
| Entire request        | 55 s (Vercel `maxDuration` 60 s) |

Neon HTTP queries receive `fetchOptions.signal`. The database wrapper also races the operation against the abort event. This dual mechanism cancels the real fetch and still guarantees the caller returns if a driver or test double ignores `AbortSignal`.

`DbTimeoutError`, `QuotaExhaustedError`, stage wrappers, and the global deadline remain distinct so JSON and SSE errors identify the failing stage.

## Caching and conversations

There is no answer cache. Since `243f9d0` every question runs the full pipeline: the semantic tier matched paraphrases at 0.94 similarity and could serve one reader another's answer. `answer-cache.ts` and the `answer_cache` table (migration `0010`) remain, but the route never reads or writes them.

Query embeddings have a five-minute bounded LRU. Retrieval results themselves are not cached, so `meta.method` and the retrieval log always describe the current request's own signals.

Conversation turns live in Neon for `ASK_SESSION_TTL_DAYS` (default 7, clamped to
[1, 30]) — the same window the browser-side sidebar keeps a thread for, so a
reopened thread never loses its follow-up context. Each successful write
transaction:

1. inserts the turn, cited IDs, and bounded citation snapshots when the expand-only column is available;
2. deletes expired global rows;
3. keeps only the newest five rows for that session (the prompt-context budget, separate from the recall window).

Each snapshot pins a content revision, headline/date metadata, a bounded evidence
excerpt, and registered image metadata. Session hydration uses the snapshot
instead of rereading a later mutable article row; legacy turns without snapshots
retain the old lookup fallback. The route bounds persistence latency so a slow
history write cannot indefinitely delay a response.

## Cost accounting

Standard global rates represented by `src/lib/cost-tracker.ts`:

| Model                   |               Input | Output/reasoning |    Image input |
| ----------------------- | ------------------: | ---------------: | -------------: |
| `gemini-3.5-flash-lite` |      $0.30/M tokens |   $2.50/M tokens |            N/A |
| `gemini-3.8-flash`      |      $1.50/M tokens |   $7.50/M tokens |            N/A |
| `gemini-embedding-2`    | $0.20/M text tokens |              N/A | $0.00012/image |

`toolUsePromptTokenCount` is counted as input and `thoughtsTokenCount` as output. Embedding telemetry uses per-embedding token statistics when available and billable-character estimation otherwise.

The daily guard is `RAG_DAILY_BUDGET_USD` (default `$2`, clamped to `$50`), kept per environment in `ai_spend_by_scope` by UTC day and `VERCEL_ENV` scope (`local` outside Vercel); the refusal's countdown runs to UTC midnight. While Neon is unreadable, requests continue until estimated blind spend reaches `$0.50`. Isolated live
evaluation uses a separate ledger with a hard `$10` aggregate stop limit. These
counters are application safety controls, not Google Cloud billing
reconciliation; promotional-credit usage must be verified in Cloud Billing.

## Migrations and index builds

No migration runs automatically at application startup. `npm run db:migrate` applies the ledger-tracked schema migrations; seeding and backfills maintain schema data and the legacy NULL-build rows only. Served indexes are built with `npm run rag:index:build`, never `db:embed`:

```bash
npm run rag:index:build -- --dry-run --yes                       # read-only plan and cost
npm run rag:index:build -- --create --corpus <corpus-id> --yes   # prints <build-id>
npm run rag:index:build -- --populate <build-id> --yes           # deterministic records, no model calls
npm run rag:index:build -- --embed-text <build-id> --yes
npm run rag:index:build -- --embed-images <build-id> --yes       # bytes fetched from R2
npm run rag:index:build -- --finalize <build-id> --yes           # 'validated' or 'failed'
npm run rag:index:build -- --activate <build-id> --yes
```

Then set `RAG_ACTIVE_INDEX_BUILD_ID` and `RAG_CORPUS_VERSION` together, redeploy, and run `npm run rag:health`. `--activate` refuses while the same corpus already has an active build; roll the old one back with `--rollback-activation` first, or build under a new corpus id.

Build behavior:

- text inputs batch up to 50 records;
- image inputs run one at a time;
- one transient retry is allowed;
- quota exhaustion stops the run cleanly;
- rerunning resumes rows whose vector is missing, keyed by exact input hash;
- there is no `--force`: a changed model, input, or version means a new build.

The legacy NULL-build rows are maintained separately by `npm run db:embed -- --legacy-unversioned` (add `--dry-run` for cost); nothing serves them.

Do not run migrations, backfills, or index builds against production merely to execute unit or read-only golden tests.

## Verification

Local deterministic checks:

```bash
npm run typecheck
npm run lint
npm run test:run
npm run build
node --check scripts/db/backfill-rag-records.mjs
node --check scripts/db/embed.mjs
npm run rag:health     # read-only serving-filter check
npm run rag:smoke      # live: posts every landing prompt at /api/ask (about 1¢ per question)
```

Live golden questions are opt-in:

```bash
RUN_RAG_GOLDEN=1 npx vitest run tests/api/rag-golden-questions.test.ts
```

The live suite requires `DATABASE_URL`, `GOOGLE_CLOUD_PROJECT`, and working ADC. It never rewrites the baseline. Historical citation counts and self-reported confidence are informational; frozen source/fact assertions and security invariants determine correctness.

After activating a new index build, verify:

1. `npm run rag:health` passes and the build has no pending text chunks;
2. missing image count is understood;
3. normal, visual, negative, complex-agent, and prompt-injection questions;
4. citations resolve to returned article IDs;
5. Vertex AI and Neon telemetry show the intended project, model, and query count;
6. billing export or Cloud Billing shows the intended promotional-credit attribution.

## Known limitations

- The route still has separate JSON and SSE orchestration, so contract tests must cover both.
- The query-embedding LRU is per Vercel instance, not globally coherent.
- An image whose R2 object can't be fetched has no image vector; it remains searchable through text and captions.
- The golden catalog is intentionally small and must continue gaining independently verified source IDs and facts; citation quantity is not an accuracy metric.
- Promotional-credit consumption cannot be proven from model response metadata alone; Cloud Billing is authoritative.
