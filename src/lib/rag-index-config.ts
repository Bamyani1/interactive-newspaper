export const RAG_RETRIEVAL_MODES = ["legacy", "shadow", "versioned"] as const;

export type RagRetrievalMode = (typeof RAG_RETRIEVAL_MODES)[number];

export interface RagRetrievalConfig {
  mode: RagRetrievalMode;
  activeIndexBuildId: string | null;
  corpusVersion: string;
  pipelineVersion: string;
  embeddingModel: string;
  imageEmbeddingModel: string;
  embeddingDims: number;
  textEmbeddingInputVersion: string;
  imageEmbeddingInputVersion: string;
  cacheIdentity: string;
}

/** The rag_serving_pointer row: the build Ask serves and its corpus. */
export interface ServingPointer {
  indexBuildId: string;
  corpusVersion: string;
}

// Filled by loadServingPointer() (rag-serving-pointer.ts), which request
// handlers and scripts await before reading the config.
let servingPointer: ServingPointer | null = null;

export function setServingPointer(pointer: ServingPointer | null): void {
  servingPointer = pointer;
}

/**
 * Resolve the retrieval/index selection from runtime configuration.
 *
 * Safety properties:
 * - absence always means legacy retrieval;
 * - an invalid value fails closed instead of guessing;
 * - candidate modes require an explicit immutable build identity: the env's
 *   RAG_ACTIVE_INDEX_BUILD_ID + RAG_CORPUS_VERSION when set (an override, as
 *   a pair), otherwise the serving pointer's build and corpus;
 * - database table existence never selects a retrieval implementation (the
 *   mode is env-only; the pointer only names a build).
 */
export function getRagRetrievalConfig(
  env: NodeJS.ProcessEnv = process.env,
  pointer: ServingPointer | null = servingPointer
): RagRetrievalConfig {
  const rawMode = env.RAG_RETRIEVAL_MODE?.trim().toLowerCase() || "legacy";
  if (!RAG_RETRIEVAL_MODES.includes(rawMode as RagRetrievalMode)) {
    throw new Error(
      `Invalid RAG_RETRIEVAL_MODE=${JSON.stringify(rawMode)}; expected legacy, shadow, or versioned.`
    );
  }

  const mode = rawMode as RagRetrievalMode;
  const envBuildId = env.RAG_ACTIVE_INDEX_BUILD_ID?.trim() || null;
  const fromPointer = mode !== "legacy" && !envBuildId && pointer !== null;
  const configuredBuildId = fromPointer ? pointer.indexBuildId : envBuildId;
  if (mode !== "legacy" && !configuredBuildId) {
    throw new Error(
      `RAG_ACTIVE_INDEX_BUILD_ID or a serving pointer is required when RAG_RETRIEVAL_MODE=${mode}.`
    );
  }

  const activeIndexBuildId = mode === "legacy" ? null : configuredBuildId;
  const corpusVersion = fromPointer
    ? pointer.corpusVersion
    : env.RAG_CORPUS_VERSION?.trim() || "legacy-unversioned";
  const identityParts = [
    `corpus=${corpusVersion}`,
    `index=${mode === "legacy" ? "legacy" : `${mode}:${activeIndexBuildId}`}`,
    `pipeline=${RAG_PIPELINE_VERSION}`,
    `embedding=${RAG_EMBEDDING_MODEL}`,
    `imageEmbedding=${RAG_IMAGE_EMBEDDING_MODEL}`,
    `dims=${RAG_EMBEDDING_DIMS}`,
    `textInput=${RAG_TEXT_EMBEDDING_INPUT_VERSION}`,
    `imageInput=${RAG_IMAGE_EMBEDDING_INPUT_VERSION}`,
  ];
  return {
    mode,
    activeIndexBuildId,
    corpusVersion,
    pipelineVersion: RAG_PIPELINE_VERSION,
    embeddingModel: RAG_EMBEDDING_MODEL,
    imageEmbeddingModel: RAG_IMAGE_EMBEDDING_MODEL,
    embeddingDims: RAG_EMBEDDING_DIMS,
    textEmbeddingInputVersion: RAG_TEXT_EMBEDDING_INPUT_VERSION,
    imageEmbeddingInputVersion: RAG_IMAGE_EMBEDDING_INPUT_VERSION,
    cacheIdentity: identityParts.join("|"),
  };
}

export function shouldServeVersionedRetrieval(env: NodeJS.ProcessEnv = process.env): boolean {
  return getRagRetrievalConfig(env).mode === "versioned";
}
import {
  RAG_EMBEDDING_DIMS,
  RAG_EMBEDDING_MODEL,
  RAG_IMAGE_EMBEDDING_INPUT_VERSION,
  RAG_IMAGE_EMBEDDING_MODEL,
  RAG_PIPELINE_VERSION,
  RAG_TEXT_EMBEDDING_INPUT_VERSION,
} from "@/src/lib/rag-model-config";
