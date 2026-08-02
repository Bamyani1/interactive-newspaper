import { describe, expect, it } from "vitest";
import {
  RAG_EMBEDDING_MODEL,
  RAG_GENERATION_MODEL,
  RAG_MODEL_CONFIG,
  RAG_PIPELINE_VERSION,
} from "@/src/lib/rag-model-config";

describe("RAG model routing", () => {
  it("uses Gemini 3.5 Flash-Lite for every generation call", () => {
    expect(RAG_GENERATION_MODEL).toBe("gemini-3.5-flash-lite");
    expect(
      Object.values(RAG_MODEL_CONFIG).map((configuration) => configuration.model),
    ).toEqual([
      "gemini-3.5-flash-lite",
      "gemini-3.5-flash-lite",
      "gemini-3.5-flash-lite",
      "gemini-3.5-flash-lite",
    ]);
    expect(JSON.stringify(RAG_MODEL_CONFIG)).not.toContain("3.6");
  });

  it("reserves minimal thinking for lookup steps and medium for synthesis", () => {
    expect(RAG_MODEL_CONFIG.reformulate.thinkingLevel).toBe("MINIMAL");
    expect(RAG_MODEL_CONFIG.rerank.thinkingLevel).toBe("MINIMAL");
    expect(RAG_MODEL_CONFIG.answer.thinkingLevel).toBe("MEDIUM");
    expect(RAG_MODEL_CONFIG.agent.thinkingLevel).toBe("MEDIUM");
  });

  it("uses the stable embedding model and versioned pipeline", () => {
    expect(RAG_EMBEDDING_MODEL).toBe("gemini-embedding-2");
    expect(RAG_PIPELINE_VERSION).toBe("rag-v3-independent-grounded");
  });
});
