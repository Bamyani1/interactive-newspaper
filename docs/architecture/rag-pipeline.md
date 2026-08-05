# RAG Pipeline — Ask the Archive

This document describes the `/api/ask` pipeline and the isolated RAG-v2 candidate. Production remains on explicit `legacy` retrieval until a versioned index is separately validated and activated. OCR is intentionally out of scope; see `ocr-pipeline.md` for that system.

## Core decisions

| Work | Model | Thinking | Output |
|---|---|---|---|
| Query reformulation and intent classification | `gemini-3.5-flash-lite` | `MINIMAL` | Structured JSON |
| Candidate reranking | `gemini-3.6-flash` | `MINIMAL` | Structured JSON |
| Grounded answer generation | `gemini-3.6-flash` | `LOW` | Structured JSON |
| Complex-question agent loop | `gemini-3.6-flash` | `MEDIUM` | Text plus function calls |
| Text and image embeddings | `gemini-embedding-2` | N/A | 768-dimensional vectors |

Gemini auth has two modes, chosen by whether `GOOGLE_CLOUD_PROJECT` is set (`src/lib/gemini-client.ts`). With it, clients use Vertex AI with Application Default Credentials and `GOOGLE_CLOUD_LOCATION` (default `global`) — local dev and the entire data pipeline, where ADC is the locked provenance decision. Without it, clients use `GEMINI_API_KEY` / `GOOGLE_API_KEY`; **this is the serving path on Vercel**, where no ADC exists, and it is the same mechanism production used before the Vertex migration. Both use the stable `v1` endpoint, and model names and the embedding space are identical across them. Gemini 3 requests omit `temperature`, `topP`, and `topK`. Reranking and answering deliberately run on the full Flash tier: the lite model consistently judged every candidate for broad survey questions as tangential (a total-veto that surfaced as false no-evidence refusals) and wrote weaker prose than the previously served `gemini-3-flash-preview`.

The model and thinking configuration lives in `src/lib/rag-model-config.ts`. `RAG_PIPELINE_VERSION` participates in answer and retrieval cache keys so incompatible results cannot survive a pipeline upgrade.

## Request flow

`POST /api/ask` supports JSON and Server-Sent Events (`?stream=1`). Both paths apply input validation, rate limiting, the daily cost guard, a 55-second global deadline, session history, cache policy, and the same retrieval/ranking rules.

```text
question
  ├─ answer cache hit (simple, history-free requests only)
  └─ reformulate + classify
       ├─ absence/count/exhaustive → deterministic indexed-scope query
       ├─ simple → independent FTS + vector retrieval → fuse → rerank → optional CRAG retry → answer
       └─ complex → agent loop → canonical search/read/list tools → cited answer
```

The reformulator returns:

- `embeddingQuery`: natural-language, era-aware semantic query;
- `ftsQuery`: keyword query for PostgreSQL full-text search;
- `mode`: `text` or `visual`;
- `complexity`: `simple` or `complex`;
- `coverageIntent`: `none`, `absence`, `count`, or `exhaustive`;
- `startDate` / `endDate`: database filters inferred only from an explicit year, decade, or bounded range in the question.

The semantic query may contain era-aware vocabulary. The lexical query stays at 1–3 essential names/nouns (or one quoted phrase), with no model-generated synonym/`OR` chain. Explicit caller filters remain authoritative over inferred dates.

If reformulation fails, the original question is used for both retrieval paths. If the question is complex, the agent's `search_archive` tool calls the same canonical reformulate/embed/hybrid/rerank/CRAG service as the simple path.

## Authentication and environment

Required runtime variables:

```bash
DATABASE_URL=postgresql://...
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_CLOUD_LOCATION=global
RAG_CORPUS_VERSION=legacy-8b8207373510d69e
RAG_RETRIEVAL_MODE=legacy
```

