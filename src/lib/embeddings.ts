/**
 * Embedding Utility
 *
 * Shared module for generating embeddings via Voyage AI, used by the index
 * build (documents) and the /api/ask route (queries).
 *
 *   - Text chunks: voyage-context-4. Each chunk is embedded in the context
 *     of its whole article: an article goes in as one list, a header line
 *     (headline, date, section, byline) followed by its chunks, and the
 *     header's own vector is dropped.
 *   - Photos: voyage-multimodal-3.5, caption text and image together.
 *   - Queries: embedded with whichever model built the vectors they search,
 *     so a photo search and a text search each get their own query vector.
 *
 * Voyage takes `input_type` ("query" / "document") instead of text prefixes.
 */

import { isQuotaError, retryOnQuota } from "@/src/lib/model-errors";
import { executeTrackedEmbeddingCall, type VoyageUsage } from "@/src/lib/cost-tracker";
import {
  RAG_EMBEDDING_DIMS,
  RAG_EMBEDDING_MODEL,
  RAG_IMAGE_EMBEDDING_INPUT_VERSION,
  RAG_IMAGE_EMBEDDING_MODEL,
  RAG_QUERY_EMBEDDING_INPUT_VERSION,
  RAG_TEXT_EMBEDDING_INPUT_VERSION,
} from "@/src/lib/rag-model-config";
import { createHash } from "crypto";
import { isRagEvaluationMode } from "@/src/lib/rag-evaluation";

const EMBEDDING_MODEL = RAG_EMBEDDING_MODEL;
const IMAGE_EMBEDDING_MODEL = RAG_IMAGE_EMBEDDING_MODEL;
const EMBEDDING_DIMS = RAG_EMBEDDING_DIMS;
const EMBEDDING_INPUT_VERSION = RAG_TEXT_EMBEDDING_INPUT_VERSION;
const IMAGE_EMBEDDING_INPUT_VERSION = RAG_IMAGE_EMBEDDING_INPUT_VERSION;

const VOYAGE_API_URL = "https://api.voyageai.com/v1";
// Query embed budget: well inside the 55s global deadline.
const EMBED_TIMEOUT_MS = 10_000;
const EMBED_DOCUMENTS_TIMEOUT_MS = 60_000; // per request
const MAX_EMBEDDING_CHARS = 30_000; // keeps one input far below the 32K-token context

/**
 * voyage-context-4 takes at most 32K tokens per request (without server-side
 * chunking), 1,000 documents and 16K chunks. Tokens are estimated at three
 * characters each, below the usual four, so OCR noise that tokenizes badly
 * still fits.
 */
const CONTEXT_REQUEST_TOKEN_BUDGET = 24_000;
const CONTEXT_REQUEST_MAX_DOCUMENTS = 1_000;
const CHARS_PER_TOKEN_ESTIMATE = 3;
/** Photos per voyage-multimodal-3.5 request: keeps the body to a few MB. */
const MULTIMODAL_BATCH_SIZE = 16;
/**
 * Pacing estimate for one photo (Voyage counts 560 pixels as a token, so
 * about 1.7M pixels). The response's usage replaces it.
 */
const IMAGE_TOKEN_ESTIMATE = 3_000;

/**
 * Thrown when an embedding call exceeds its timeout budget. Callers should
 * treat this as a transient / retry-worthy error, distinct from permanent
 * failures like bad API keys or quota exhaustion.
 */
export class EmbedTimeoutError extends Error {
  constructor(
    public readonly op: string,
    public readonly timeoutMs: number
  ) {
    super(`Embedding operation timed out: ${op} after ${timeoutMs}ms`);
    this.name = "EmbedTimeoutError";
  }
}

/**
 * Thrown when a model provider returns a 429 quota error. Distinct from
 * EmbedTimeoutError so callers can early-abort instead of retrying
 * endlessly. /api/ask returns 429 + Retry-After; build scripts break out of
 * their batch loops. See docs/issues/0028.
 */
export class QuotaExhaustedError extends Error {
  constructor(
    public readonly op: string,
    public readonly cause?: unknown
  ) {
    super(`Model API quota exhausted (${op})`);
    this.name = "QuotaExhaustedError";
  }
}

