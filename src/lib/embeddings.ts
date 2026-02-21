/**
 * Embedding Utility
 *
 * Shared module for generating text embeddings via Google's gemini-embedding-001 model.
 * Used by both the seed/embed script (build-time) and the /api/ask route (query-time).
 */

import { GoogleGenAI } from "@google/genai";

const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMS = 768;
const MAX_BATCH_SIZE = 100; // API limit per request

// Lazy-init so the module can be imported without a key (for tests / optional embedding)
let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
    if (!_client) {
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        if (!apiKey) {
            throw new Error(
                "GEMINI_API_KEY or GOOGLE_API_KEY environment variable is required for embedding generation.",
            );
        }
        _client = new GoogleGenAI({ apiKey });
    }
    return _client;
}

/**
 * Embed multiple texts for document storage. Handles batching internally.
 * Returns an array of embedding vectors (768-dim each), parallel to the input array.
 */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const client = getClient();
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
        const batch = texts.slice(i, i + MAX_BATCH_SIZE);

        const response = await client.models.embedContent({
            model: EMBEDDING_MODEL,
            contents: batch.map((text) => ({ parts: [{ text }] })),
            config: {
                taskType: "RETRIEVAL_DOCUMENT",
                outputDimensionality: EMBEDDING_DIMS,
            },
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
            allEmbeddings.push(emb.values);
        }

        // Rate-limit pause between batches (avoid 429s)
        if (i + MAX_BATCH_SIZE < texts.length) {
            await sleep(200);
        }
    }

    return allEmbeddings;
}

/**
 * Embed a single query for retrieval (RETRIEVAL_QUERY task type).
 * Uses a different task type than document embedding for better retrieval quality.
 */
export async function embedQuery(question: string): Promise<number[]> {
    const client = getClient();

    const response = await client.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: [{ parts: [{ text: question }] }],
        config: {
            taskType: "RETRIEVAL_QUERY",
            outputDimensionality: EMBEDDING_DIMS,
        },
    });

    if (!response.embeddings || response.embeddings.length !== 1) {
        throw new Error("Failed to generate query embedding");
    }

    const values = response.embeddings[0].values;
    if (!values || values.length !== EMBEDDING_DIMS) {
        throw new Error(
            `Invalid query embedding dimensions: expected ${EMBEDDING_DIMS}, got ${values?.length ?? 0}`,
        );
    }

    return values;
}

/**
 * Build the text string to embed for an article.
 * Concatenates headline + byline + body for maximum semantic coverage.
 */
export function buildEmbeddingText(article: {
    headline: string;
    byline?: string | null;
    body_plain: string;
}): string {
    const parts = [article.headline];
    if (article.byline) parts.push(article.byline);
    if (article.body_plain) parts.push(article.body_plain);
    const result = parts.join("\n\n").trim();
    // Gemini API rejects empty strings — provide a minimal fallback
    return result || "(empty article)";
}

/** Check whether a Gemini API key is available (without throwing). */
export function hasApiKey(): boolean {
    return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
}

export { EMBEDDING_MODEL, EMBEDDING_DIMS };

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
