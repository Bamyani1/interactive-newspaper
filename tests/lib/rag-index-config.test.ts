import { describe, expect, it } from "vitest";
import {
  getRagRetrievalConfig,
  shouldServeVersionedRetrieval,
} from "@/src/lib/rag-index-config";

describe("RAG retrieval configuration", () => {
  it("defaults to legacy with no index identity", () => {
    expect(getRagRetrievalConfig({})).toEqual({
      mode: "legacy",
      activeIndexBuildId: null,
      cacheIdentity: "legacy",
    });
  });

  it("requires an immutable build id for shadow and versioned modes", () => {
    expect(() =>
      getRagRetrievalConfig({ RAG_RETRIEVAL_MODE: "shadow" }),
    ).toThrow(/RAG_ACTIVE_INDEX_BUILD_ID/);
    expect(() =>
      getRagRetrievalConfig({ RAG_RETRIEVAL_MODE: "versioned" }),
    ).toThrow(/RAG_ACTIVE_INDEX_BUILD_ID/);
  });

  it("identifies a versioned build without allowing table-driven activation", () => {
    const env = {
      RAG_RETRIEVAL_MODE: "versioned",
      RAG_ACTIVE_INDEX_BUILD_ID: "build-2026-08-02",
    };
    expect(getRagRetrievalConfig(env)).toEqual({
      mode: "versioned",
      activeIndexBuildId: "build-2026-08-02",
      cacheIdentity: "versioned:build-2026-08-02",
    });
    expect(shouldServeVersionedRetrieval(env)).toBe(true);
  });

  it("rejects unknown modes rather than guessing", () => {
    expect(() =>
      getRagRetrievalConfig({ RAG_RETRIEVAL_MODE: "auto" }),
    ).toThrow(/Invalid RAG_RETRIEVAL_MODE/);
  });
});
