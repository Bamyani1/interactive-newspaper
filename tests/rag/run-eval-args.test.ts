import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArgs } from "../../scripts/rag/run-eval";

afterEach(() => vi.unstubAllEnvs());

describe("run-eval parseArgs", () => {
  it("evaluates versioned retrieval when the env names no mode", () => {
    vi.stubEnv("RAG_RETRIEVAL_MODE", "");
    expect(parseArgs(["--out", "x", "--build", "build-1"]).mode).toBe("versioned");
  });

  it("rejects the removed legacy mode", () => {
    expect(() => parseArgs(["--out", "x", "--build", "build-1", "--mode", "legacy"])).toThrow(
      /--mode must be versioned/
    );
  });

  it("still requires a build to evaluate", () => {
    vi.stubEnv("RAG_ACTIVE_INDEX_BUILD_ID", "");
    expect(() => parseArgs(["--out", "x"])).toThrow(/--build <id> is required/);
  });
});
