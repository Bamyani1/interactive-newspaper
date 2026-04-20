# Architecture

Three deep-dive docs describe how the project works end-to-end. Read them in this order if you're new.

## Reading order

1. **[ocr-pipeline.md](ocr-pipeline.md)** — How raw scanned TIF images become structured `edition.json` with articles, ads, and image crops. Seven-phase pipeline: Phase 0 (TIF→PNG) through Phase 6 (write diagnostics).
2. **[data-model.md](data-model.md)** — How `edition.json` becomes DB rows. Schema, the `ocr-adapter` boundary, embeddings + HNSW, migrations, and the embedding-preservation fingerprint mechanism that makes re-seeds cheap.
3. **[rag-pipeline.md](rag-pipeline.md)** — How DB rows become answers. `/api/ask` end-to-end: reformulate → embed → retrieve → rerank → generate, plus the agent loop for complex queries, SSE streaming, caching, dedup, budget, and the error taxonomy.

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
- **hybrid search** — The combined vector + FTS retrieval in `db.ts :: hybridSearch`. Merged via RRF.
- **RRF** — Reciprocal Rank Fusion. The algorithm that merges vector and FTS rank lists: `score = weight / (K + rank)` with `K=40`.
- **simple pipeline** — The 5-stage non-agent path in `/api/ask`: reformulate → embed → retrieve → rerank → generate.
- **turn** — One (question, answer) pair in a conversation. Multiple turns form a session (up to 5 within 30 min, stored in `ask_session_turns`).
- **CRAG retry stages** — `reformulate-retry`, `embed-retry`, `retrieve-retry`, `rerank-retry`. Tagged for log attribution.

## Operator shortcuts

Common troubleshooting:

| Symptom | Where to look |
|---|---|
| `/api/ask` returning 504s | [rag-pipeline.md § Operator runbook](rag-pipeline.md#operator-runbook) |
| Vector search feels slow | [data-model.md § HNSW index](data-model.md#hnsw-index) — check if index exists |
| OCR pipeline hung on a page | [ocr-pipeline.md § Failure modes](ocr-pipeline.md#failure-modes) |
| Seed wiped embeddings unexpectedly | [data-model.md § Embedding preservation](data-model.md#embedding-preservation--the-fingerprint-mechanism) |
| Daily budget blown before noon | [rag-pipeline.md § Budget & cost tracking](rag-pipeline.md#budget--cost-tracking) |

## About this project

This is a personal portfolio / research project — a RAG pipeline over a digitized college newspaper archive (1950–2006). It's intentionally not multi-tenant, not production-scaled, and not privacy-hardened. The tradeoffs in each doc reflect that. Where a production system would add auth, per-user accounting, or regional replicas, this one accepts the simpler single-tenant approach and calls out the limitation.
