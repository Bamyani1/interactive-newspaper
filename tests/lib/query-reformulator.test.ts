import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: vi.fn(),
    },
  })),
}));

// Set API key before importing the module
vi.stubEnv("GEMINI_API_KEY", "test-key");

import {
  reformulateQuery as _reformulateQuery,
  parseReformulationResponse,
} from "@/src/lib/query-reformulator";
import { GoogleGenAI } from "@google/genai";

function _getMockClient() {
  // Get the mock instance created by the module
  const MockGoogleGenAI = GoogleGenAI as unknown as ReturnType<typeof vi.fn>;
  const instance = MockGoogleGenAI.mock.results[0]?.value;
  return instance;
}

describe("parseReformulationResponse", () => {
  const fallback = {
    embeddingQuery: "original question",
    ftsQuery: "original question",
    mode: "text" as const,
  };

  it("parses valid SEMANTIC + KEYWORDS response", () => {
    const text =
      "SEMANTIC: Ohio Wesleyan University basketball cagers hoopsters team\nKEYWORDS: basketball OR cagers OR hoopsters OR \"Battling Bishops\"";
    const result = parseReformulationResponse(text, fallback);

    expect(result.embeddingQuery).toBe(
      "Ohio Wesleyan University basketball cagers hoopsters team"
    );
    expect(result.ftsQuery).toBe(
      'basketball OR cagers OR hoopsters OR "Battling Bishops"'
    );
  });

  it("returns fallback when SEMANTIC line is missing", () => {
    const text = 'KEYWORDS: basketball OR cagers';
    const result = parseReformulationResponse(text, fallback);
    expect(result).toBe(fallback);
  });

  it("returns fallback when KEYWORDS line is missing", () => {
    const text = "SEMANTIC: basketball team history";
    const result = parseReformulationResponse(text, fallback);
    expect(result).toBe(fallback);
  });

  it("returns fallback for empty string", () => {
    const result = parseReformulationResponse("", fallback);
    expect(result).toBe(fallback);
  });

  it("returns fallback when values are empty", () => {
    const text = "SEMANTIC: \nKEYWORDS: ";
    const result = parseReformulationResponse(text, fallback);
    expect(result).toBe(fallback);
  });

  it("parses MODE field from response", () => {
    const result = parseReformulationResponse(
      "SEMANTIC: campus buildings\nKEYWORDS: campus OR buildings\nMODE: visual",
      { embeddingQuery: "fallback", ftsQuery: "fallback", mode: "text" },
    );
    expect(result.mode).toBe("visual");
  });

  it("defaults mode to text when MODE line is missing", () => {
    const result = parseReformulationResponse(
      "SEMANTIC: campus news\nKEYWORDS: campus OR news",
      { embeddingQuery: "fallback", ftsQuery: "fallback", mode: "text" },
    );
    expect(result.mode).toBe("text");
  });

  it("parses ERAS line with two valid eras", () => {
    const text =
      'SEMANTIC: student life changes\nKEYWORDS: life OR campus\nMODE: text\nERAS: ["1960s", "1990s"]';
    const result = parseReformulationResponse(text, {
      embeddingQuery: "fallback",
      ftsQuery: "fallback",
      mode: "text",
    });
    expect(result.eras).toBeDefined();
    expect(result.eras).toHaveLength(2);
    expect(result.eras![0].startDate).toBe("1960-01-01");
    expect(result.eras![1].startDate).toBe("1990-01-01");
  });

  it("returns no eras when ERAS line is missing", () => {
    const text =
      "SEMANTIC: campus news\nKEYWORDS: campus OR news\nMODE: text";
    const result = parseReformulationResponse(text, {
      embeddingQuery: "fallback",
      ftsQuery: "fallback",
      mode: "text",
    });
    expect(result.eras).toBeUndefined();
  });

  it("returns no eras for single-era ERAS line (< 2 after parse)", () => {
    const text =
      'SEMANTIC: campus news\nKEYWORDS: campus OR news\nMODE: text\nERAS: ["1960s"]';
    const result = parseReformulationResponse(text, {
      embeddingQuery: "fallback",
      ftsQuery: "fallback",
      mode: "text",
    });
    expect(result.eras).toBeUndefined();
  });

  it("returns no eras for malformed ERAS JSON", () => {
    const text =
      "SEMANTIC: campus news\nKEYWORDS: campus OR news\nMODE: text\nERAS: not-json";
    const result = parseReformulationResponse(text, {
      embeddingQuery: "fallback",
      ftsQuery: "fallback",
      mode: "text",
    });
    expect(result.eras).toBeUndefined();
  });

  it("collapses overlapping eras to single → returns undefined", () => {
    const text =
      'SEMANTIC: campus news\nKEYWORDS: campus OR news\nMODE: text\nERAS: ["1970", "early 1970s"]';
    const result = parseReformulationResponse(text, {
      embeddingQuery: "fallback",
      ftsQuery: "fallback",
      mode: "text",
    });
    // "1970" is a single year (1970-01-01..1970-12-31), "early 1970s" is
    // 1970-01-01..1973-12-31. The single year has >50% overlap with the
    // qualified decade → collapse to one → only 1 remaining → undefined.
    expect(result.eras).toBeUndefined();
  });

  it("keeps non-overlapping eras", () => {
    const text =
      'SEMANTIC: campus life\nKEYWORDS: campus OR life\nMODE: text\nERAS: ["early 1960s", "late 1990s"]';
    const result = parseReformulationResponse(text, {
      embeddingQuery: "fallback",
      ftsQuery: "fallback",
      mode: "text",
    });
    expect(result.eras).toBeDefined();
    expect(result.eras).toHaveLength(2);
    expect(result.eras![0].startDate).toBe("1960-01-01");
    expect(result.eras![1].startDate).toBe("1997-01-01");
  });

  it("drops unparseable era labels and keeps valid ones", () => {
    const text =
      'SEMANTIC: campus life\nKEYWORDS: campus OR life\nMODE: text\nERAS: ["1960s", "notanera", "1990s"]';
    const result = parseReformulationResponse(text, {
      embeddingQuery: "fallback",
      ftsQuery: "fallback",
      mode: "text",
    });
    expect(result.eras).toBeDefined();
    expect(result.eras).toHaveLength(2);
  });
});

