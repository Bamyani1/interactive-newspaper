import { describe, expect, it } from "vitest";
import { getRagRetrievalConfig, setServingPointer } from "@/src/lib/rag-index-config";

describe("RAG retrieval configuration", () => {
  it("defaults to versioned and fails closed without a build", () => {
    expect(() => getRagRetrievalConfig({} as NodeJS.ProcessEnv)).toThrow(
      /RAG_ACTIVE_INDEX_BUILD_ID or a serving pointer/
    );
    expect(() =>
      getRagRetrievalConfig({ RAG_RETRIEVAL_MODE: "versioned" } as unknown as NodeJS.ProcessEnv)
    ).toThrow(/RAG_ACTIVE_INDEX_BUILD_ID/);
  });

  it("rejects the removed legacy and shadow modes", () => {
    for (const mode of ["legacy", "shadow"]) {
      expect(() =>
        getRagRetrievalConfig({ RAG_RETRIEVAL_MODE: mode } as unknown as NodeJS.ProcessEnv, {
          indexBuildId: "build-pointer",
          corpusVersion: "corpus-pointer",
        })
      ).toThrow(new RegExp(`RAG_RETRIEVAL_MODE=${mode} was removed`));
    }
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
      pipelineVersion: "rag-v4-voyage",
      embeddingModel: "voyage-context-4",
      imageEmbeddingModel: "voyage-multimodal-3.5",
      embeddingDims: 1024,
      textEmbeddingInputVersion: "article-chunk-voyage-v1",
      imageEmbeddingInputVersion: "article-image-voyage-v1",
      cacheIdentity: expect.stringContaining("index=versioned:build-2026-08-02"),
    });
  });

  it("serves the database pointer's build and corpus when the env names no build", () => {
    const env = { RAG_RETRIEVAL_MODE: "versioned" } as unknown as NodeJS.ProcessEnv;
    const config = getRagRetrievalConfig(env, {
      indexBuildId: "build-pointer",
      corpusVersion: "corpus-pointer",
    });
    expect(config).toMatchObject({
      mode: "versioned",
      activeIndexBuildId: "build-pointer",
      corpusVersion: "corpus-pointer",
    });
    expect(config.cacheIdentity).toContain("index=versioned:build-pointer");
  });

  it("lets the env build id and corpus override the pointer, as a pair", () => {
    const pointer = { indexBuildId: "build-pointer", corpusVersion: "corpus-pointer" };
    expect(
      getRagRetrievalConfig(
        {
          RAG_RETRIEVAL_MODE: "versioned",
          RAG_ACTIVE_INDEX_BUILD_ID: "build-env",
          RAG_CORPUS_VERSION: "corpus-env",
        } as unknown as NodeJS.ProcessEnv,
        pointer
      )
    ).toMatchObject({ activeIndexBuildId: "build-env", corpusVersion: "corpus-env" });
    // An env corpus without an env build never pairs with the pointer's build.
    expect(
      getRagRetrievalConfig(
        {
          RAG_RETRIEVAL_MODE: "versioned",
          RAG_CORPUS_VERSION: "corpus-env",
        } as unknown as NodeJS.ProcessEnv,
        pointer
      )
    ).toMatchObject({ activeIndexBuildId: "build-pointer", corpusVersion: "corpus-pointer" });
  });

  it("serves the pointer when no mode is set", () => {
    expect(
      getRagRetrievalConfig({} as NodeJS.ProcessEnv, {
        indexBuildId: "build-pointer",
        corpusVersion: "corpus-pointer",
      })
    ).toMatchObject({
      mode: "versioned",
      activeIndexBuildId: "build-pointer",
      corpusVersion: "corpus-pointer",
    });
  });

  it("reads the loaded pointer by default", () => {
    const env = { RAG_RETRIEVAL_MODE: "versioned" } as unknown as NodeJS.ProcessEnv;
    setServingPointer({ indexBuildId: "build-loaded", corpusVersion: "corpus-loaded" });
    try {
      expect(getRagRetrievalConfig(env).activeIndexBuildId).toBe("build-loaded");
    } finally {
      setServingPointer(null);
    }
    expect(() => getRagRetrievalConfig(env)).toThrow(/serving pointer/);
  });

  it("rejects unknown modes rather than guessing", () => {
    expect(() =>
      getRagRetrievalConfig({ RAG_RETRIEVAL_MODE: "auto" } as unknown as NodeJS.ProcessEnv)
    ).toThrow(/Invalid RAG_RETRIEVAL_MODE/);
  });
});
