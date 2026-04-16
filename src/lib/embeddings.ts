/**
 * Embedding Utility
 *
 * Shared module for generating text embeddings via Google's gemini-embedding-2-preview model.
 * Used by both the seed/embed script (build-time) and the /api/ask route (query-time).
 *
 * Gemini Embedding 2 uses inline text prefixes for task instructions instead of taskType enums:
 *   - Documents: "title: {headline} | text: {content}"
 *   - Queries:   "task: search result | query: {question}"
 */

import { getGeminiClient } from "@/src/lib/gemini-client";

const EMBEDDING_MODEL = "gemini-embedding-2-preview";
const EMBEDDING_DIMS = 768;
const MAX_BATCH_SIZE = 100; // API limit per request
// Query embed budget: 10s. Previously 5s, but under Gemini load (or
// adjacent rapid calls from the rest of the /api/ask pipeline) the
// p95 query-embed latency spikes to 5-8s, which blew through the old
// budget and raised spurious 502s. 10s is still well inside the 30s
// global deadline and consistent with the 30s document-batch budget
// (where batches are up to 100 items).
const EMBED_TIMEOUT_MS = 10_000;
const EMBED_DOCUMENTS_TIMEOUT_MS = 30_000; // per-batch budget for document embedding
const MAX_EMBEDDING_CHARS = 30_000; // ~7,500 tokens; conservative buffer under 8,192 token API limit

/**
 * Thrown when an embedding call exceeds its timeout budget. Callers should
 * treat this as a transient / retry-worthy error, distinct from permanent
 * failures like bad API keys or quota exhaustion.
 */
export class EmbedTimeoutError extends Error {
    constructor(
        public readonly op: string,
        public readonly timeoutMs: number,
    ) {
        super(`Embedding operation timed out: ${op} after ${timeoutMs}ms`);
        this.name = "EmbedTimeoutError";
    }
}

/**
 * Thrown when Gemini returns a 429 / RESOURCE_EXHAUSTED quota error.
 * Distinct from EmbedTimeoutError so callers can early-abort instead of
 * retrying endlessly. /api/ask returns 429 + Retry-After; seed/embed
 * scripts break out of their batch loops. See docs/issues/0028.
 */
export class QuotaExhaustedError extends Error {
    constructor(
        public readonly op: string,
        public readonly cause?: unknown,
    ) {
        super(`Gemini API quota exhausted (${op})`);
        this.name = "QuotaExhaustedError";
    }
}

/**
 * Detect a Gemini RESOURCE_EXHAUSTED / 429 error across the various shapes
 * the SDK might surface (raw fetch error, JSON-stringified error body,
 * structured object). Returns true if any signal matches.
 */
function isQuotaError(err: unknown): boolean {
    if (!err) return false;
    const e = err as {
        code?: number;
        status?: string;
        error?: { code?: number; status?: string };
    };
    if (e.code === 429) return true;
    if (e.status === "RESOURCE_EXHAUSTED") return true;
    if (e.error?.code === 429) return true;
    if (e.error?.status === "RESOURCE_EXHAUSTED") return true;
    const msg = err instanceof Error ? err.message : String(err);
    return /RESOURCE_EXHAUSTED|"code"\s*:\s*429|exceeded your current quota/i.test(msg);
}

/**
 * Wrap an embedContent invocation with a hard timeout. Uses
 * AbortController (so the SDK can cancel the underlying fetch if it
 * honors the signal) PLUS Promise.race against a timeoutPromise so we
 * never block the caller even if the SDK ignores the signal. On fire,
 * throws EmbedTimeoutError.
 */
