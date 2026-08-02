export const RAG_RETRIEVAL_MODES = [
  "legacy",
  "shadow",
  "versioned",
] as const;

export type RagRetrievalMode = (typeof RAG_RETRIEVAL_MODES)[number];

export interface RagRetrievalConfig {
  mode: RagRetrievalMode;
  activeIndexBuildId: string | null;
  cacheIdentity: string;
}

/**
 * Resolve the retrieval/index selection from runtime configuration.
 *
 * Safety properties:
 * - absence always means legacy retrieval;
 * - an invalid value fails closed instead of guessing;
 * - candidate modes require an explicit immutable build identity;
 * - database table existence never selects a retrieval implementation.
 */
export function getRagRetrievalConfig(
  env: NodeJS.ProcessEnv = process.env,
): RagRetrievalConfig {
  const rawMode = env.RAG_RETRIEVAL_MODE?.trim().toLowerCase() || "legacy";
  if (!RAG_RETRIEVAL_MODES.includes(rawMode as RagRetrievalMode)) {
    throw new Error(
      `Invalid RAG_RETRIEVAL_MODE=${JSON.stringify(rawMode)}; expected legacy, shadow, or versioned.`,
    );
  }

  const mode = rawMode as RagRetrievalMode;
  const configuredBuildId = env.RAG_ACTIVE_INDEX_BUILD_ID?.trim() || null;
  if (mode !== "legacy" && !configuredBuildId) {
    throw new Error(
      `RAG_ACTIVE_INDEX_BUILD_ID is required when RAG_RETRIEVAL_MODE=${mode}.`,
    );
  }

  const activeIndexBuildId = mode === "legacy" ? null : configuredBuildId;
  return {
    mode,
    activeIndexBuildId,
    cacheIdentity:
      mode === "legacy" ? "legacy" : `${mode}:${activeIndexBuildId}`,
  };
}

export function shouldServeVersionedRetrieval(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return getRagRetrievalConfig(env).mode === "versioned";
}
