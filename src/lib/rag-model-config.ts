import type { ThinkingLevel } from "@google/genai";

/**
 * Single source of truth for every Google model used by the RAG pipeline.
 * Keeping these values together prevents the route, agent, tests, and cost
 * accounting from silently drifting to different model generations.
 */
export const RAG_GENERATION_MODEL = "gemini-3.5-flash-lite";
/**
 * Relevance judging and answer writing run on the full Flash tier: the lite
 * model consistently scores every candidate for broad survey questions as
 * tangential and writes weaker prose than the previously served
 * gemini-3-flash-preview.
 */
export const RAG_ANSWER_MODEL = "gemini-3.6-flash";
export const RAG_EMBEDDING_MODEL = "gemini-embedding-2";
export const RAG_QUERY_EMBEDDING_INPUT_VERSION = "query-search-v1";
export const RAG_TEXT_EMBEDDING_INPUT_VERSION = "article-chunk-v1";
export const RAG_IMAGE_EMBEDDING_INPUT_VERSION = "article-image-v1";

export const RAG_MODEL_CONFIG = {
    reformulate: {
        model: RAG_GENERATION_MODEL,
        thinkingLevel: "MINIMAL" as ThinkingLevel,
    },
    rerank: {
        model: RAG_ANSWER_MODEL,
        thinkingLevel: "MINIMAL" as ThinkingLevel,
    },
    answer: {
        model: RAG_ANSWER_MODEL,
        thinkingLevel: "MEDIUM" as ThinkingLevel,
    },
    agent: {
        model: RAG_ANSWER_MODEL,
        thinkingLevel: "MEDIUM" as ThinkingLevel,
    },
} as const;

/**
 * Bump when retrieval inputs, ranking behavior, or answer semantics change.
 * It deliberately participates in in-memory cache keys.
 */
export const RAG_PIPELINE_VERSION = "rag-v3-independent-grounded";