/** A non-2xx Voyage response. `status` and `headers` let the quota helpers classify it. */
export class VoyageHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly headers: Headers,
    body: string
  ) {
    super(`Voyage HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = "VoyageHttpError";
  }
}

// ─── Request Pacing ────────────────────────────────────────────
// Voyage limits each model per minute; an account without a payment method
// gets 3 requests and 10K tokens. Long jobs set VOYAGE_MAX_RPM and
// VOYAGE_MAX_TPM so each request waits for room in the window instead of
// tripping the limit. Unset, nothing waits.

const PACE_WINDOW_MS = 60_000;
/** Below the token limit, because the window holds estimates until a response settles them. */
const PACE_TOKEN_HEADROOM = 0.9;
const paceWindows = new Map<string, Array<{ at: number; tokens: number }>>();

export function voyagePaceLimits(): { rpm: number; tpm: number } | null {
  const rpm = Number(process.env.VOYAGE_MAX_RPM);
  const tpm = Number(process.env.VOYAGE_MAX_TPM);
  if (!(rpm > 0) && !(tpm > 0)) return null;
  return {
    rpm: rpm > 0 ? rpm : Infinity,
    tpm: tpm > 0 ? Math.floor(tpm * PACE_TOKEN_HEADROOM) : Infinity,
  };
}

export function _resetVoyagePaceForTests(): void {
  paceWindows.clear();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Wait until one more request of about `tokens` fits this model's window; returns its slot. */
async function acquirePace(
  model: string,
  tokens: number,
  signal?: AbortSignal
): Promise<{ at: number; tokens: number } | null> {
  const limits = voyagePaceLimits();
  if (!limits) return null;
  const window = paceWindows.get(model) ?? [];
  paceWindows.set(model, window);
  for (;;) {
    const now = Date.now();
    while (window.length > 0 && now - window[0].at >= PACE_WINDOW_MS) window.shift();
    const used = window.reduce((sum, slot) => sum + slot.tokens, 0);
    // A request bigger than the whole budget still goes, alone in the window.
    if (window.length < limits.rpm && (used + tokens <= limits.tpm || window.length === 0)) {
      const slot = { at: now, tokens };
      window.push(slot);
      return slot;
    }
    await sleep(window[0].at + PACE_WINDOW_MS - now + 50, signal);
  }
}

/** POST to a Voyage endpoint under a hard timeout. */
async function voyagePost<T extends { usage?: VoyageUsage }>(
  op: string,
  endpoint: string,
  body: { model: string } & Record<string, unknown>,
  timeoutMs: number,
  outerSignal?: AbortSignal,
  estimatedTokens = 0
): Promise<T> {
  const apiKey = process.env.VOYAGE_API_KEY?.trim();
  if (!apiKey) throw new Error("VOYAGE_API_KEY is not set.");
  const slot = await acquirePace(body.model, estimatedTokens, outerSignal);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = outerSignal
    ? AbortSignal.any([outerSignal, controller.signal])
    : controller.signal;
  try {
    const res = await fetch(`${VOYAGE_API_URL}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const error = new VoyageHttpError(res.status, res.headers, await res.text());
      throw res.status === 429 ? new QuotaExhaustedError(op, error) : error;
    }
    const json = (await res.json()) as T;
    if (slot && json.usage) slot.tokens = json.usage.total_tokens;
    return json;
  } catch (err) {
    // Our own timer, not the caller's deadline.
    if (controller.signal.aborted && !outerSignal?.aborted) {
      throw new EmbedTimeoutError(op, timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function checkedVector(values: unknown, op: string): number[] {
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMS) {
    throw new Error(
      `Invalid embedding dimensions in ${op}: expected ${EMBEDDING_DIMS}, got ${Array.isArray(values) ? values.length : 0}`
    );
  }
  return values as number[];
}

interface ContextualizedResponse {
  data?: Array<{ index: number; data?: Array<{ index: number; embedding: number[] }> }>;
  usage?: VoyageUsage;
}

interface MultimodalResponse {
  data?: Array<{ index: number; embedding: number[] }>;
  usage?: VoyageUsage;
}

// ─── Quota Retry Helper ───────────────────────────────────────
// The loop itself lives in model-errors so every live model call in the
// pipeline backs off the same way. Re-exported here because this is the
// module callers and test mocks already reach for. The batch delays stay
// longer than the live ones: an index build has no request deadline.

let QUOTA_RETRY_DELAYS_MS: number[] = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000];

// Test hook: lets unit tests run the non-retry paths without sitting
// through real backoff. Pass [] to disable retries; pass a shorter list
// to shrink delays.
export function _setQuotaRetryDelaysForTests(delays: number[]): void {
  QUOTA_RETRY_DELAYS_MS = delays;
}

export { retryOnQuota };

// ─── Query Embedding Cache ─────────────────────────────────────
// Simple TTL cache to avoid redundant API calls for repeated queries.

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_SIZE = 100;

const queryCache = new Map<string, { embedding: number[]; ts: number }>();

function getCachedEmbedding(key: string): number[] | null {
  if (isRagEvaluationMode()) return null;
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
  if (isRagEvaluationMode()) return;
  // Evict oldest entries if at capacity
  if (queryCache.size >= CACHE_MAX_SIZE) {
    const oldest = queryCache.keys().next().value;
    if (oldest !== undefined) queryCache.delete(oldest);
  }
  queryCache.set(key, { embedding, ts: Date.now() });
}

export function _clearQueryEmbeddingCacheForTests(): void {
  queryCache.clear();
}

// ─── Document Embedding ────────────────────────────────────────

/** One article's chunks, in order, with the header that places them. */
export interface ChunkedDocument {
  header: string;
  chunks: string[];
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

/**
 * Pack documents into requests under voyage-context-4's limits. A document
 * too long for one request is split into consecutive parts, each led by the
 * header, so its chunks keep the article's identity if not all its text.
 */
function packContextRequests(
  documents: ChunkedDocument[],
  tokenBudget: number
): Array<Array<{ document: number; firstChunk: number; texts: string[] }>> {
  const requests: Array<Array<{ document: number; firstChunk: number; texts: string[] }>> = [];
  let current: Array<{ document: number; firstChunk: number; texts: string[] }> = [];
  let currentTokens = 0;
  const flush = () => {
    if (current.length > 0) requests.push(current);
    current = [];
    currentTokens = 0;
  };

  documents.forEach((doc, document) => {
    const headerTokens = estimateTokens(doc.header);
    let part = { document, firstChunk: 0, texts: [doc.header] };
    let partTokens = headerTokens;
    const pushPart = () => {
      if (
        currentTokens + partTokens > tokenBudget ||
        current.length >= CONTEXT_REQUEST_MAX_DOCUMENTS
      ) {
        flush();
      }
      current.push(part);
      currentTokens += partTokens;
    };
    doc.chunks.forEach((text, chunkIndex) => {
      // Voyage rejects empty strings; a chunk with no text (a cartoon) stands as its header.
      const chunk = text.trim() ? text : doc.header;
      const chunkTokens = estimateTokens(chunk);
      if (part.texts.length > 1 && partTokens + chunkTokens > tokenBudget) {
        pushPart();
        part = { document, firstChunk: chunkIndex, texts: [doc.header] };
        partTokens = headerTokens;
      }
      part.texts.push(chunk);
      partTokens += chunkTokens;
    });
    pushPart();
  });
  flush();
  return requests;
}

/**
 * Embed article chunks with voyage-context-4. Returns one vector per chunk,
 * grouped as the input documents are. Requests run one after another; any
 * failure rejects the whole call, so callers treat it as one unit.
 */
export async function embedArticleChunks(
  documents: ChunkedDocument[],
  opts: { requestId?: string; op?: string } = {}
): Promise<number[][][]> {
  const result: number[][][] = documents.map((doc) => new Array<number[]>(doc.chunks.length));
  // Paced, a request must also fit in one minute's token allowance.
  const tokenBudget = Math.min(
    CONTEXT_REQUEST_TOKEN_BUDGET,
    voyagePaceLimits()?.tpm ?? CONTEXT_REQUEST_TOKEN_BUDGET
  );
  for (const request of packContextRequests(documents, tokenBudget)) {
    const requestTokens = request.reduce(
      (sum, part) => sum + part.texts.reduce((inner, text) => inner + estimateTokens(text), 0),
      0
    );
    const response = await retryOnQuota(
      "embedArticleChunks",
      () =>
        executeTrackedEmbeddingCall({
          model: EMBEDDING_MODEL,
          requestId: opts.requestId,
          op: opts.op ?? "embed.chunks",
          call: () =>
            voyagePost<ContextualizedResponse>(
              "embedArticleChunks",
              "contextualizedembeddings",
              {
                model: EMBEDDING_MODEL,
                input_type: "document",
                output_dimension: EMBEDDING_DIMS,
                inputs: request.map((part) => part.texts),
              },
              EMBED_DOCUMENTS_TIMEOUT_MS,
              undefined,
              requestTokens
            ),
        }),
      { delaysMs: QUOTA_RETRY_DELAYS_MS, requestId: opts.requestId }
    );
    const data = response.data ?? [];
    if (data.length !== request.length) {
      throw new Error(`Voyage returned ${data.length} documents for ${request.length}`);
    }
    for (const item of data) {
      const part = request[item.index];
      const vectors = [...(item.data ?? [])].sort((a, b) => a.index - b.index);
      if (!part || vectors.length !== part.texts.length) {
        throw new Error(`Voyage returned the wrong chunk count for document ${item.index}`);
      }
      // vectors[0] is the header's.
      for (let i = 1; i < vectors.length; i += 1) {
        result[part.document][part.firstChunk + i - 1] = checkedVector(
          vectors[i].embedding,
          "embedArticleChunks"
        );
      }
    }
  }
  return result;
}

/**
 * Embed photos (caption text plus image) with voyage-multimodal-3.5.
 * Returns one vector per input, in input order. Inputs without image bytes
 * are embedded from their text alone.
 */
export async function embedDocuments(
  inputs: EmbedInput[],
  opts: { requestId?: string; op?: string } = {}
): Promise<number[][]> {
  const result: number[][] = [];
  for (let offset = 0; offset < inputs.length; offset += MULTIMODAL_BATCH_SIZE) {
    const batch = inputs.slice(offset, offset + MULTIMODAL_BATCH_SIZE);
    const response = await retryOnQuota(
      "embedDocuments",
      () =>
        executeTrackedEmbeddingCall({
          model: IMAGE_EMBEDDING_MODEL,
          requestId: opts.requestId,
          op: opts.op ?? "embed.image",
          call: () =>
            voyagePost<MultimodalResponse>(
              "embedDocuments",
              "multimodalembeddings",
              {
                model: IMAGE_EMBEDDING_MODEL,
                input_type: "document",
                output_dimension: EMBEDDING_DIMS,
                inputs: batch.map((input) => ({
                  content: [
                    { type: "text", text: input.text },
                    ...(input.imageBase64
                      ? [
                          {
                            type: "image_base64",
                            image_base64: `data:${input.imageMimeType ?? "image/jpeg"};base64,${input.imageBase64}`,
                          },
                        ]
                      : []),
                  ],
                })),
              },
              EMBED_DOCUMENTS_TIMEOUT_MS,
              undefined,
              batch.reduce(
                (sum, input) =>
                  sum + estimateTokens(input.text) + (input.imageBase64 ? IMAGE_TOKEN_ESTIMATE : 0),
                0
              )
            ),
        }),
      { delaysMs: QUOTA_RETRY_DELAYS_MS, requestId: opts.requestId }
    );
    const data = [...(response.data ?? [])].sort((a, b) => a.index - b.index);
    if (data.length !== batch.length) {
      throw new Error(`Voyage returned ${data.length} vectors for ${batch.length} inputs`);
    }
    for (const item of data) result.push(checkedVector(item.embedding, "embedDocuments"));
  }
  return result;
}

// ─── Query Embedding ───────────────────────────────────────────

/** Which index a query searches: article chunks or photos. */
export type QueryEmbeddingKind = "text" | "image";

/**
 * Embed a single query for retrieval, with the model that built the vectors
 * it will search: voyage-context-4 for chunks (a one-item document is
 * embedded on its own) or voyage-multimodal-3.5 for photos.
 *
 * Includes a 10s timeout and a short-lived LRU cache for repeated queries.
 */
export async function embedQuery(
  question: string,
  opts: { signal?: AbortSignal; requestId?: string; kind?: QueryEmbeddingKind } = {}
): Promise<number[]> {
  // Early-exit on already-aborted signal so callers with an expired
  // deadline don't dispatch a doomed call. Mirrors hybridSearch's
  // early-exit (db.ts) for symmetry across the pipeline.
  if (opts.signal?.aborted) {
    throw new Error("embedQuery: signal already aborted");
  }

  const kind = opts.kind ?? "text";
  const model = kind === "image" ? IMAGE_EMBEDDING_MODEL : EMBEDDING_MODEL;
  const cacheKey = `${model}\0${RAG_QUERY_EMBEDDING_INPUT_VERSION}\0${question}`;

  // Check cache first
  const cached = getCachedEmbedding(cacheKey);
  if (cached) return cached;

  try {
    // A per-minute RPM trip often clears within a second or two, and losing
    // the vector signal costs recall for the whole request. The 10s budget
    // covers each attempt; the backoff gives up as soon as the deadline
    // aborts.
    const values = await retryOnQuota(
      "embedQuery",
      () =>
        executeTrackedEmbeddingCall({
          model,
          requestId: opts.requestId,
          op: "embed.query",
          call: () =>
            kind === "image"
              ? voyagePost<MultimodalResponse>(
                  "embedQuery",
                  "multimodalembeddings",
                  {
                    model,
                    input_type: "query",
                    output_dimension: EMBEDDING_DIMS,
                    inputs: [{ content: [{ type: "text", text: question }] }],
                  },
                  EMBED_TIMEOUT_MS,
                  opts.signal,
                  estimateTokens(question)
                )
              : voyagePost<ContextualizedResponse>(
                  "embedQuery",
                  "contextualizedembeddings",
                  {
                    model,
                    input_type: "query",
                    output_dimension: EMBEDDING_DIMS,
                    inputs: [[question]],
                  },
                  EMBED_TIMEOUT_MS,
                  opts.signal,
                  estimateTokens(question)
                ),
        }),
      { signal: opts.signal, requestId: opts.requestId }
    ).then((response) => {
      const first = response.data?.[0];
      const embedding =
        first && "embedding" in first ? first.embedding : first?.data?.[0]?.embedding;
      return checkedVector(embedding, "embedQuery");
    });

    setCachedEmbedding(cacheKey, values);
    return values;
  } catch (err) {
    // Surface quota exhaustion as a typed error so /api/ask can return
    // 429 + Retry-After instead of an opaque 502.
    if (isQuotaError(err)) {
      throw new QuotaExhaustedError("embedQuery", err);
    }
    throw err;
  }
}

// ─── Text Building ─────────────────────────────────────────────

function sourceLine(article: { edition_date?: string | null; category?: string | null }): string {
  return [
    "From The Transcript Archive (Ohio Wesleyan University newspaper)",
    article.edition_date,
    article.category ? `${article.category} section` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * The header that leads an article's chunks: where and when it ran, the
 * headline and the byline.
 */
export function buildChunkHeader(article: {
  headline: string;
  byline?: string | null;
  edition_date?: string | null;
  category?: string | null;
}): string {
  return [
    `${sourceLine(article)}.`,
    `Headline: ${article.headline || "(untitled)"}`,
    article.byline ? `Byline: ${article.byline}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Build the text string to embed for an article or photo: headline, then
 * the source line, byline, lede, caption and body.
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
  if (article.edition_date || article.category) bodyParts.push(sourceLine(article) + ".");

  if (article.byline) bodyParts.push(article.byline);
  // Summary (article lede) — most semantically dense sentence, prepended for prominence
  if (article.summary) bodyParts.push(article.summary);
  // Image caption — gives visual articles semantic signal from photo content
  if (article.image_caption) bodyParts.push(`[Photo: ${article.image_caption}]`);
  if (article.body_plain) bodyParts.push(article.body_plain);

  const body = bodyParts.join("\n\n").trim();
  const full = `${article.headline || "(untitled)"}\n\n${body || "(empty article)"}`;
  return full.slice(0, MAX_EMBEDDING_CHARS);
}

// ─── Multimodal Input ─────────────────────────────────────────

export interface EmbedInput {
  text: string;
  imageBase64?: string;
  imageMimeType?: string;
}

/** A chunk with the header of the article it belongs to. */
export interface ChunkEmbedInput {
  header: string;
  text: string;
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

/**
 * Canonical identity for deciding whether a stored vector is reusable. The
 * model follows the input version: photo inputs belong to the image model.
 */
export function embeddingInputFingerprint(
  input: EmbedInput | ChunkEmbedInput,
  inputVersion = EMBEDDING_INPUT_VERSION
): string {
  const hash = createHash("sha256");
  hash.update(
    inputVersion === IMAGE_EMBEDDING_INPUT_VERSION ? IMAGE_EMBEDDING_MODEL : EMBEDDING_MODEL
  );
  hash.update("\0");
  hash.update(inputVersion);
  hash.update("\0");
  if ("header" in input) {
    hash.update(input.header);
    hash.update("\0");
  }
  hash.update(input.text);
  if ("imageBase64" in input && input.imageBase64) {
    hash.update("\0");
    hash.update(input.imageMimeType ?? "image/jpeg");
    hash.update("\0");
    hash.update(input.imageBase64);
  }
  return hash.digest("hex");
}

// ─── Utilities ─────────────────────────────────────────────────

/** Check whether the Voyage API key is present. */
export function hasVoyageCredentials(): boolean {
  return Boolean(process.env.VOYAGE_API_KEY?.trim());
}

export {
  EMBEDDING_MODEL,
  IMAGE_EMBEDDING_MODEL,
  EMBEDDING_DIMS,
  EMBEDDING_INPUT_VERSION,
  IMAGE_EMBEDDING_INPUT_VERSION,
};