`RAG_RETRIEVAL_MODE` defaults to `legacy`. `shadow` and `versioned` require an
explicit `RAG_ACTIVE_INDEX_BUILD_ID`; table existence never changes behavior.
The active build, corpus, pipeline, embedding model, and text/image input
versions are part of retrieval telemetry and cache identities. A versioned
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

ADC is required for the data pipeline — `npm run db:embed`, the OCR path, and every offline script — because project attribution and promotional-credit verification depend on it. The Vercel serving runtime has no ADC and authenticates with `GEMINI_API_KEY` / `GOOGLE_API_KEY` instead; keep that key scoped to the same project so attribution stays intact.

## Retrieval index

### Why the old representation was replaced

The legacy index stored one vector for an entire article and mixed the primary image into that same vector. This caused three major problems:

1. facts late in long articles were diluted or omitted;
2. text and visual intent competed inside one vector;
3. a changed input could silently retain a stale vector.

The disabled RAG-v2 candidate stores text and visual evidence separately.

### `article_chunks`

Article bodies are normalized and split deterministically at sentence boundaries. Defaults:

- target size: 3,200 characters;
- sentence overlap: up to 600 characters;
- stable ID: `{article_id}:{zero-padded chunk_index}`;
- input version: `article-chunk-v1`.

Every record stores the chunk text, FTS vector, 768-dimensional embedding, model, input version, and SHA-256 canonical input hash. The hash includes the model, version, and exact embedding input.

The query ranks evidence within each article, retains a bounded set of the best
passages, deduplicates articles, and only then applies the final article limit.
Reranking and answer generation receive the exact passages that earned the
rank instead of blindly taking the first part of `body_plain`.

### `article_images`

Each article image has its own record and vector:

- stable ID: `{article_id}:image:{zero-padded image_index}`;
- image URL and caption;
- model and input version (`article-image-v1`);
- canonical input hash including the image bytes.

Visual queries search this index. The closest matched image is promoted to the first image position returned to the UI and model. Missing local image files are logged and left pending; text retrieval is not blocked.

### Legacy cutover behavior

The old `articles.embedding` column remains during migration and rollback. Legacy retrieval filters by `embedding_model = 'gemini-embedding-2'`; it never compares a stable query vector against preview-model document vectors. Before the v2 vectors are backfilled, lexical FTS therefore remains useful without mixing incompatible embedding spaces. Even if `article_chunks` and `article_images` exist, they are not served unless `RAG_RETRIEVAL_MODE=versioned` names an explicit build.

## Hybrid search

The canonical retrieval service starts PostgreSQL FTS immediately and runs
query embedding/vector search as an independent branch. It returns hybrid when
both succeed, FTS-only when embedding or vector retrieval fails, vector-only
when FTS fails, and a typed error only when neither signal succeeds. Route,
agent, visual, and CRAG-retry searches all use this service. Default vector
weights are:

- text: `0.6` vector / `0.4` FTS;
- visual: `0.7` vector / `0.3` FTS.

Vector queries set `hnsw.ef_search = 100` and `hnsw.iterative_scan = 'relaxed_order'` for filtered ANN recall. Versioned FTS searches article, chunk, and `article_images.caption` evidence. Article-level matches are emitted once, and the exact matched caption/image is promoted for downstream use.

The hybrid cache key includes:

- lexical query;
- SHA-256 digest of the semantic query vector;
- filters and mode options;
- pipeline version;
- corpus version.

This prevents a broader CRAG retry from receiving the first query's cached candidates. A timeout or abort never launches duplicate work under the same expired deadline.

## Reranking and corrective retrieval

By default Gemini scores candidates from 0–10 using structured JSON. When `VOYAGE_API_KEY` is set, a dedicated Voyage cross-encoder (`rerank-2.5`) scores instead, with its 0–1 relevance mapped onto the same 0–10 scale; any failure (or an unset key) falls back to the Gemini judge, so the Voyage path can never make results worse. The scorer sees the retrieval-local passages and image captions. Sources that directly disprove a question's premise remain highly relevant because non-occurrence may be the answer. In visual mode, captions are the evidence for whether the requested subject is actually pictured; a prose mention beside an unrelated portrait is not a visual match. The normal thresholds are:

- text: keep score 4 or higher;
- visual: keep score 3 or higher.

If retrieval found candidates but the reranker rejects all of them, the pipeline performs exactly one corrective retry:

1. ask the reformulator for broader search terms;
2. embed and retrieve once more;
3. rerank at a slightly lower threshold.

No second corrective retry is attempted. If the second pass is empty, the answer becomes an explicit archive-insufficiency response.

## Grounded answer generation

The generator receives the original question and up to the selected article count. Questions are encoded as JSON strings inside prompts rather than interpolated into fake XML boundaries.

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

The SSE generator buffers the model's structured JSON and emits only the cleaned answer, followed by the final `done` event. Raw partial JSON is never shown to the client.

## Complex-question agent

The agent has three validated tools:

| Tool | Purpose |
|---|---|
| `search_archive` | Canonical reformulation, chunk/image hybrid retrieval, reranking, and one CRAG retry |
| `read_article` | Full article text and image metadata for a returned article ID |
| `list_editions` | Paginated dates and article counts |

Tool arguments are type-checked, date ranges are validated, categories are allow-listed, and limits are clamped. Route-level date/category filters are enforced inside every tool so a model call cannot widen the requested scope. The loop preserves function-call IDs, names, order, model parts, and response counts during research. Independent calls in one model round run in parallel. It allows three tool rounds and, if the model has not answered, performs one final call with a dedicated synthesis-only system instruction and `FunctionCallingConfigMode.NONE`. That call starts a fresh turn from up to 12 deduplicated returned articles (ranked by relevance, with exact IDs, passages/body evidence, metadata, and captions) rather than replaying prior model function-call parts.

The model receives full relevant passages and complete `read_article` bodies. The 300-character `bodySnippet` truncation applies only to UI metadata, not the evidence returned to the model.

Agent citations use `[YYYY-MM-DD-index]`. A citation is accepted only if that exact ID appeared in a successful tool result. The response reports the truthful aggregate retrieval method used by those searches. Citation count alone cannot create high confidence; verified reranker scores and tool success are also required.

## Deadlines and cancellation

| Stage | Local budget |
|---|---:|
| Reformulation | 5 s |
| Query embedding | 10 s |
| Hybrid/DB retrieval | 8 s default, 10 s route budget |
| Reranking | 8 s |
| Answer generation | 30 s |
| Entire request | 55 s |

Neon HTTP queries receive `fetchOptions.signal`. The database wrapper also races the operation against the abort event. This dual mechanism cancels the real fetch and still guarantees the caller returns if a driver or test double ignores `AbortSignal`.

`DbTimeoutError`, `QuotaExhaustedError`, stage wrappers, and the global deadline remain distinct so JSON and SSE errors identify the failing stage.

## Caching and conversations

The answer cache has two tiers, both used only for history-free simple questions, and both scoped by a cache identity covering the pipeline version, generation model, embedding model, corpus version, and retrieval identity. Tier 1 is a one-hour in-memory LRU keyed on the exact normalized question plus filters — free and instant, but per-instance on Vercel and gone on redeploy. Tier 2 is a pgvector semantic cache (the `answer_cache` table, migration `0010`) that matches paraphrases by question-embedding similarity at a 0.94 threshold, survives instances and deploys, and costs one query embedding per lookup. Cache lookup occurs before a reformulation call.

Cache entries are shared across every visitor, so `setCachedAnswer` strips the storing request's `question`, `sessionId`, and `requestId` before either tier keeps it, and a cache hit re-attaches the reading caller's own.

Query embeddings and hybrid results have five-minute bounded LRUs. Agent answers are not placed in the answer cache.

Conversation turns live in Neon for 30 minutes. Each successful write transaction:

1. inserts the turn, cited IDs, and bounded citation snapshots when the expand-only column is available;
2. deletes expired global rows;
3. keeps only the newest five rows for that session.