async function embedWithTimeout<T>(
    op: string,
    fn: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(new EmbedTimeoutError(op, timeoutMs));
        }, timeoutMs);
    });
    try {
        return await Promise.race([fn(controller.signal), timeoutPromise]);
    } catch (err) {
        // Convert Gemini quota errors into a typed error so callers (route,
        // seed scripts) can early-abort instead of retrying endlessly.
        if (isQuotaError(err)) {
            throw new QuotaExhaustedError(op, err);
        }
        throw err;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

// ─── Quota Retry Helper ───────────────────────────────────────
// Some Gemini quota errors are per-minute RPM, not daily — e.g. a
// parallel batch run tripping the RPM bucket in the first few seconds.
// A short exponential backoff often succeeds on those without burning
// extra calls; a daily-quota error will just fall through the retries
// and surface as normal. Scoped to embedDocuments (batch path) because
// the live query path must stay snappy. Closes docs/issues/0028.

let QUOTA_RETRY_DELAYS_MS: number[] = [1_000, 2_000, 4_000];

// Test hook: lets unit tests run the non-retry paths without sitting
// through 7 real seconds of backoff. Pass [] to disable retries; pass
// a shorter list to shrink delays.
export function _setQuotaRetryDelaysForTests(delays: number[]): void {
    QUOTA_RETRY_DELAYS_MS = delays;
}

async function retryOnQuota<T>(op: string, fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= QUOTA_RETRY_DELAYS_MS.length; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (!(err instanceof QuotaExhaustedError) || attempt === QUOTA_RETRY_DELAYS_MS.length) {
                throw err;
            }
            const delayMs = QUOTA_RETRY_DELAYS_MS[attempt];
            console.warn(
                JSON.stringify({
                    level: "warn",
                    module: "embeddings",
                    op,
                    msg: "quota exhausted, backing off",
                    attempt: attempt + 1,
                    delayMs,
                }),
            );
            await sleep(delayMs);
        }
    }
    throw lastErr;
}

// ─── Query Embedding Cache ─────────────────────────────────────
// Simple TTL cache to avoid redundant API calls for repeated queries.

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_SIZE = 100;

const queryCache = new Map<string, { embedding: number[]; ts: number }>();

function getCachedEmbedding(key: string): number[] | null {
  const entry = queryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    queryCache.delete(key);
    return null;
  }
  // Promote to most-recently-used (Map preserves insertion order)
  queryCache.delete(key);
  queryCache.set(key, entry);
  return entry.embedding;
}

function setCachedEmbedding(key: string, embedding: number[]): void {
  // Evict oldest entries if at capacity
  if (queryCache.size >= CACHE_MAX_SIZE) {
    const oldest = queryCache.keys().next().value;
    if (oldest !== undefined) queryCache.delete(oldest);
  }
  queryCache.set(key, { embedding, ts: Date.now() });
}

// ─── Document Embedding ────────────────────────────────────────

/**
 * Embed multiple inputs for document storage. Handles batching internally.
 * Returns an array of embedding vectors (768-dim each), parallel to the input array.
 *
 * Text-only inputs are batched; multimodal inputs (with imageBase64) are sent
 * individually due to the Gemini API 6-image-per-request limit. Results are
 * reassembled in original input order.
 *
 * Inputs should already be formatted with the document prefix via buildEmbeddingInput().
 */
