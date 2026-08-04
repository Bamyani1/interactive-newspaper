import { describe, expect, it } from "vitest";
import {
  RAG_ANSWER_MODEL,
  RAG_EMBEDDING_MODEL,
  RAG_GENERATION_MODEL,
  RAG_MODEL_CONFIG,
  RAG_PIPELINE_VERSION,
} from "@/src/lib/rag-model-config";

describe("RAG model routing", () => {
  it("routes mechanical steps to Flash-Lite and judging/answering to full Flash", () => {
    // Reformulation is a cheap mechanical step; relevance judging and
    // answer writing need the full Flash tier — the lite model scores
    // every candidate for broad survey questions as tangential and writes
    // weaker prose than the previously served gemini-3-flash-preview.
    expect(RAG_GENERATION_MODEL).toBe("gemini-3.5-flash-lite");
    expect(RAG_ANSWER_MODEL).toBe("gemini-3.6-flash");
    expect(RAG_MODEL_CONFIG.reformulate.model).toBe(RAG_GENERATION_MODEL);
    expect(RAG_MODEL_CONFIG.rerank.model).toBe(RAG_ANSWER_MODEL);
    expect(RAG_MODEL_CONFIG.answer.model).toBe(RAG_ANSWER_MODEL);
    expect(RAG_MODEL_CONFIG.agent.model).toBe(RAG_ANSWER_MODEL);
  });

  it("reserves minimal/low thinking for grounded steps and medium for the agent loop", () => {
    expect(RAG_MODEL_CONFIG.reformulate.thinkingLevel).toBe("MINIMAL");
    expect(RAG_MODEL_CONFIG.rerank.thinkingLevel).toBe("MINIMAL");
    expect(RAG_MODEL_CONFIG.answer.thinkingLevel).toBe("LOW");
    expect(RAG_MODEL_CONFIG.agent.thinkingLevel).toBe("MEDIUM");
  });

  it("uses the stable embedding model and versioned pipeline", () => {
    expect(RAG_EMBEDDING_MODEL).toBe("gemini-embedding-2");
    expect(RAG_PIPELINE_VERSION).toBe("rag-v3-independent-grounded");
  });
});
