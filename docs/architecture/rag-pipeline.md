# RAG Pipeline — Ask the Archive

This document describes the production `/api/ask` pipeline after the RAG v2 retrieval migration. OCR is intentionally out of scope; see `ocr-pipeline.md` for that system.

## Core decisions

| Work | Model | Thinking | Output |
|---|---|---|---|
| Query reformulation and intent classification | `gemini-3.5-flash-lite` | `MINIMAL` | Structured JSON |
| Candidate reranking | `gemini-3.5-flash-lite` | `MINIMAL` | Structured JSON |
| Grounded answer generation | `gemini-3.5-flash-lite` | `MEDIUM` | Structured JSON |
| Complex-question agent loop | `gemini-3.5-flash-lite` | `MEDIUM` | Text plus function calls |
| Text and image embeddings | `gemini-embedding-2` | N/A | 768-dimensional vectors |

All Gemini clients use Vertex AI, Application Default Credentials, the stable `v1` endpoint, and `GOOGLE_CLOUD_LOCATION` (default `global`). The RAG path has no API-key fallback and no Gemini 3.6 generation call. Gemini 3 requests omit `temperature`, `topP`, and `topK`.

The model and thinking configuration lives in `src/lib/rag-model-config.ts`. `RAG_PIPELINE_VERSION` participates in answer and retrieval cache keys so incompatible results cannot survive a pipeline upgrade.

## Request flow

`POST /api/ask` supports JSON and Server-Sent Events (`?stream=1`). Both paths apply input validation, rate limiting, the daily cost guard, a 30-second global deadline, session history, cache policy, and the same retrieval/ranking rules.

```text
question
  ├─ answer cache hit (simple, history-free requests only)
  └─ reformulate + classify
       ├─ simple → embed → hybrid retrieve → rerank → optional CRAG retry → answer
       └─ complex → agent loop → search/read/list tools → cited answer
```

The reformulator returns:

- `embeddingQuery`: natural-language, era-aware semantic query;
- `ftsQuery`: keyword query for PostgreSQL full-text search;
- `mode`: `text` or `visual`;
- `complexity`: `simple` or `complex`;
- `startDate` / `endDate`: database filters inferred only from an explicit year, decade, or bounded range in the question.

The semantic query may contain era-aware vocabulary. The lexical query stays at 1–3 essential names/nouns (or one quoted phrase), with no model-generated synonym/`OR` chain. Explicit caller filters remain authoritative over inferred dates.

If reformulation fails, the original question is used for both retrieval paths. If the question is complex, the agent's `search_archive` tool calls the same canonical reformulate/embed/hybrid/rerank/CRAG service as the simple path.

## Authentication and environment

Required runtime variables:

```bash
DATABASE_URL=postgresql://...
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_CLOUD_LOCATION=global
RAG_CORPUS_VERSION=2026-07-31
```