export async function embedDocuments(inputs: EmbedInput[]): Promise<number[][]> {
  if (inputs.length === 0) return [];

  const client = getGeminiClient();

  // Split into text-only (batchable) and multimodal (sent individually due to 6-image API limit)
  const textIndices: number[] = [];
  const imageIndices: number[] = [];
  for (let i = 0; i < inputs.length; i++) {
    if (inputs[i].imageBase64) {
      imageIndices.push(i);
    } else {
      textIndices.push(i);
    }
  }

  const textOnly = textIndices.map((i) => inputs[i]);
  const withImages = imageIndices.map((i) => inputs[i]);

  // Batch text-only embeddings
  const textEmbeddings: number[][] = [];
  for (let i = 0; i < textOnly.length; i += MAX_BATCH_SIZE) {
    const batch = textOnly.slice(i, i + MAX_BATCH_SIZE);

    const response = await retryOnQuota("embedDocuments.textBatch", () =>
      embedWithTimeout(
        "embedDocuments.textBatch",
        (signal) =>
          client.models.embedContent({
            model: EMBEDDING_MODEL,
            contents: batch.map((inp) => ({ parts: [{ text: inp.text }] })),
            config: {
              outputDimensionality: EMBEDDING_DIMS,
              abortSignal: signal,
            },
          }),
        EMBED_DOCUMENTS_TIMEOUT_MS,
      ),
    );

    if (!response.embeddings || response.embeddings.length !== batch.length) {
      throw new Error(
        `Embedding response mismatch: expected ${batch.length}, got ${response.embeddings?.length ?? 0}`,
      );
    }

    for (const emb of response.embeddings) {
      if (!emb.values || emb.values.length !== EMBEDDING_DIMS) {
        throw new Error(
          `Invalid embedding dimensions: expected ${EMBEDDING_DIMS}, got ${emb.values?.length ?? 0}`,
        );
      }
      textEmbeddings.push(emb.values);
    }

    if (i + MAX_BATCH_SIZE < textOnly.length) {
      await sleep(200);
    }
  }

  // Process multimodal embeddings individually. If any image fails, the
  // throw propagates out of this loop and out of embedDocuments — callers
  // must handle the batch as a whole (atomic semantics). See docs/issues
  // for the "multimodal partial-failure atomicity" finding.
  const imageEmbeddings: number[][] = [];
  for (let idx = 0; idx < withImages.length; idx++) {
    const inp = withImages[idx];
    let response;
    try {
      response = await retryOnQuota("embedDocuments.multimodal", () =>
        embedWithTimeout(
          "embedDocuments.multimodal",
          (signal) =>
            client.models.embedContent({
              model: EMBEDDING_MODEL,
              contents: [{
                parts: [
                  { text: inp.text },
                  { inlineData: { mimeType: inp.imageMimeType || "image/jpeg", data: inp.imageBase64! } },
                ],
              }],
              config: {
                outputDimensionality: EMBEDDING_DIMS,
                abortSignal: signal,
              },
            }),
          EMBED_DOCUMENTS_TIMEOUT_MS,
        ),
      );
    } catch (err) {
      // Re-throw with context so operators know WHERE the partial failure
      // landed — helps distinguish "batch-wide outage" from "one bad image".
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Multimodal embedding failed on image ${idx + 1} of ${withImages.length}: ${msg}`,
      );
    }

    if (!response.embeddings || response.embeddings.length !== 1) {
      throw new Error(
        `Failed to generate multimodal embedding for image ${idx + 1} of ${withImages.length}`,
      );
    }
    const emb = response.embeddings[0];
    if (!emb.values || emb.values.length !== EMBEDDING_DIMS) {
      throw new Error(
        `Invalid embedding dimensions: expected ${EMBEDDING_DIMS}, got ${emb.values?.length ?? 0}`,
      );
    }
    imageEmbeddings.push(emb.values);
    await sleep(200);
  }

  // Invariant check before reassembly: each branch must return exactly as
  // many vectors as we asked for. If this fires, there's a programming
  // error somewhere (not just a transient failure); surfacing it loudly
  // is correct because silently reassembling a partially-filled array
  // would poison retrieval downstream.
  if (textEmbeddings.length !== textIndices.length) {
    throw new Error(
      `embedDocuments text branch length mismatch: ${textEmbeddings.length}/${textIndices.length}`,
    );
  }
  if (imageEmbeddings.length !== imageIndices.length) {
    throw new Error(
      `embedDocuments image branch length mismatch: ${imageEmbeddings.length}/${imageIndices.length}`,
    );
  }

  // Reassemble in original input order
  const result: number[][] = new Array(inputs.length);
  for (let i = 0; i < textIndices.length; i++) {
    result[textIndices[i]] = textEmbeddings[i];
  }
  for (let i = 0; i < imageIndices.length; i++) {
    result[imageIndices[i]] = imageEmbeddings[i];
  }

  return result;
}

// ─── Query Embedding ───────────────────────────────────────────

/**
 * Embed a single query for retrieval. Uses the "task: search result" prefix
 * format required by gemini-embedding-2-preview. Includes a 5s timeout and
 * a short-lived LRU cache for repeated queries.
 */
export async function embedQuery(
  question: string,
  opts: { signal?: AbortSignal } = {},
): Promise<number[]> {
  // Early-exit on already-aborted signal so callers with an expired
  // deadline don't dispatch a doomed SDK call. Mirrors hybridSearch's
  // early-exit (db.ts) for symmetry across the pipeline.
  if (opts.signal?.aborted) {
    throw new Error("embedQuery: signal already aborted");
  }

  const prefixed = `task: search result | query: ${question}`;

  // Check cache first
  const cached = getCachedEmbedding(prefixed);
  if (cached) return cached;

  const client = getGeminiClient();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);

  // Combine outer request signal with the internal 5s timeout.
  const combinedSignal = opts.signal
    ? AbortSignal.any([opts.signal, controller.signal])
    : controller.signal;

  try {
    const response = await client.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: [{ parts: [{ text: prefixed }] }],
      config: {
        outputDimensionality: EMBEDDING_DIMS,
        abortSignal: combinedSignal,
      },
    });

    clearTimeout(timeout);

    if (!response.embeddings || response.embeddings.length !== 1) {
      throw new Error("Failed to generate query embedding");
    }

    const values = response.embeddings[0].values;
    if (!values || values.length !== EMBEDDING_DIMS) {
      throw new Error(
        `Invalid query embedding dimensions: expected ${EMBEDDING_DIMS}, got ${values?.length ?? 0}`,
      );
    }

    setCachedEmbedding(prefixed, values);
    return values;
  } catch (err) {
    clearTimeout(timeout);
    // Detect Gemini quota exhaustion and surface as a typed error so
    // /api/ask can return 429 + Retry-After instead of an opaque 502.
    if (isQuotaError(err)) {
      throw new QuotaExhaustedError("embedQuery", err);
    }
    throw err;
  }
}

// ─── Text Building ─────────────────────────────────────────────

/**
 * Build the text string to embed for an article.
 * Uses the "title: ... | text: ..." prefix format for gemini-embedding-2-preview.
 * Prepends contextual preamble (edition date, category) for better retrieval.
 */
export function buildEmbeddingText(article: {
  headline: string;
  byline?: string | null;
  body_plain: string;
  edition_date?: string | null;
  category?: string | null;
  summary?: string | null;
  image_caption?: string | null;
}): string {
  const bodyParts: string[] = [];

  // Contextual preamble
  if (article.edition_date || article.category) {
    const ctx = [
      "From The Transcript Archive (Ohio Wesleyan University newspaper)",
      article.edition_date,
      article.category ? `${article.category} section` : null,
    ]
      .filter(Boolean)
      .join(", ");
    bodyParts.push(ctx + ".");
  }

  if (article.byline) bodyParts.push(article.byline);
  // Summary (article lede) — most semantically dense sentence, prepended for prominence
  if (article.summary) bodyParts.push(article.summary);
  // Image caption — gives visual articles semantic signal from photo content
  if (article.image_caption) bodyParts.push(`[Photo: ${article.image_caption}]`);
  if (article.body_plain) bodyParts.push(article.body_plain);

  const body = bodyParts.join("\n\n").trim();
  const title = article.headline || "(untitled)";

  // Gemini Embedding 2 document format
  const full = `title: ${title} | text: ${body || "(empty article)"}`;

  // Guard against exceeding the embedding model's 8,192-token input limit
  if (full.length > MAX_EMBEDDING_CHARS) {
    const prefix = `title: ${title} | text: `;
    const maxBody = MAX_EMBEDDING_CHARS - prefix.length;
    return prefix + body.slice(0, Math.max(0, maxBody));
  }

  return full;
}

// ─── Multimodal Input ─────────────────────────────────────────

export interface EmbedInput {
  text: string;
  imageBase64?: string;
  imageMimeType?: string;
}

/**
 * Build the embedding input for an article — text + optional image.
 */
export function buildEmbeddingInput(article: {
  headline: string;
  byline?: string | null;
  body_plain: string;
  edition_date?: string | null;
  category?: string | null;
  summary?: string | null;
  image_caption?: string | null;
  imageBase64?: string;
  imageMimeType?: string;
}): EmbedInput {
  const text = buildEmbeddingText(article);
  if (article.imageBase64) {
    return {
      text,
      imageBase64: article.imageBase64,
      imageMimeType: article.imageMimeType || "image/jpeg",
    };
  }
  return { text };
}

// ─── Utilities ─────────────────────────────────────────────────

/** Check whether a Gemini API key is available (without throwing). */
export function hasApiKey(): boolean {
  return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
}

export { EMBEDDING_MODEL, EMBEDDING_DIMS };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
