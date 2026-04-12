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
const EMBED_TIMEOUT_MS = 5_000;
const MAX_EMBEDDING_CHARS = 30_000; // ~7,500 tokens; conservative buffer under 8,192 token API limit

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

    const response = await client.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: batch.map((inp) => ({ parts: [{ text: inp.text }] })),
      config: { outputDimensionality: EMBEDDING_DIMS },
    });

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

  // Process multimodal embeddings individually
  const imageEmbeddings: number[][] = [];
  for (const inp of withImages) {
    const response = await client.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: [{
        parts: [
          { text: inp.text },
          { inlineData: { mimeType: inp.imageMimeType || "image/jpeg", data: inp.imageBase64! } },
        ],
      }],
      config: { outputDimensionality: EMBEDDING_DIMS },
    });

    if (!response.embeddings || response.embeddings.length !== 1) {
      throw new Error("Failed to generate multimodal embedding");
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
export async function embedQuery(question: string): Promise<number[]> {
  const prefixed = `task: search result | query: ${question}`;

  // Check cache first
  const cached = getCachedEmbedding(prefixed);
  if (cached) return cached;

  const client = getGeminiClient();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);

  try {
    const response = await client.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: [{ parts: [{ text: prefixed }] }],
      config: {
        outputDimensionality: EMBEDDING_DIMS,
        abortSignal: controller.signal,
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
