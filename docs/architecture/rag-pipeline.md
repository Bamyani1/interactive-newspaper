# RAG Pipeline — "Ask the Archive"

> Deep-dive on `/api/ask`: the endpoint that answers natural-language questions
> from the newspaper archive. Covers request flow, retrieval, generation,
> caching, rate limiting, budget, error handling, and observability.

**See also**: [data-model.md](data-model.md) for the `articles`, `ask_session_turns`, `ai_spend_counter`, and `api_rate_bucket` tables this endpoint depends on. [ocr-pipeline.md](ocr-pipeline.md) for how the source articles are produced in the first place.

**Terminology** (used consistently below):
- **simple pipeline** — the 5-stage non-agent path (reformulate → embed → retrieve → rerank → generate)
- **agent loop** — the function-calling path for complex queries
- **streaming path** / **JSON path** — the two response modes

## Table of contents

- [What the pipeline does](#what-the-pipeline-does)
- [Request flow](#request-flow)
- [Query reformulation](#query-reformulation)
- [Embedding & retrieval](#embedding--retrieval)
- [Reranking](#reranking)
- [Answer generation](#answer-generation)
- [Agent loop (complex path)](#agent-loop-complex-path)
- [Conversation history](#conversation-history)
- [Caching](#caching)
- [Rate limiting](#rate-limiting)
- [Budget & cost tracking](#budget--cost-tracking)
- [Concurrent request dedup](#concurrent-request-dedup)
- [Retrieval-shape telemetry](#retrieval-shape-telemetry)
- [Error taxonomy](#error-taxonomy)
- [Global deadline & timeouts](#global-deadline--timeouts)
- [Frontend surface](#frontend-surface)
- [Testing](#testing)
- [Operator runbook](#operator-runbook)
- [Known limitations](#known-limitations)
- [Start here](#start-here)

---

## What the pipeline does

`/api/ask` takes a natural-language question and returns a grounded answer with citations to specific newspaper articles in the archive. The system is a retrieval-augmented generation (RAG) pipeline with two modes:

1. **Simple path** — 5-stage pipeline (reformulate → embed → retrieve → rerank → generate)
2. **Complex path** — a constrained function-calling agent that can search, read, and list editions iteratively

Both paths share guards, logging, and observability. The complexity classifier picks between them based on the question shape (multi-era, comparative, or analytical → agent; single-topic factual → simple).

The endpoint supports two response modes: streaming SSE (`?stream=1`) for progressive UI updates, and plain JSON for simpler consumers.

---

## Request flow

### Decision points (read this first)

| Decision | Condition | Branch taken |
|---|---|---|
| Streaming vs JSON | `?stream=1` | `handleStreamingAsk` vs inline simple-pipeline closure |
| Agent vs simple | `complexity === "complex"` from reformulator | agent loop vs simple pipeline |
| Cache hit | `conversationHistory.length === 0` AND key found AND TTL valid | skip pipeline, serve cached |
| Dedup hit | Same `(ip, question, filters, sessionId)` in-flight (JSON path only) | piggyback on existing promise |
| Hybrid → vector fallback | `hybridSearch` throws non-timeout error | use `queryArticlesByEmbedding` only |
| CRAG retry | Reranker returned 0 results AND retrieval was non-empty | one corrective retry with broader terms |

Every request walks this table top-to-bottom. The rest of this section expands each branch.

### Entry point

`src/app/api/ask/route.ts :: POST()`. Distinguishes response mode via the `stream` query param:

- `?stream=1` → `handleStreamingAsk()` returns `text/event-stream`
- otherwise → returns `application/json` via the inline pipeline closure

Concurrent-request dedup applies **only** to the JSON path. Streaming responses carry a `ReadableStream` body that can't be re-read by multiple waiters, so streaming requests always run their own pipeline. Documented at `route.ts:1000-1016`.

### Pre-pipeline guards (both paths)

Before any LLM call:

| # | Guard | What it does | On failure |
|---|---|---|---|
| 1 | Middleware rate limit | `bucket: "mw-ask"`, 10/min | 429 with `Retry-After` |
| 2 | Route-level rate limit | `bucket: "ask"`, 10/min (defense in depth) | 429 |
| 3 | Input validation | `MAX_QUESTION_LENGTH = 1000` chars | 400 `kind: "bad_request"` |
| 4 | Daily budget check | Reads `ai_spend_counter`; throws `DailyBudgetExceededError` if ≥ `$0.50` | 429 `kind: "budget"` with `retryAfterSec: 3600` |
| 5 | Session hydration | Loads `ConversationTurn[]` from Neon if `sessionId` present | Graceful — empty history if Neon unreachable |

Both rate limits fire against the same bucket independently (`middleware.ts:16`, `route.ts:54`). This is deliberate defense-in-depth: middleware runs before any route code loads; route-level fires inside function memory where state is slightly different.

### Non-streaming pipeline

Stage order confirmed from `route.ts:1046–1373`:

```
reformulate → embed → hybridSearch → rerankWithCragRetry → generateAnswer
                    ↓
          [agent branch taken when complexity === "complex"]
```

After the pipeline resolves:

1. `persistTurnBounded(sessionId, question, answer, citedArticleIds)` — writes the turn to Neon, capped at 1500 ms so a slow DB never delays the response.
2. `setCachedAnswer(...)` — caches the response when `confidence !== "low"` AND `complexity !== "complex"`.

### Streaming pipeline

`handleStreamingAsk` at `route.ts:316` emits Server-Sent Events. Canonical event order for the simple pipeline (verified by `ask-route.test.ts:700`):

```
stage(reformulate) → stage(embed) → stage(retrieve) → stage(rerank)
  → metadata        (source articles sent BEFORE generation starts)
  → delta*          (zero or more)
  → done
```

Two important variations:

- **Cache hit**: `stage(cache)` → `metadata` → `done` with no deltas.
- **Agent loop**: `stage(reformulate)` → `stage(agent)` → `tool_call`/`tool_result` events → `metadata` → `done` with no deltas.

Both cases emit `done` without preceding deltas. The client synthesizes word-by-word streaming for UX continuity — see [Replay-as-deltas](#replay-as-deltas-cache--agent-hits) below.

Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`. HTTP status is always 200 once the stream begins; any error during streaming is emitted as an `error` event with `{kind, stage, message, requestId}` payload, not an HTTP status change.

---

## Query reformulation

`src/lib/query-reformulator.ts`

Model: `gemini-3-flash-preview`, `temperature: 0.0`, `maxOutputTokens: 350`, thinking disabled. Timeout: `REFORMULATION_TIMEOUT_MS = 5_000` ms combined with the outer global deadline via `AbortSignal.any`.

The prompt instructs the model to emit exactly four lines:

```
SEMANTIC: <natural-language expansion for embedding>
KEYWORDS: <OR-separated keyword terms for FTS>
MODE: text|visual
COMPLEXITY: simple|complex
```

**Era-specific synonym expansion** is baked into the prompt. Example: `basketball → basketball OR cagers OR hoopsters`. `protest → protest OR demonstration OR rally OR sit-in`. This is critical because a 1960s student newspaper uses era-specific idiom that modern embeddings don't map to.

**Complexity classification**:

| Class | Criteria | Downstream |
|---|---|---|
| `simple` | Single topic, single era, factual lookup | 5-stage pipeline |
| `complex` | Multi-era, comparative, analytical, multi-hop | Agent loop |

**Failure mode**: on timeout or any error, falls back to `{ embeddingQuery: originalQuestion, ftsQuery: originalQuestion, mode: "text", complexity: "simple" }`. The reformulator never throws to its caller.

**History threading**: when a sessionId is provided, conversation history is injected as a `CONVERSATION HISTORY:` block prepended to the user prompt, enabling pronoun resolution and self-contained rewrites for follow-up questions.

---

## Embedding & retrieval

### Embeddings — `src/lib/embeddings.ts`

Model: `gemini-embedding-2-preview`, **768-dimensional** output.

**Query prefix format** (required by the model):

```
task: search result | query: {question}
```

This differs from the document prefix (`title: {headline} | text: {body}`) and is how the model distinguishes retrieval queries from document text.

**LRU cache**: `Map<string, { embedding: number[]; ts: number }>`, capped at 100 entries with a 5-minute TTL. On hit, entries are promoted to MRU by delete-then-reinsert.

**Timeouts**:

- `EMBED_TIMEOUT_MS = 10_000` ms for queries (raised from 5s after p95 spikes caused spurious 502s)
- `retryOnQuota` with exponential backoff at `[1_000, 2_000, 4_000]` ms — **batch `embedDocuments` path only**, not live queries

**`QuotaExhaustedError`**: thrown when Gemini returns 429 / `RESOURCE_EXHAUSTED`. The `isQuotaError` function checks `code === 429`, `status === "RESOURCE_EXHAUSTED"`, and multiple string patterns across SDK error shapes.

### Database — `src/lib/db.ts`

Two query functions feed retrieval:

**`hybridSearch`** — vector + FTS merged via Reciprocal Rank Fusion (RRF):

```
score(article) = vectorWeight / (K + vectorRank)
              + ftsWeight    / (K + ftsRank)
```

`vectorRank` is the article's 1-based position in the vector result list (best match = 1); same for `ftsRank`. An article ranked #1 in both lists gets the maximum possible score. Articles appearing in only one list contribute only that list's term.

| Constant | Default | Purpose |
|---|---|---|
| `K` | 40 | RRF constant (standard is 60; lowered for better differentiation on ~10k corpus) |
| `vectorWeight` | 0.7 | Default vector blend |
| `ftsWeight` | 0.3 | Default FTS blend |
| `fetchK` | `min(3 * limit, 100)` | How many candidates to fetch from each source before fusion |

Route.ts overrides by mode: `visual` uses 0.7/0.3; `text` uses 0.6/0.4.

Articles appearing in both result sets are tagged `source: "both"`; otherwise `"vector"` or `"fts"`. **Why this tag matters**: two independent retrieval methods agreeing is a strong relevance signal. It propagates to rerank signals (via `bothCount`) and into confidence computation as a multiplier of trust.

**`queryArticlesByEmbedding`** — pure vector ANN using pgvector's `<=>` cosine distance. Inside a transaction it runs:

```sql
SET LOCAL hnsw.ef_search = 100
```

vs the default 40. The tradeoff is slightly slower scan for better recall on a small corpus.

**Hybrid search LRU cache**: `Map<string, HybridCacheEntry>`, 50 entries, 5-minute TTL. Keyed on `JSON.stringify({q, l, v, c, s, e, oi})`. Safe to key on the question string (not embedding vector) because the embedding cache guarantees identical inputs produce identical vectors.

### Neon has no AbortSignal support

A **critical operational constraint**: the `@neondatabase/serverless` HTTP driver does not honor `AbortSignal`. Once `sql\`...\`` is invoked, the query runs to completion on Neon's server regardless of client-side cancellation.

The code works around this with `raceWithTimeout`:

```typescript
function raceWithTimeout<T>(op, promise, timeoutMs) {
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DbTimeoutError(op, timeoutMs)), timeoutMs);
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeoutPromise]);
}
```

`DbTimeoutError` unblocks the caller, but the underlying Neon query continues running server-side. Route.ts layers its own `RETRIEVAL_TIMEOUT_MS = 10_000` ms wrapper on top of the `HYBRID_SEARCH_TIMEOUT_MS = 8_000` ms DB-level timeout. Both layers also gate on `options.signal?.aborted` before dispatching to short-circuit obvious cancellations.

---

## Reranking

`src/lib/reranker.ts`

**Why a reranker on top of RRF?** RRF fuses two rank lists (vector + FTS) but never *reads* the articles. The reranker reads the first 2000 chars of each article body and makes a semantic-relevance judgment. This catches cases where vector similarity and keyword overlap both score high but the article is actually about something tangential. Cost: ~$0.0005 per query. Worth it.

Model: `gemini-3-flash-preview`, `temperature: 0.0`, `maxOutputTokens: 150`, timeout `RERANKER_TIMEOUT_MS = 8_000` ms.

The reranker scores each retrieved article 0–10 against the question. Prompt uses explicit score anchors:

```
0 = irrelevant
3 = tangential
5 = somewhat relevant
7 = relevant
10 = directly answers
```

Output is a JSON array of numbers.

`RERANKER_BODY_CHARS = 2000` — article body excerpt sent per article. This caps token spend but can reduce reranker quality on long articles.

**Graceful fallback**: on timeout or parse failure, returns the first `maxArticles` articles each assigned `relevanceScore: 5`. The pipeline never fails due to the reranker alone.

### `rerankWithCragRetry` — corrective RAG

`route.ts:176–270`. First call is normal reranking with `minScore = 4` (text) or `3` (visual). If the result is empty AND original retrieval was non-empty AND the signal hasn't aborted, one corrective retry runs:

```
reformulateQuery("Try broader search terms for: {question}")   → stage: "reformulate-retry"
embedQuery(broaderQuery)                                       → stage: "embed-retry"
hybridSearch(...) with same filters                            → stage: "retrieve-retry"
rerankArticles(..., minScore = 3 | 2)                          → stage: "rerank-retry"
```

Each retry stage is wrapped in `wrapStage` so errors carry their stage tag for log attribution and typed propagation.

Note: CRAG is **single-attempt**. If the retry also returns zero ranked articles, the pipeline proceeds to `generateAnswer` with an empty article list, which triggers the "not enough information" early return.

---

## Answer generation

`src/lib/answer-generator.ts`

Model: `gemini-3-flash-preview`, `temperature: 0.2`, `MAX_ANSWER_TOKENS = 4096`, `GENERATION_TIMEOUT_MS = 15_000` ms.

### Prompt shape

9-rule system prompt enforcing archive-only answers with `[Source N]` inline citations. Response format is a strict JSON object:

```json
{
  "answer": "Relevant sources: [Source 1, Source 3]\n\nActual answer text...",
  "follow_ups": ["question 1", "question 2", "question 3"]
}
```

The `answer` field must begin with `"Relevant sources: [...]"` — a chain-of-thought preamble that is **stripped before user presentation**. This is a soft CoT lever: the model thinks about which sources are relevant before writing, and the user only sees the refined answer.

### Skip-Gemini guard

`answer-generator.ts:227-240`. If `avgDistance > DIST_WEAK_MATCH (0.3)` AND `avgRerankerScore < RERANK_TANGENTIAL (5)`, the Gemini call is skipped entirely and a canned "not enough information" message is returned with `confidence: "low"`.

This saves ~$0.001 per query for clearly off-topic questions. It fires only when vector results exist — FTS-only paths bypass this check (no distance to compare against).

### Confidence computation

Thresholds were empirically calibrated against the 11 golden test cases in `tests/api/rag-golden-questions.json`. Switching embedding models requires re-calibrating all of them.

**FTS-only path** (no vector distance available):

- `avgRerankerScore >= 8` → `high`
- `avgRerankerScore >= 5` → `medium`
- else → `low`

**Vector-aware path**:

- `avgDistance < 0.26 AND avgRerankerScore >= 7 AND articleCount >= 2` → `high`
- `avgRerankerScore >= 8 AND articleCount >= 2` → `high` **(reranker rescues mediocre distance)**
- `avgDistance < 0.3 AND avgRerankerScore >= 5` → `medium`
- `avgRerankerScore >= 6` → `medium`
- else → `low`

The "reranker rescues mediocre distance" rule matters because the embedding only saw the first N chars of each article, but the reranker reads the first 2000 chars. A reranker score of 8+ means the fuller view confirmed relevance even when the truncated embedding view didn't — override the distance signal.

Named constants in `answer-generator.ts`: `DIST_STRONG_MATCH` (0.26), `DIST_WEAK_MATCH` (0.3), `RERANK_TANGENTIAL` (5), `RERANK_MEDIUM` (6), `RERANK_RELEVANT` (7), `RERANK_CONFIDENT` (8).

### Post-processing

1. Strip `"Relevant sources: ..."` preamble
2. Remove out-of-range `[Source N]` markers where `N` exceeds article count
3. Fix punctuation spacing from stripped markers via `/\s+([.,;:])/g`
4. Validate citations: if the LLM referenced sources but all were out-of-range, force `confidence: "low"`

### Streaming version

`generateAnswerStream` buffers the full JSON response before emitting. Documented reason: showing partial JSON tokens would expose raw syntax (`{"answer":...`) to users. After buffering, emits one `delta` event with cleaned text, then `done`. The UI displays a `ResearchFeed` component during the buffering wait to maintain perceived progress.

---

## Agent loop (complex path)

`src/lib/agent-loop.ts` + `src/lib/agent-tools.ts`

Model: `gemini-3-flash-preview` (same as other stages), `temperature: 0.2`, `MAX_OUTPUT_TOKENS = 4096`, `thinkingBudget: 0`.

`MAX_ROUNDS = 8` is the hard ceiling, but the system prompt instructs the model to gather sources in 2–3 rounds and write the answer by round 4. Exceeding the ceiling exits with a partial-answer warning.

### Loop mechanics

```
for round in 1..MAX_ROUNDS:
  if signal.aborted: return graceful timeout message
  response = generateContent(contents)
  if response.functionCalls:
    results = Promise.all(executeTool(call) for call in response.functionCalls)
    contents.push(response.parts, results)
    accumulateArticleMeta(results)
    emit("tool_call", "tool_result") events
    continue
  answerText = response.text
  break
```

### AbortSignal double-check

The signal is checked at the top of each round. The SDK also receives `abortSignal` in its config. Checking explicitly inside the loop ensures Node.js exits even if the SDK silently ignores the signal.

### Article metadata accumulation

As tools execute, their results populate an `articleLookup: Map<string, ArticleMeta>`. Post-loop, this map hydrates citations with `headline` and `date` metadata that wasn't in the model's final text response.

### Tool result truncation

Tool results are truncated before being appended to `contents`:

- `read_article` body: `MAX_BODY_CHARS_IN_CONTEXT = 3000` chars
- `search_archive` excerpt: `MAX_EXCERPT_CHARS_IN_CONTEXT = 300` chars

The full untruncated data lives in `articleLookup` for citation hydration. The truncation keeps rounds cheap without losing UI-facing data.

### The three tools

| Tool | Parameters | Returns |
|---|---|---|
| `search_archive` | `query` (required), `startDate?`, `endDate?`, `category?`, `limit?` (max 20) | `{ results: [{ id, headline, editionDate, category, summary, excerpt (500 chars), imageUrls }] }` |
| `read_article` | `articleId` (required) | `{ id, editionDate, category, headline, summary, byline, bodyPlain, imageUrls }` |
| `list_editions` | `startDate?`, `endDate?` | `{ editions: [{ date, articleCount }] }` — up to 50 |

`search_archive` calls `embedQuery` + `hybridSearch` under the hood — same retrieval stack as the simple pipeline, just packaged as a tool.

### Confidence scoring

- `toolCallCount === 0` → `low` (model gave up without searching)
- Answer contains "don't have enough information" → `low`
- `citations >= 3` → `high`
- `citations >= 1` → `medium`
- else → `low`

### Agent vs simple response shape differences

The agent path sets `retrievalTimeMs: 0`, `generationTimeMs: 0` in `meta` (timing is per-tool, not per-stage) and adds `agentSteps` and `agentToolCalls` counters. The answer cache and dedup are **both bypassed** for agent responses — answers are contextual enough that reuse would be misleading.

### Progress events

`onProgress` callback emits `{type, tool, round, args}` and `{type, tool, round, summary}` SSE events. Only wired on the streaming path.

---

## Conversation history

`src/lib/conversation-store.ts`

Backend: Neon table `ask_session_turns`.

```sql
CREATE TABLE ask_session_turns (
  id                BIGSERIAL PRIMARY KEY,
  session_id        TEXT NOT NULL,
  question          TEXT NOT NULL,
  answer            TEXT NOT NULL,           -- capped at 8000 chars
  cited_article_ids TEXT[] NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ask_session_turns_session_created
  ON ask_session_turns (session_id, created_at DESC);
```

**Window**: most recent 5 turns within 30 minutes (`MAX_TURNS = 5`, `TTL_MS = 30 * 60_000`). Query:

```sql
SELECT question, answer, cited_article_ids, created_at
FROM ask_session_turns
WHERE session_id = $1 AND created_at >= $sinceIso
ORDER BY created_at DESC LIMIT 5
```

Results are reversed to chronological order before returning.

**Answer truncation**: stored answers cap at `ANSWER_TRUNCATE_CHARS = 8000` with a `"\n[…truncated]"` marker.

**Graceful degradation**: every DB call is wrapped in try/catch with a warn log. If `DATABASE_URL` is unset (tests, fallback), `getSql()` returns `null` and all functions no-op. A failure to read history degrades to zero history, not a hard failure.

**Prompt threading** (`formatHistoryForPrompt`):

```
[Turn 1] Q: {question}
A: {answer}

[Turn 2] Q: {question}
A: {answer}
```

Prepended to the reformulator's input (pronoun resolution) and to both `generateAnswer` and `generateAnswerStream` user prompts (tone continuity).

### `persistTurnBounded` — the 1500ms cap

`route.ts:113-125`:

```typescript
await Promise.race([
  addConversationTurn(sessionId, question, answer, citedArticleIds),
  new Promise<void>((resolve) => setTimeout(resolve, 1500)),
]);
```

A slow Neon write never delays the user's final `done` event. The write continues in the background if the timer wins — `addConversationTurn` swallows its own errors so there's no unhandled rejection.

**Known risk**: if the Vercel function instance is frozen before the background write completes, the turn is dropped silently. The user's next follow-up arrives to an empty history (or partial, up to the last successful write). The 30-min TTL is the only recovery mechanism.

### Client-side session lifecycle

`useAskArchive.ts` mints a session ID via `readOrCreateSessionId()`, stored in `localStorage` under `owu-ask-session-id`. On mount, the hook calls `GET /api/ask/session?sessionId=...` to rehydrate from Neon; falls back to the localStorage thread archive on server failure or expired session.

A user can:

- Start a fresh thread (archives current, mints new sessionId)
- Clear a thread (`DELETE /api/ask/session` wipes Neon rows + removes from localStorage archive)

---

## Caching

### Answer cache — `src/lib/answer-cache.ts`

In-memory `Map<string, CacheEntry>`. Not shared across function instances.

| Parameter | Value |
|---|---|
| `MAX_ENTRIES` | 200 |
| `TTL_MS` | 1 hour |
| Key | `SHA-256(question.trim().toLowerCase() + "|" + JSON.stringify(filters))` |

**Exclusions**:

- `response.confidence === "low"` — not worth caching unreliable answers
- `response.meta?.complexity === "complex"` — agent path answers are contextual
- `conversationHistory.length > 0` — prior context would taint the cached answer

The cache is per-Vercel-function-instance; multiple instances will not share it. Effective hit rate depends on Vercel's routing consistency.

### Embedding LRU

100 entries, 5-min TTL, keyed on prefixed query text. MRU-promote on hit. Shared by the main pipeline and the agent loop's `search_archive` tool.

### Hybrid search LRU

50 entries, 5-min TTL, keyed on `JSON.stringify({q, l, v, c, s, e, oi})`. Short-circuits the double SQL round trip for repeated identical queries.

---

## Rate limiting

`src/lib/rate-limit.ts` + `middleware.ts`. Two independent layers.

| Layer | Bucket | Limit | Window |
|---|---|---|---|
| Middleware | `mw-ask` | 10 | 60 s |
| Route | `ask` | 10 | 60 s |
| Middleware | `mw-search` | 60 | 60 s |
| Middleware | `mw-general` | 120 | 60 s |

The middleware matcher is `["/api/ask", "/api/search", "/api/editions/:path*", "/api/weather"]`. The route-level limiter fires only for `/api/ask`.

### Primary store: Neon

Atomic upsert with window expiry check:

```sql
INSERT INTO api_rate_bucket (key, count, expires_at)
VALUES ($1, 1, now() + interval '60 seconds')
ON CONFLICT (key) DO UPDATE SET
  count = CASE WHEN api_rate_bucket.expires_at < now() THEN 1 ELSE api_rate_bucket.count + 1 END,
  expires_at = CASE WHEN api_rate_bucket.expires_at < now() THEN now() + interval '60 seconds' ELSE api_rate_bucket.expires_at END
RETURNING count, expires_at;
```

### Fallback: in-memory Map

Used when `DATABASE_URL` is unset or Neon call fails. Per-function-instance — under-counts across Vercel's multiple instances but prevents a Neon outage from disabling rate limiting entirely.

**Known weakness**: IP spoofing. `getClientIp` reads `x-forwarded-for` first header, falls back to `127.0.0.1`. Safe only if the upstream proxy strips untrusted headers before reaching the function.

---

## Budget & cost tracking

`src/lib/cost-tracker.ts`

**Daily budget**: `DAILY_BUDGET_USD = 0.5`. Global, not per-user.

**Token pricing** (approximate, pending final Google pricing):

| Model | Input | Output |
|---|---|---|
| `gemini-3-flash-preview` | $0.10/M | $0.40/M |
| `gemini-embedding-2-preview` | $0.025/M | $0/M |

**`checkDailyBudget()`**: reads `SELECT spent_usd FROM ai_spend_counter WHERE day = '$YYYY-MM-DD'`. Throws `DailyBudgetExceededError` if `spent >= 0.5`. On DB error, logs warning and returns without throwing — budget check is skipped rather than blocking on a Neon outage.

**`recordUsage()`**: called fire-and-forget (`void recordUsage(...)`) from all Gemini callers (reformulator, embedder, reranker, generator, agent-loop). Uses atomic increment:

```sql
INSERT INTO ai_spend_counter (day, spent_usd)
VALUES ($1, $2)
ON CONFLICT (day) DO UPDATE SET spent_usd = ai_spend_counter.spent_usd + EXCLUDED.spent_usd
```

Also emits a `level: "info"` JSON log line per call with model, tokens, and cost.

**`DailyBudgetExceededError`** carries `spentUsd` and `budgetUsd` fields for the operator log at route.ts:978.

### Known tradeoff

The budget is global. A single heavy user can exhaust the budget for everyone. There is no per-IP sub-accounting. This is intentional for a personal-archive project — different tradeoffs apply for a multi-tenant product.

---

## Concurrent request dedup

`src/lib/ask-dedup.ts`

Coalesces two identical `(ip, question, filters, sessionId)` POSTs that overlap in time so the second one piggybacks on the first instead of running the full pipeline twice.

### Key construction

Non-cryptographic 32-bit djb2 hash over `"${question}|${JSON.stringify(filters)}|${sessionId}"`, prefixed with IP:

```
"${ip}:${djb2Hash}"
```

`sessionId` is part of the key because piggybackers skip `addConversationTurn` — two different sessions sharing a dedup entry would leave one without history continuity and with the first requester's sessionId baked into the `done` event.

### Map + TTL eviction

- `inFlightAsk: Map<string, DedupEntry>` (module-level)
- `DedupEntry.promise` stores the racing `Promise.race([pipelinePromise, deadlinePromise])` so piggybackers inherit the same 30s deadline
- After the `finally` block, `setTimeout(() => inFlightAsk.delete(dedupId), DEDUP_TTL_MS)` evicts the entry
- `DEDUP_TTL_MS = 30_000` ms matches the global deadline

Eviction isn't immediate because slow piggybacking concurrent requests still need a window to read the cached body.

### Extract-once via `getOrExtract`

```typescript
async function getOrExtract(entry: DedupEntry): Promise<DedupExtracted> {
  if (!entry.extractPromise) {
    entry.extractPromise = (async () => {
      const response = await entry.promise;
      const body = await response.clone().json();
      // ...
    })();
  }
  return entry.extractPromise;
}
```

The extraction is cached as a **Promise**, not a settled value. All concurrent waiters share a single `response.clone().json()` call. A previous implementation caching the result had a race window where two waiters past the second check could both call `clone()` in parallel — fragile across runtimes.

### Collision note

djb2 is non-cryptographic and 32-bit, so collisions are possible. Impact is limited: a collision would piggyback two distinct requests on one pipeline, making one user see another's answer. Probability is extremely low for realistic traffic, and the `(ip, sessionId)` prefix makes cross-user collisions effectively impossible. No data corruption; at worst, a missed dedup.

### Streaming bypass

Streaming requests always run their own pipeline. A `ReadableStream` body can't be re-read by multiple waiters.

---

## Retrieval-shape telemetry

`src/lib/rerank-signals.ts`

Seven signals computed over the retrieved article set on every `/api/ask` request:

| Signal | Meaning |
|---|---|
| `avgVectorDist` | Mean cosine distance (lower = closer) for articles with vector hits |
| `vectorCount` | Count of articles from vector results |
| `bothCount` | Count appearing in both vector AND FTS |
| `ftsOnlyCount` | Count from FTS only |
| `vectorOnlyCount` | Count from vector only |
| `topThreeBothCount` | Of the top 3 articles, how many appear in both |
| `totalArticles` | Total retrieved count |

Emitted as a JSON log line at `level: "info"` (via `console.warn` to satisfy the ESLint `no-console` rule) with `stage: "retrieval-signals"`.

**Operator query**: `grep '"stage":"retrieval-signals"'` on stderr. Includes `requestId` so lines can be joined with other events for the same request.

**Historical note**: these signals once gated a reranker-bypass optimization that never fired in practice. All 11 golden test cases had `avgVectorDist > 0.20`, and no clean threshold separated legitimate good retrieval from prompt-injection payloads. The bypass was removed; the telemetry stayed. Future optimizations built on these signals can now be designed from real multi-run production data.

---

## Error taxonomy

All non-success responses use `askErrorJson()` which produces:

```json
{
  "kind": "<AskErrorKind>",
  "message": "<user-facing string>",
  "error": "<same as message — legacy alias>",
  "requestId": "...",
  "stage": "...",
  "cause": "...",
  "retryAfterSec": <number>
}
```

| Status | `kind` | Trigger | UI behavior |
|---|---|---|---|
| 400 | `bad_request` | Missing / empty / too-long question | Inline validation |
| 429 | `rate_limit` | Middleware or route rate limiter | Countdown (uses `retryAfterSec`) |
| 429 | `budget` | `DailyBudgetExceededError` or `QuotaExhaustedError` | "Daily limit reached, try tomorrow" |
| 500 | `server` | Unhandled `StageError`, unexpected throw | Retry CTA + requestId |
| 502 | `server` | `embedQuery` non-quota failure | Retry CTA |
| 504 | `timeout` | `DeadlineExceededError` or "Retrieval timeout" | "Try a simpler question" |

### Error classes

- **`DeadlineExceededError`** — carries `deadlineMs`. Intentionally not wrapped by `wrapStage` so it propagates with its type intact.
- **`StageError`** — wraps any stage-originated error with a `stage: string` field. The top-level catch unwraps `err.cause` to detect `QuotaExhaustedError` nested inside retry stages.
- **`DailyBudgetExceededError`** — carries `spentUsd` and `budgetUsd`.
- **`QuotaExhaustedError`** — from `embeddings.ts`.
- **`DbTimeoutError`** — from `db.ts`.

### The `kind` discriminator

Clients render per-kind UI without sniffing status codes. For example, the frontend maps:

- `timeout` → "Try a simpler question" + retry button
- `rate_limit` → countdown timer driven by `retryAfterSec`
- `budget` → "Daily limit reached, try tomorrow" (muted)
- `server` → "Something went wrong" + requestId for support

### Streaming error shape

Once SSE begins, HTTP status is always 200. Errors are emitted as SSE `error` events:

```
event: error
data: {"kind":"timeout","stage":"rerank","message":"...","requestId":"..."}
```

---

## Global deadline & timeouts

- `GLOBAL_DEADLINE_MS = 30_000` ms — Promise.race guarantees return within 30s regardless of downstream hangs
- `RETRIEVAL_TIMEOUT_MS = 10_000` ms — internal retrieval cap, fires before global deadline on hung DB calls
- `HYBRID_SEARCH_TIMEOUT_MS = 8_000` ms — the `raceWithTimeout` at the DB layer

Three layers of protection, each smaller than the outer. A stuck query at any layer is unblocked within its own budget.

### Interaction with dedup

The dedup entry stores the racing promise (including the deadline race), not the raw pipeline promise. Piggybackers inherit the same 30s deadline.

### Test hooks

- `_setGlobalDeadlineForTests(ms)` — set sub-second deadlines in tests
- `_setRetrievalTimeoutForTests(ms)` — same for retrieval timeout
- `_clearAskDedupForTests()` — wipe the dedup map between tests

---

## Frontend surface

### `src/features/ask-archive/hooks/useAskArchive.ts`

The hook owns all I/O and exposes a pure `askReducer` for state transitions.

On mount:

1. Read `owu-ask-session-id` from localStorage
2. Call `GET /api/ask/session?sessionId=...` to rehydrate turns from Neon
3. Fall back to localStorage thread archive on HTTP failure / expired session

On `submit(question)`:

1. Generate a `turnId`
2. Dispatch `APPEND_USER` (creates a streaming turn, freezes any prior streaming turn)
3. Call `streamQuestion(turnId, question)`

### SSE dispatch

The `streamQuestion` function POSTs to `/api/ask?stream=1` and reads the response `ReadableStream`, chunking on `\n\n` SSE frame boundaries.

| Event | Reducer action |
|---|---|
| `stage` | `TURN_STAGE` — shows "Thinking…", "Searching archive…", etc. |
| `metadata` | `TURN_META` — populates source articles before generation |
| `tool_call` / `tool_result` | `TURN_STAGE { stage: "Researching…" }` |
| `delta` | `TURN_DELTA` — appends text, removes stage pill |
| `done` | `TURN_DONE` — freezes turn with final answer + citations + confidence |
| `error` | `TURN_ERROR` — sets `errorKind`, `errorMessage` |

### Replay-as-deltas (cache & agent hits)

When a `done` event arrives without any preceding `delta` events (agent path and cache hit both produce single-delta or direct `done`), `replayAnswerAsDeltas` simulates word-by-word streaming purely client-side (2-word chunks at 16ms intervals).

This is a UX-only trick — the server sends the answer as one block, but the client animates it. Prevents a jarring "answer appears instantly" effect that users perceive as low-quality.

### SourceReader drawer

`src/features/ask-archive/components/SourceReader.tsx` — a portal-rendered drawer that fetches `GET /api/editions/${source.editionDate}` and finds the article by ID client-side. Caches fetched editions by date in a `Map` ref. Integrates with browser history via `pushState` sentinel so browser-back closes the drawer.

---

## Testing

### `tests/api/ask-route.test.ts` — 70 tests

All external dependencies mocked via `vi.mock`. Coverage confirmed in the file:

- Input validation (400s for missing/empty/long questions)
- Each stage's failure → correct status + stage tag + requestId
- Quota exhaustion → 429 + `Retry-After: 3600` + `cause: "quota_exhausted"`
- Vector-only fallback when `hybridSearch` throws
- `bodySnippet` truncation at 300 chars with Unicode ellipsis
- Reformulated vs original query routing (reformulated goes to `embedQuery`, original to `generateAnswer`)
- Global deadline: 504 + `stage: "deadline"` fires near the configured timeout
- Retrieval timeout: 504 + `stage: "retrieve"` fires before the global deadline
- Dedup: 2 and 3 concurrent identical requests run the pipeline once
- Dedup: different questions / filters / sessionIds — no dedup
- Dedup fall-through when in-flight rejects
- `getOrExtract` exactly-once extraction across concurrent waiters
- SSE ordering: stages × 4 → metadata → deltas → done
- SSE error events carry `stage`, HTTP stays 200

### `tests/api/rag-golden-questions.test.ts`

Guarded by `describe.skipIf(!process.env.RUN_RAG_GOLDEN)`. Reads `tests/api/rag-golden-questions.json` — a catalog of questions with expected characteristics (`minCitations`, `keywordsAny`, `forbiddenInAnswer`, `confidenceMin/Max`, `mode`, `expectError`).

Includes prompt-injection cases (`forbiddenInAnswer`) to verify the LLM doesn't echo adversarial overrides.

Hits the **live pipeline** (only rate limiter is mocked). Used in a nightly CI workflow.

### Baseline drift detection

`rag-golden-baseline.json` is compared in `afterAll`.

**Hard regressions** (fail the suite, preserve the prior baseline):

- Status code change
- Confidence drop ≥ 2 levels
- Citations halved

**Soft warnings** (pass, but logged):

- Confidence drift by 1 level
- Citation drop without halving
- `method` (simple/agent) change

On no regressions, the baseline is overwritten. This keeps the baseline current without letting silent regressions slip through.

---

## Operator runbook

All logs are JSON lines via `console.warn` or `console.error` (ESLint permits only those two; a `level` field carries the semantic distinction).

| Question | Grep pattern |
|---|---|
| Is this request slow? | `grep '"requestId":"<id>"'` — chain stage events |
| What was the retrieval quality? | `grep '"stage":"retrieval-signals"'` — includes `avgVectorDist`, `bothCount`, `topThreeBothCount` |
| Budget blown? | `grep '"msg":"daily budget exceeded"'` or `grep '"module":"cost-tracker"' \| grep '"level":"info"'` |
| Why did this 504? | `grep '"kind":"timeout"'` — then look at `stage` (deadline, retrieve, etc.) |
| Reranker fallback fired? | `grep '"msg":"reranker timed out"'` |
| CRAG retry triggered? | `grep '"stage":"crag-retry"'` (or `reformulate-retry`/`embed-retry`/...) |
| Hybrid search fell back to vector? | `grep '"msg":"hybrid search failed — falling back"'` |
| Quota exhausted? | `grep '"msg":"quota exhausted"'` |
| Agent hit max rounds? | `grep '"msg":"agent hit MAX_ROUNDS"'` |
| Conversation store degraded? | `grep '"module":"conversation-store"' \| grep '"level":"warn"'` |

---

## Known limitations

Each entry states the limitation and the *accepted tradeoff*. These are intentional decisions, not TODO items.

1. **Neon orphaned queries**. `raceWithTimeout` protects callers; orphan queries continue server-side. **Accepted because** Neon's serverless driver has no `AbortSignal` support. At current traffic it's not a pool-pressure problem; at 100× traffic we'd revisit the driver choice.
2. **Per-instance answer cache**. Vercel runs multiple instances; popular questions recompute per cold instance. **Accepted because** a central Redis would add infra complexity for a portfolio project. A warm instance serves ~95% of repeat queries in the one-hour TTL window.
3. **Rate-limit in-memory fallback under-counts**. In-memory fallback counts per instance, so effective per-IP limit is `10 × instance_count` during Neon outages. **Accepted because** the fallback only engages when Neon is unreachable; a brief 5-minute Neon blip lets through at most ~50 requests per IP vs. the usual 10.
4. **Dedup streaming bypass**. Streaming path always runs its own pipeline. **Accepted because** a `ReadableStream` body can't be re-read by multiple waiters. The frontend aborts prior requests on new submit, bounding the cost to one duplicate at most.
5. **CRAG single-attempt**. If the corrective retry also returns zero, the pipeline serves "not enough information." **Accepted because** a second retry would just reformulate on reformulated input, which degrades quickly. Zero results after one CRAG attempt is a real "not in the archive" signal, not a retrieval bug.
6. **Hardcoded thresholds for `gemini-embedding-2-preview`**. All confidence constants are calibrated for this specific embedding model. **Accepted because** re-calibration is cheap (~30 min against the golden set) and model upgrades should be deliberate events with their own PRs.
7. **Multimodal embedding atomicity**. `embedDocuments` treats the batch as atomic — one multimodal failure throws the whole call. **Accepted because** splitting the batch on error would double our API calls on the common case. See `docs/issues/` for the detailed analysis.
8. **`migrate-rag-improvements.mjs` follow-up required**. The migration drops the HNSW index deliberately. **Accepted because** bundling the re-embed step would make the migration un-cancelable. Follow up with `npm run db:embed:force` then `scripts/db/recreate-hnsw-index.mjs`.
9. **Global daily budget**. `$0.50/day` applies to all users. **Accepted because** this is a personal-archive portfolio project, not a multi-tenant product. Per-user accounting would require auth and user IDs.
10. **Silent turn drops** if Neon > 1500 ms and the function instance freezes. **Accepted because** the alternative (blocking `done` event on DB write) would make the UI stutter for every user. Recovery is TTL-based — the 30-min window forgives occasional drops.
11. **Agent `MAX_ROUNDS = 8` but system prompt says "4 rounds."** Hard ceiling is 8; the prompt steers toward 4. **Accepted because** giving the model room to recover from bad tool calls occasionally is better than a hard 4-round cap. Round-8 exits log a warning for post-hoc analysis.
12. **Non-cryptographic dedup hash (djb2 32-bit)**. Collisions possible at scale. **Accepted because** the `(ip, sessionId)` prefix makes cross-user collisions negligible. Worst case is a missed dedup (duplicate pipeline run), never data corruption.

---

## Start here

If you're new and need to make a change, read these in order:

1. `src/app/api/ask/route.ts` — the orchestrator. Every stage is visible at the top.
2. `src/types/index.ts` — the `AskResponse`, `AskErrorKind`, and `Citation` types the endpoint emits.
3. `src/lib/answer-generator.ts` — the end of the pipeline where most product decisions land (prompt shape, confidence thresholds, citation parsing).
4. `tests/api/ask-route.test.ts` — 70 tests describe the contract better than any doc can.

For the frontend, start at `src/features/ask-archive/hooks/useAskArchive.ts`. The reducer (`askReducer.ts`) and component tree are pure consumers of the hook's state.