Each snapshot pins a content revision, headline/date metadata, a bounded evidence
excerpt, and registered image metadata. Session hydration uses the snapshot
instead of rereading a later mutable article row; legacy turns without snapshots
retain the old lookup fallback. The route bounds persistence latency so a slow
history write cannot indefinitely delay a response.

## Cost accounting

Standard global rates represented by `src/lib/cost-tracker.ts`:

| Model | Input | Output/reasoning | Image input |
|---|---:|---:|---:|
| `gemini-3.5-flash-lite` | $0.30/M tokens | $2.50/M tokens | N/A |
| `gemini-3.6-flash` | $1.50/M tokens | $7.50/M tokens | N/A |
| `gemini-embedding-2` | $0.20/M text tokens | N/A | $0.00012/image |

`toolUsePromptTokenCount` is counted as input and `thoughtsTokenCount` as output. Embedding telemetry uses per-embedding token statistics when available and billable-character estimation otherwise.

The application's daily software guard is `$2` (raised from `$0.50` with the full-Flash upgrade; roughly 50 questions/day). Isolated live
evaluation uses a separate ledger with a hard `$10` aggregate stop limit. These
counters are application safety controls, not Google Cloud billing
reconciliation; promotional-credit usage must be verified in Cloud Billing.

## Migration and backfill

No migration runs automatically at application startup.

The commands below belong to the checkpointed candidate and are **not approved
for production use**. The versioned migration ledger (`schema_migrations`,
applied by `npm run db:migrate`) now exists, but production remains unmigrated;
the migrations and the index-build state machine must be rehearsed before these
commands may target production.

```bash
# 1. Canonical, ledger-tracked schema migrations; no Google calls
npm run db:migrate

# 2. Deterministic chunk/image metadata backfill; no DDL, no Google calls
npm run db:backfill:rag-records

# 3. Preview cost and missing local images
npm run db:embed -- --dry-run

# 4. Generate pending stable text and image vectors
npm run db:embed
```

The migration and seed paths are idempotent. Changed chunk or image inputs invalidate only the affected vector; unchanged vectors survive. Removed articles cascade to their chunks/images, and stale chunk/image records are deleted.

Backfill behavior:

- text-only inputs batch up to 50 records in the script;
- image inputs run separately;
- one transient retry is allowed;
- quota exhaustion stops the run cleanly;
- rerunning resumes rows whose vector/model/version is missing;
- `--force` re-embeds every record.

Do not run migration or backfill against production merely to execute unit or read-only golden tests.

## Verification

Local deterministic checks:

```bash
npm run typecheck
npm run lint
npm run test:run
npm run build
node --check scripts/db/backfill-rag-records.mjs
node --check scripts/db/embed.mjs
```

Live golden questions are opt-in:

```bash
RUN_RAG_GOLDEN=1 npx vitest run tests/api/rag-golden-questions.test.ts
```

The live suite requires `DATABASE_URL`, `GOOGLE_CLOUD_PROJECT`, and working ADC. It never rewrites the baseline. Historical citation counts and self-reported confidence are informational; frozen source/fact assertions and security invariants determine correctness.

After an approved migration/backfill, verify:

1. no pending text chunks for the current model/version;
2. missing image count is understood;
3. normal, visual, negative, complex-agent, and prompt-injection questions;
4. citations resolve to returned article IDs;
5. Vertex AI and Neon telemetry show the intended project, model, and query count;
6. billing export or Cloud Billing shows the intended promotional-credit attribution.

## Known limitations

- The route still has separate JSON and SSE orchestration, so contract tests must cover both.
- Vercel-local LRUs are per instance, not globally coherent.
- Image backfill requires the corresponding local edition image file. Missing files remain searchable through text and captions but have no image vector.
- The golden catalog is intentionally small and must continue gaining independently verified source IDs and facts; citation quantity is not an accuracy metric.
- Promotional-credit consumption cannot be proven from model response metadata alone; Cloud Billing is authoritative.
