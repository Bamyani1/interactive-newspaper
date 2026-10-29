export const RAG_RETRIEVAL_MODES = ["versioned"] as const;

// Gemini-era modes; legacy read articles.embedding, which migration 0015 drops.
const REMOVED_RETRIEVAL_MODES = ["legacy", "shadow"];

export type RagRetrievalMode = (typeof RAG_RETRIEVAL_MODES)[number];

export interface RagRetrievalConfig {
  mode: RagRetrievalMode;
  activeIndexBuildId: string;
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
 * - Ask always serves an explicit immutable build: the env's
 *   RAG_ACTIVE_INDEX_BUILD_ID + RAG_CORPUS_VERSION when set (an override, as
 *   a pair), otherwise the serving pointer's build and corpus;
 * - no build at all, or an invalid or removed mode, fails closed instead of
 *   guessing;
 * - database table existence never selects a retrieval implementation (the
 *   pointer only names a build).
 */
export function getRagRetrievalConfig(
  env: NodeJS.ProcessEnv = process.env,
  pointer: ServingPointer | null = servingPointer
): RagRetrievalConfig {
  const rawMode = env.RAG_RETRIEVAL_MODE?.trim().toLowerCase() || "versioned";
  if (REMOVED_RETRIEVAL_MODES.includes(rawMode)) {
    throw new Error(`RAG_RETRIEVAL_MODE=${rawMode} was removed; unset it or set versioned.`);
  }
  if (!RAG_RETRIEVAL_MODES.includes(rawMode as RagRetrievalMode)) {
    throw new Error(`Invalid RAG_RETRIEVAL_MODE=${JSON.stringify(rawMode)}; expected versioned.`);
  }

  const mode = rawMode as RagRetrievalMode;
  const envBuildId = env.RAG_ACTIVE_INDEX_BUILD_ID?.trim() || null;
  const fromPointer = !envBuildId && pointer !== null;
  const activeIndexBuildId = fromPointer ? pointer.indexBuildId : envBuildId;
  if (!activeIndexBuildId) {
    throw new Error(
      `RAG_ACTIVE_INDEX_BUILD_ID or a serving pointer is required when RAG_RETRIEVAL_MODE=${mode}.`
    );
  }

  const corpusVersion = fromPointer
    ? pointer.corpusVersion
    : env.RAG_CORPUS_VERSION?.trim() || "legacy-unversioned";
  const identityParts = [
    `corpus=${corpusVersion}`,
    `index=${mode}:${activeIndexBuildId}`,
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
import {
  RAG_EMBEDDING_DIMS,
  RAG_EMBEDDING_MODEL,
  RAG_IMAGE_EMBEDDING_INPUT_VERSION,
  RAG_IMAGE_EMBEDDING_MODEL,
  RAG_PIPELINE_VERSION,
  RAG_TEXT_EMBEDDING_INPUT_VERSION,
} from "@/src/lib/rag-model-config";