describe("reformulateQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module singleton by clearing constructor calls
    (GoogleGenAI as unknown as ReturnType<typeof vi.fn>).mockClear();
    (GoogleGenAI as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      models: {
        generateContent: vi.fn(),
      },
    }));
  });

  it("returns reformulated queries on success", async () => {
    (GoogleGenAI as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: "SEMANTIC: Ohio Wesleyan basketball cagers\nKEYWORDS: basketball OR cagers OR hoopsters",
        }),
      },
    }));

    // Force re-import to pick up new mock
    vi.resetModules();
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const mod = await import("@/src/lib/query-reformulator");

    const result = await mod.reformulateQuery("What basketball teams existed?");
    expect(result.embeddingQuery).toBe("Ohio Wesleyan basketball cagers");
    expect(result.ftsQuery).toBe("basketball OR cagers OR hoopsters");
  });

  it("returns original question on API error", async () => {
    (GoogleGenAI as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      models: {
        generateContent: vi.fn().mockRejectedValue(new Error("API error")),
      },
    }));

    vi.resetModules();
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const mod = await import("@/src/lib/query-reformulator");

    const result = await mod.reformulateQuery("What happened at OWU?");
    expect(result.embeddingQuery).toBe("What happened at OWU?");
    expect(result.ftsQuery).toBe("What happened at OWU?");
  });

  it("returns original question on unparseable response", async () => {
    (GoogleGenAI as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: "I don't understand what you mean",
        }),
      },
    }));

    vi.resetModules();
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const mod = await import("@/src/lib/query-reformulator");

    const result = await mod.reformulateQuery("test question");
    expect(result.embeddingQuery).toBe("test question");
    expect(result.ftsQuery).toBe("test question");
  });
});
