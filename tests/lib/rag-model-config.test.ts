import { describe, expect, it } from "vitest";
import {
  parseAnswerProfile,
  RAG_ANSWER_MODEL,
  RAG_EMBEDDING_DIMS,
  RAG_EMBEDDING_MODEL,
  RAG_GENERATION_MODEL,
  RAG_IMAGE_EMBEDDING_MODEL,
  RAG_MODEL_CONFIG,
  RAG_PIPELINE_VERSION,
  RAG_RERANK_MODEL,
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

  it("keeps effort low for rewriting and judging, and answers at the profile's effort", () => {
    expect(RAG_MODEL_CONFIG.reformulate.thinking).toEqual({ type: "disabled" });
    expect(RAG_MODEL_CONFIG.reformulate.effort).toBe("low");
    expect(RAG_MODEL_CONFIG.rerank.effort).toBe("low");
    expect(RAG_MODEL_CONFIG.answer.effort).toBe("medium");
    expect(RAG_MODEL_CONFIG.agent.effort).toBe("medium");
    expect(RAG_MODEL_CONFIG.agent.finalEffort).toBe("medium");
  });

  it("defaults to the Sonnet profile and rejects an unknown one", () => {
    expect(parseAnswerProfile(undefined)).toBe("sonnet-medium");
    expect(parseAnswerProfile("haiku-xhigh")).toBe("haiku-xhigh");
    expect(() => parseAnswerProfile("opus-max")).toThrow(/RAG_ANSWER_PROFILE/);
  });

  it("uses the Voyage models and the versioned pipeline", () => {
    expect(RAG_EMBEDDING_MODEL).toBe("voyage-context-4");
    expect(RAG_IMAGE_EMBEDDING_MODEL).toBe("voyage-multimodal-3.5");
    expect(RAG_EMBEDDING_DIMS).toBe(1024);
    expect(RAG_RERANK_MODEL).toBe("rerank-3");
    expect(RAG_PIPELINE_VERSION).toBe("rag-v4-voyage");
  });
});
