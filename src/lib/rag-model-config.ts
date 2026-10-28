import type Anthropic from "@anthropic-ai/sdk";

type Effort = NonNullable<Anthropic.OutputConfig["effort"]>;

/**
 * Single source of truth for every model used by the RAG pipeline. Keeping
 * these values together prevents the route, agent, tests, and cost
 * accounting from silently drifting to different model generations.
 */
export const RAG_GENERATION_MODEL = "claude-haiku-5-5";
/** Answer writing and the agent loop. */
export const RAG_ANSWER_MODEL = "claude-sonnet-5-5";
export const RAG_EMBEDDING_MODEL = "gemini-embedding-2";
export const RAG_QUERY_EMBEDDING_INPUT_VERSION = "query-qa-v1";
export const RAG_TEXT_EMBEDDING_INPUT_VERSION = "article-chunk-v1";
export const RAG_IMAGE_EMBEDDING_INPUT_VERSION = "article-image-v1";

export const RAG_MODEL_CONFIG = {
  reformulate: {
    // Query rewriting is short and on the critical path: no thinking.
    model: RAG_GENERATION_MODEL,
    effort: "low" as Effort,
    thinking: { type: "disabled" } as Anthropic.ThinkingConfigParam,
  },
  rerank: {
    // The score budget is sized for the JSON array alone: thinking spent it
    // and left no scores.
    model: RAG_GENERATION_MODEL,
    effort: "low" as Effort,
    thinking: { type: "disabled" } as Anthropic.ThinkingConfigParam,
  },
  answer: {
    // Grounded single-hop QA over pre-retrieved context needs little
    // thinking, and thinking bills at the output rate.
    model: RAG_ANSWER_MODEL,
    effort: "low" as Effort,
  },
  agent: {
    model: RAG_ANSWER_MODEL,
    effort: "medium" as Effort,
    // The no-tools turn that writes up evidence already gathered. More
    // thinking here delays the first word, which is what timed broad
    // questions out.
    finalEffort: "low" as Effort,
  },
} as const;

/**
 * Bump when retrieval inputs, ranking behavior, or answer semantics change.
 * It deliberately participates in in-memory cache keys.
 */
export const RAG_PIPELINE_VERSION = "rag-v3-independent-grounded";
