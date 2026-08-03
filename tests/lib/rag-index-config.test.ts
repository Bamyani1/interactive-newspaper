import { describe, expect, it } from "vitest";
import {
  getRagRetrievalConfig,
  shouldServeVersionedRetrieval,
} from "@/src/lib/rag-index-config";

describe("RAG retrieval configuration", () => {
  it("defaults to legacy with no index identity", () => {
    expect(getRagRetrievalConfig({} as NodeJS.ProcessEnv)).toEqual({
      mode: "legacy",
      activeIndexBuildId: null,
      corpusVersion: "legacy-unversioned",
      pipelineVersion: "rag-v3-independent-grounded",
      embeddingModel: "gemini-embedding-2",
      textEmbeddingInputVersion: "article-chunk-v1",
      imageEmbeddingInputVersion: "article-image-v1",
      cacheIdentity: expect.stringContaining("index=legacy"),
    });
  });

  it("requires an immutable build id for shadow and versioned modes", () => {
    expect(() =>
      getRagRetrievalConfig({ RAG_RETRIEVAL_MODE: "shadow" } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/RAG_ACTIVE_INDEX_BUILD_ID/);
    expect(() =>
      getRagRetrievalConfig({ RAG_RETRIEVAL_MODE: "versioned" } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/RAG_ACTIVE_INDEX_BUILD_ID/);
  });

  it("identifies a versioned build without allowing table-driven activation", () => {
    const env = {
      RAG_RETRIEVAL_MODE: "versioned",
      RAG_ACTIVE_INDEX_BUILD_ID: "build-2026-08-02",
      RAG_CORPUS_VERSION: "corpus-a",
    } as unknown as NodeJS.ProcessEnv;
    expect(getRagRetrievalConfig(env)).toEqual({
      mode: "versioned",
      activeIndexBuildId: "build-2026-08-02",
      corpusVersion: "corpus-a",
      pipelineVersion: "rag-v3-independent-grounded",
      embeddingModel: "gemini-embedding-2",
      textEmbeddingInputVersion: "article-chunk-v1",
      imageEmbeddingInputVersion: "article-image-v1",
      cacheIdentity: expect.stringContaining(
        "index=versioned:build-2026-08-02",
      ),
    });
    expect(shouldServeVersionedRetrieval(env)).toBe(true);
  });

  it("rejects unknown modes rather than guessing", () => {
    expect(() =>
      getRagRetrievalConfig({ RAG_RETRIEVAL_MODE: "auto" } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/Invalid RAG_RETRIEVAL_MODE/);
  });
});
