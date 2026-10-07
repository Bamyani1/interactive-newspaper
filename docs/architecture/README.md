# Architecture

Three documents describe how the project works end-to-end. Read them in this order
if you're new; the glossary and operator shortcuts below answer narrower questions.

## Reading order

1. **[ocr-pipeline.md](ocr-pipeline.md)** — How raw scanned TIF images become structured `edition.json` with articles, ads, and image crops: manifest accounting, lossless conversion, Document AI + local visual detection, Gemini page structuring, grouping and seam review, enrichment, then candidate validation and atomic promotion.
2. **[data-model.md](data-model.md)** — How `edition.json` becomes DB rows. Schema, the `ocr-adapter` boundary, embeddings and immutable index builds, HNSW, migrations, and R2 storage.
3. **[rag-pipeline.md](rag-pipeline.md)** — How DB rows become answers. `/api/ask` end-to-end: reformulate → retrieve (embedding + FTS, fused) → rerank → generate, with a coverage step for absence/count/exhaustive questions, plus the agent loop for complex queries, SSE streaming, dedup, budget, and the error taxonomy.

Each doc is written to be readable standalone, but the three share vocabulary and cross-link at points where duplicating would drift.

## Glossary

Terms that appear across multiple docs:

- **adapter** — `src/server/ocr-adapter/`, the only code path that writes `edition.json` content to DB rows. Owns normalization, filtering, dedup, and idempotent re-seeds.
- **agent loop** — The function-calling path for complex queries in `src/lib/agent-loop.ts`. Uses three tools: `search_archive`, `read_article`, `list_editions`.
- **CRAG** — Corrective RAG. A single retry with broader search terms when the reranker returns zero results.
- **edition** — One day's newspaper, identified by `YYYY-MM-DD`. Contains articles, ads, and images.
- **`edition.json`** — The canonical OCR output. Shape defined in `ocr/src/transcript_ocr/contracts/content_models.py`.
- **FTS** — Postgres full-text search. Uses GIN-indexed `tsvector` column `search_vector`.
- **HNSW** — Hierarchical Navigable Small World. The pgvector ANN index used for embedding similarity search. Parameters: `m=16, ef_construction=128, hnsw.ef_search=100`.
- **hybrid search** — The combined vector + FTS retrieval in `retrieval.ts :: retrieveCandidates`, which runs both signals independently and merges them with `db.ts :: fuseArticleResults` via RRF. When both signals succeed and return nothing, the reported method is `none`, not `hybrid`.
- **index build** — A versioned, immutable set of chunk and image vectors (`rag_index_builds`); production serves the one named by `RAG_ACTIVE_INDEX_BUILD_ID`.
- **retrieval mode** — `RAG_RETRIEVAL_MODE`: `versioned` (production), `shadow`, or `legacy`, which matches no vectors and silently runs keyword-only.
- **RRF** — Reciprocal Rank Fusion. The algorithm that merges vector and FTS rank lists: `score = weight / (K + rank)` with `K=40`.
- **simple pipeline** — The non-agent path in `/api/ask`: reformulate → retrieve → rerank → generate (embedding happens inside retrieve).
- **turn** — One (question, answer) pair in a conversation. Multiple turns form a session: the newest 5 are the prompt context, and rows are kept for `ASK_SESSION_TTL_DAYS` (default 7) in `ask_session_turns`.
- **citation snapshot** — Bounded, immutable metadata/evidence retained with a turn and keyed to the cited content revision, so later OCR changes do not rewrite hydrated sources.
- **coverage intent** — `absence`, `count`, or `exhaustive` classification that triggers a deterministic indexed-edition/article scope query. Coverage metadata describes search scope and is never source evidence.
- **CRAG retry stages** — `reformulate-retry`, `retrieve-retry`, `rerank-retry`. Tagged for log attribution.

## Operator shortcuts

Common troubleshooting:

| Symptom                            | Where to look                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `/api/ask` returning 504s          | [rag-pipeline.md § Deadlines and cancellation](rag-pipeline.md#deadlines-and-cancellation)               |
| Every answer is an error           | Check Google Cloud billing and Vertex access first: every Gemini call bills the Cloud project            |
| Answers look keyword-only          | `npm run rag:health`; [data-model.md § Investigate a slow query](data-model.md#investigate-a-slow-query) |
| Vector search feels slow           | [data-model.md § Investigate a slow query](data-model.md#investigate-a-slow-query)                       |
| New editions missing from Ask      | [data-model.md § Build and activate a new index](data-model.md#build-and-activate-a-new-index)           |
| OCR pipeline hung on a page        | [ocr-pipeline.md § Gemini request policy](ocr-pipeline.md#gemini-request-policy) (per-stage timeouts)    |
| Seed wiped embeddings unexpectedly | [data-model.md § Embedding preservation](data-model.md#embedding-preservation--canonical-identity)       |
| Daily budget blown before noon     | [rag-pipeline.md § Cost accounting](rag-pipeline.md#cost-accounting)                                     |

## About this project

This is a personal portfolio / research project — a RAG pipeline over a digitized college newspaper archive (1950–2006). It's intentionally not multi-tenant and not production-scaled; privacy measures stop at hashed session ids and a nightly retention sweep. The tradeoffs in each doc reflect that. Where a production system would add auth, per-user accounting, or regional replicas, this one accepts the simpler single-tenant approach and calls out the limitation.
