import { beforeEach, describe, expect, it, vi } from "vitest";

const { GoogleGenAIMock } = vi.hoisted(() => ({ GoogleGenAIMock: vi.fn() }));
vi.mock("@google/genai", () => ({ GoogleGenAI: GoogleGenAIMock }));

import { _resetGeminiClientForTests, getGeminiClient } from "@/src/lib/gemini-client";

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
      expect.objectContaining({ location: "us-central1" })
    );
  });

  it("prefers Vertex ADC over an API key when both are configured", () => {
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "archive-project");
    vi.stubEnv("GEMINI_API_KEY", "must-not-be-used");
    getGeminiClient();
    expect(GoogleGenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({ vertexai: true, project: "archive-project" })
    );
  });

  it("uses API-key mode without an ADC project (Vercel serving path)", () => {
    vi.stubEnv("GOOGLE_API_KEY", "serving-key");
    getGeminiClient();
    expect(GoogleGenAIMock).toHaveBeenCalledWith({
      apiKey: "serving-key",
      apiVersion: "v1",
    });
  });

  // Vercel has no gcloud ADC on disk and no metadata server, so the
  // serving path supplies a service account instead. Everything else about
  // the Vertex branch stays identical.
  describe("service-account credentials", () => {
    const KEY = {
      type: "service_account",
      client_email: "ask@archive-project.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n",
    };

    it("passes raw service-account JSON through to Vertex", () => {
      vi.stubEnv("GOOGLE_CLOUD_PROJECT", "archive-project");
      vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", JSON.stringify(KEY));
      getGeminiClient();
      expect(GoogleGenAIMock).toHaveBeenCalledWith(
        expect.objectContaining({
          vertexai: true,
          project: "archive-project",
          googleAuthOptions: {
            credentials: { client_email: KEY.client_email, private_key: KEY.private_key },
          },
        })
      );
    });

    // The key is multi-line and holds an escaped private key, which a CLI
    // or dashboard round-trip mangles far more readily than one line does.
    it("accepts the same JSON base64-encoded", () => {
      vi.stubEnv("GOOGLE_CLOUD_PROJECT", "archive-project");
      vi.stubEnv(
        "GOOGLE_SERVICE_ACCOUNT_JSON",
        Buffer.from(JSON.stringify(KEY), "utf8").toString("base64")
      );
      getGeminiClient();
      expect(GoogleGenAIMock).toHaveBeenCalledWith(
        expect.objectContaining({
          googleAuthOptions: {
            credentials: expect.objectContaining({ client_email: KEY.client_email }),
          },
        })
      );
    });

    it("leaves the constructor untouched when no credentials are supplied", () => {
      vi.stubEnv("GOOGLE_CLOUD_PROJECT", "archive-project");
      getGeminiClient();
      expect(GoogleGenAIMock.mock.calls[0][0]).not.toHaveProperty("googleAuthOptions");
    });

    // Falling back to ADC would strand the request at the first model call
    // with an unrelated credentials error, several layers from the typo.
    it("throws on a value that is neither JSON nor base64 JSON", () => {
      vi.stubEnv("GOOGLE_CLOUD_PROJECT", "archive-project");
      vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", "oops-pasted-the-wrong-thing");
      expect(() => getGeminiClient()).toThrow(/neither service-account JSON nor base64/);
      expect(GoogleGenAIMock).not.toHaveBeenCalled();
    });

    it("throws on JSON that is not a service-account key", () => {
      vi.stubEnv("GOOGLE_CLOUD_PROJECT", "archive-project");
      vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", JSON.stringify({ project_id: "archive-project" }));
      expect(() => getGeminiClient()).toThrow(/no client_email\/private_key/);
    });
  });

  it("throws when neither ADC project nor API key is configured", () => {
    expect(() => getGeminiClient()).toThrow(/Gemini auth is not configured/);
    expect(GoogleGenAIMock).not.toHaveBeenCalled();
  });
});
