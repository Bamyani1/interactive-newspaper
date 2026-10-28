import { describe, expect, it } from "vitest";
import {
  RAG_ANSWER_MODEL,
  RAG_EMBEDDING_MODEL,
  RAG_GENERATION_MODEL,
  RAG_MODEL_CONFIG,
  RAG_PIPELINE_VERSION,
} from "@/src/lib/rag-model-config";

describe("RAG model routing", () => {
  it("routes rewriting and judging to Haiku and answering to Sonnet", () => {
    expect(RAG_GENERATION_MODEL).toBe("claude-haiku-5-5");
    expect(RAG_ANSWER_MODEL).toBe("claude-sonnet-5-5");
    expect(RAG_MODEL_CONFIG.reformulate.model).toBe(RAG_GENERATION_MODEL);
    expect(RAG_MODEL_CONFIG.rerank.model).toBe(RAG_GENERATION_MODEL);
    expect(RAG_MODEL_CONFIG.answer.model).toBe(RAG_ANSWER_MODEL);
    expect(RAG_MODEL_CONFIG.agent.model).toBe(RAG_ANSWER_MODEL);
  });

  it("keeps effort low for grounded steps and medium for the agent's research rounds", () => {
    expect(RAG_MODEL_CONFIG.reformulate.thinking).toEqual({ type: "disabled" });
    expect(RAG_MODEL_CONFIG.reformulate.effort).toBe("low");
    expect(RAG_MODEL_CONFIG.rerank.effort).toBe("low");
    expect(RAG_MODEL_CONFIG.answer.effort).toBe("low");
    expect(RAG_MODEL_CONFIG.agent.effort).toBe("medium");
    expect(RAG_MODEL_CONFIG.agent.finalEffort).toBe("low");
  });

  it("uses the stable embedding model and versioned pipeline", () => {
    expect(RAG_EMBEDDING_MODEL).toBe("gemini-embedding-2");
    expect(RAG_PIPELINE_VERSION).toBe("rag-v3-independent-grounded");
  });
});
