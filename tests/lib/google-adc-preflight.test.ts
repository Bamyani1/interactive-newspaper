import { describe, expect, it } from "vitest";
import { validateGoogleRuntimeEnv } from "../../scripts/google/verify-adc";

const validEnv = {
  GOOGLE_CLOUD_PROJECT: "archive-project",
  GOOGLE_CLOUD_LOCATION: "global",
  DOCUMENT_AI_LOCATION: "us",
  DOCUMENT_AI_PROCESSOR_ID: "processor-id",
  GOOGLE_ADC_EXPECTED_PRINCIPAL: "owner@example.com",
} as unknown as NodeJS.ProcessEnv;

describe("Google ADC preflight configuration", () => {
  it("accepts the locked Vertex and Document AI configuration", () => {
    expect(validateGoogleRuntimeEnv(validEnv)).toEqual({
      project: "archive-project",
      vertexLocation: "global",
      documentAiLocation: "us",
      documentAiProcessorId: "processor-id",
      expectedPrincipal: "owner@example.com",
    });
  });

  it("rejects API keys even when an ADC project is configured", () => {
    expect(() =>
      validateGoogleRuntimeEnv({ ...validEnv, GEMINI_API_KEY: "legacy-key" }),
    ).toThrow(/ADC-only policy violation/);
    expect(() =>
      validateGoogleRuntimeEnv({ ...validEnv, GOOGLE_API_KEY: "legacy-key" }),
    ).toThrow(/ADC-only policy violation/);
  });

  it("rejects a missing project, processor, or non-global Vertex location", () => {
    expect(() =>
      validateGoogleRuntimeEnv({ ...validEnv, GOOGLE_CLOUD_PROJECT: "" }),
    ).toThrow(/GOOGLE_CLOUD_PROJECT/);
    expect(() =>
      validateGoogleRuntimeEnv({ ...validEnv, DOCUMENT_AI_PROCESSOR_ID: "" }),
    ).toThrow(/DOCUMENT_AI_PROCESSOR_ID/);
    expect(() =>
      validateGoogleRuntimeEnv({ ...validEnv, GOOGLE_CLOUD_LOCATION: "us-central1" }),
    ).toThrow(/must be global/);
  });
});
