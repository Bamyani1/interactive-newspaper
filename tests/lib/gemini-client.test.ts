import { beforeEach, describe, expect, it, vi } from "vitest";

const { GoogleGenAIMock } = vi.hoisted(() => ({ GoogleGenAIMock: vi.fn() }));
vi.mock("@google/genai", () => ({ GoogleGenAI: GoogleGenAIMock }));

import {
  _resetGeminiClientForTests,
  getGeminiClient,
} from "@/src/lib/gemini-client";

describe("Gemini Vertex client", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    GoogleGenAIMock.mockReset();
    GoogleGenAIMock.mockImplementation((options) => ({ options }));
    _resetGeminiClientForTests();
  });

  it("uses Vertex AI, ADC, global location, and the stable v1 endpoint", () => {
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "archive-project");
    const client = getGeminiClient();
    expect(GoogleGenAIMock).toHaveBeenCalledWith({
      vertexai: true,
      project: "archive-project",
      location: "global",
      apiVersion: "v1",
    });
    expect(client).toBe(getGeminiClient());
    expect(GoogleGenAIMock).toHaveBeenCalledTimes(1);
  });

  it("honors an explicit Vertex location", () => {
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "archive-project");
    vi.stubEnv("GOOGLE_CLOUD_LOCATION", "us-central1");
    getGeminiClient();
    expect(GoogleGenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({ location: "us-central1" }),
    );
  });

  it("does not fall back to an API key when the ADC project is missing", () => {
    vi.stubEnv("GEMINI_API_KEY", "must-not-be-used");
    expect(() => getGeminiClient()).toThrow(/GOOGLE_CLOUD_PROJECT/);
    expect(GoogleGenAIMock).not.toHaveBeenCalled();
  });
});