Local ADC setup is external to the application:

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project "$GOOGLE_CLOUD_PROJECT"
```

The deployed runtime must have an identity with permission to invoke the relevant Vertex AI models. Do not add `GEMINI_API_KEY` or `GOOGLE_API_KEY` as a fallback; doing so makes project attribution and promotional-credit verification ambiguous.

## Retrieval index

### Why the old representation was replaced

The legacy index stored one vector for an entire article and mixed the primary image into that same vector. This caused three major problems:

1. facts late in long articles were diluted or omitted;
2. text and visual intent competed inside one vector;
3. a changed input could silently retain a stale vector.

RAG v2 stores text and visual evidence separately.

### `article_chunks`

Article bodies are normalized and split deterministically at sentence boundaries. Defaults:

- target size: 3,200 characters;
- sentence overlap: up to 600 characters;
- stable ID: `{article_id}:{zero-padded chunk_index}`;
- input version: `article-chunk-v1`.

Every record stores the chunk text, FTS vector, 768-dimensional embedding, model, input version, and SHA-256 canonical input hash. The hash includes the model, version, and exact embedding input.

The query retrieves more evidence rows than the final article limit and then aggregates matching passages by article. Reranking and answer generation receive those passages instead of blindly taking the first part of `body_plain`.

### `article_images`

Each article image has its own record and vector:

- stable ID: `{article_id}:image:{zero-padded image_index}`;
- image URL and caption;
- model and input version (`article-image-v1`);
- canonical input hash including the image bytes.

Visual queries search this index. The closest matched image is promoted to the first image position returned to the UI and model. Missing local image files are logged and left pending; text retrieval is not blocked.

### Legacy cutover behavior

The old `articles.embedding` column remains during migration and rollback. Legacy retrieval filters by `embedding_model = 'gemini-embedding-2'`; it never compares a stable query vector against preview-model document vectors. Before the v2 vectors are backfilled, lexical FTS therefore remains useful without mixing incompatible embedding spaces.

## Hybrid search

`src/lib/db.ts` runs vector retrieval and PostgreSQL FTS in parallel, then merges them with Reciprocal Rank Fusion. Default vector weights are:

- text: `0.6` vector / `0.4` FTS;
- visual: `0.7` vector / `0.3` FTS.

Vector queries set `hnsw.ef_search = 100` and `hnsw.iterative_scan = 'relaxed_order'` for filtered ANN recall. V2 FTS searches both chunk and article search vectors and returns the matched chunks as evidence.

The hybrid cache key includes:

- lexical query;
- SHA-256 digest of the semantic query vector;
- filters and mode options;
- pipeline version;
- corpus version.

This prevents a broader CRAG retry from receiving the first query's cached candidates.

If hybrid search fails for a non-timeout database error, one vector-only fallback is allowed. A timeout or abort never launches duplicate fallback work under the same expired deadline.

## Reranking and corrective retrieval

Gemini scores candidates from 0–10 using structured JSON. It sees the retrieval-local passages and image captions. Sources that directly disprove a question's premise remain highly relevant because non-occurrence may be the answer. In visual mode, captions are the evidence for whether the requested subject is actually pictured; a prose mention beside an unrelated portrait is not a visual match. The normal thresholds are:

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
5. URL-encode spaces in archive image URLs.

Confidence no longer depends on hardcoded embedding-distance thresholds. It is based on the model-independent 0–10 reranker rubric and verified cited sources. A single source can support a medium-confidence answer, but never a high-confidence synthesis.

MEDIUM thinking and the user-facing answer share the model's output ceiling, so generation reserves 8,192 tokens and caps the answer field at 12,000 characters. If a response stops abnormally, the finish reason is logged. A complete answer field can be recovered from a truncated outer envelope; malformed structured output is otherwise discarded rather than displayed as raw JSON.

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

Agent citations use `[YYYY-MM-DD-index]`. A citation is accepted only if that exact ID appeared in a successful tool result. Citation count alone cannot create high confidence; verified reranker scores and tool success are also required.

## Deadlines and cancellation

| Stage | Local budget |
|---|---:|
| Reformulation | 5 s |
| Query embedding | 10 s |
| Hybrid/DB retrieval | 8 s default, 10 s route budget |
| Reranking | 8 s |
| Answer generation | 15 s |
| Entire request | 30 s |

Neon HTTP queries receive `fetchOptions.signal`. The database wrapper also races the operation against the abort event. This dual mechanism cancels the real fetch and still guarantees the caller returns if a driver or test double ignores `AbortSignal`.

`DbTimeoutError`, `QuotaExhaustedError`, stage wrappers, and the global deadline remain distinct so JSON and SSE errors identify the failing stage.

## Caching and conversations

The one-hour answer cache is used only for history-free simple questions. Its key includes the pipeline, generation model, embedding model, corpus version, normalized question, and filters. Cache lookup occurs before a reformulation call.

Query embeddings and hybrid results have five-minute bounded LRUs. Agent answers are not placed in the answer cache.

Conversation turns live in Neon for 30 minutes. Each successful write transaction:

1. inserts the turn;
2. deletes expired global rows;
3. keeps only the newest five rows for that session.

The route bounds persistence latency so a slow history write cannot indefinitely delay a response.

## Cost accounting

Standard global rates represented by `src/lib/cost-tracker.ts`:

| Model | Input | Output/reasoning | Image input |
|---|---:|---:|---:|
| `gemini-3.5-flash-lite` | $0.30/M tokens | $2.50/M tokens | N/A |
| `gemini-embedding-2` | $0.20/M text tokens | N/A | $0.00012/image |

`toolUsePromptTokenCount` is counted as input and `thoughtsTokenCount` as output. Embedding telemetry uses per-embedding token statistics when available and billable-character estimation otherwise.

The application keeps its existing `$0.50` daily software guard. This counter is an application safety control, not Google Cloud billing reconciliation; promotional-credit usage must be verified in Cloud Billing.

## Migration and backfill

No migration runs automatically at application startup.

```bash
# 1. Schema + deterministic metadata only; no Google calls
npm run db:migrate:rag-v2

# 2. Preview cost and missing local images
npm run db:embed -- --dry-run

# 3. Generate pending stable text and image vectors
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
node --check scripts/db/migrate-rag-v2.mjs
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
