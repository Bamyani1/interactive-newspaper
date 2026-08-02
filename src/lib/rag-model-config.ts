import type { ThinkingLevel } from "@google/genai";

/**
 * Single source of truth for every Google model used by the RAG pipeline.
 * Keeping these values together prevents the route, agent, tests, and cost
 * accounting from silently drifting to different model generations.
 */
export const RAG_GENERATION_MODEL = "gemini-3.5-flash-lite";
export const RAG_EMBEDDING_MODEL = "gemini-embedding-2";

export const RAG_MODEL_CONFIG = {
    reformulate: {
        model: RAG_GENERATION_MODEL,
        thinkingLevel: "MINIMAL" as ThinkingLevel,
    },
    rerank: {
        model: RAG_GENERATION_MODEL,
        thinkingLevel: "MINIMAL" as ThinkingLevel,
    },
    answer: {
        model: RAG_GENERATION_MODEL,
        thinkingLevel: "MEDIUM" as ThinkingLevel,
    },
    agent: {
        model: RAG_GENERATION_MODEL,
        thinkingLevel: "MEDIUM" as ThinkingLevel,
    },
} as const;

/**
 * Bump when retrieval inputs, ranking behavior, or answer semantics change.
 * It deliberately participates in in-memory cache keys.
 */
export const RAG_PIPELINE_VERSION = "rag-v2-chunked-grounded";
