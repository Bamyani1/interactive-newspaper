import type Anthropic from "@anthropic-ai/sdk";

type Effort = NonNullable<Anthropic.OutputConfig["effort"]>;

/**
 * Single source of truth for every model used by the RAG pipeline. Keeping
 * these values together prevents the route, agent, tests, and cost
 * accounting from silently drifting to different model generations.
 */
export const RAG_GENERATION_MODEL = "claude-haiku-5-5";
/** Text chunks and queries that search them. */
export const RAG_EMBEDDING_MODEL = "voyage-context-4";
/** Photos (caption plus pixels) and queries that search them. */
export const RAG_IMAGE_EMBEDDING_MODEL = "voyage-multimodal-3.5";
export const RAG_EMBEDDING_DIMS = 1024;
export const RAG_RERANK_MODEL = "rerank-3";
export const RAG_QUERY_EMBEDDING_INPUT_VERSION = "query-voyage-v1";
export const RAG_TEXT_EMBEDDING_INPUT_VERSION = "article-chunk-voyage-v1";
export const RAG_IMAGE_EMBEDDING_INPUT_VERSION = "article-image-voyage-v1";

/**
 * Answer writing and the agent loop run on one of two profiles, chosen by
 * RAG_ANSWER_PROFILE and compared on the development eval set.
 */
export const RAG_ANSWER_PROFILES = {
  "sonnet-medium": { model: "claude-sonnet-5-5", effort: "medium" },
  "haiku-xhigh": { model: "claude-haiku-5-5", effort: "xhigh" },
} as const satisfies Record<string, { model: string; effort: Effort }>;
export type RagAnswerProfile = keyof typeof RAG_ANSWER_PROFILES;

export function parseAnswerProfile(value: string | undefined): RagAnswerProfile {
  if (!value) return "sonnet-medium";
  if (value in RAG_ANSWER_PROFILES) return value as RagAnswerProfile;
  throw new Error(
    `RAG_ANSWER_PROFILE must be one of ${Object.keys(RAG_ANSWER_PROFILES).join(", ")}`
  );
}

export const RAG_ANSWER_PROFILE = parseAnswerProfile(process.env.RAG_ANSWER_PROFILE);
const answerProfile = RAG_ANSWER_PROFILES[RAG_ANSWER_PROFILE];
/** Answer writing and the agent loop. */
export const RAG_ANSWER_MODEL = answerProfile.model;

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
    model: RAG_ANSWER_MODEL,
    effort: answerProfile.effort as Effort,
  },
  agent: {
    model: RAG_ANSWER_MODEL,
    effort: answerProfile.effort as Effort,
    // The no-tools turn that writes up evidence already gathered. More
    // thinking here delays the first word; the eval records that latency.
    finalEffort: answerProfile.effort as Effort,
  },
} as const;

/**
 * Bump when retrieval inputs, ranking behavior, or answer semantics change.
 * It deliberately participates in in-memory cache keys. Ask's readiness check
 * requires the served build's pipeline_version to equal this, so a bump ships
 * with a new build (`--create`, `--reuse` keeps it cheap) and `--switch`;
 * a bump alone drops Ask to keyword-only search.
 */
export const RAG_PIPELINE_VERSION = "rag-v4-voyage";
