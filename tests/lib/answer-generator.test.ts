import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RankedArticle } from "@/src/lib/reranker";

// ── Mock ─────────────────────────────────────────────────────────────

const mockGenerateContent = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
}));

// ── Helpers ──────────────────────────────────────────────────────────

function makeArticle(overrides: Partial<RankedArticle> = {}): RankedArticle {
  return {
    id: "1960-01-07-0",
    editionDate: "1960-01-07",
    category: "News",
    headline: "Test Headline",
    summary: "Test summary",
    byline: "Test Author",
    bodyPlain: "This is a test article body with enough content.",
    distance: 0.25,
    source: "vector",
    imageUrls: [],
    imageCaptions: [],
    relevanceScore: 8, // default to "relevant" so confidence tests still work
    ...overrides,
  };
}

function jsonMock(answer: string, followUps: string[] = []): { text: string } {
  return { text: JSON.stringify({ answer, follow_ups: followUps }) };
}

// ── Tests ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetModules();
  mockGenerateContent.mockReset();
  process.env.GEMINI_API_KEY = "test-key";
});

async function importGenerateAnswer() {
  const mod = await import("@/src/lib/answer-generator");
  return mod.generateAnswer;
}

async function importParseAnswerResponse() {
  const mod = await import("@/src/lib/answer-generator");
  return mod.parseAnswerResponse;
}

describe("parseAnswerResponse", () => {
  it("parses valid JSON response", async () => {
    const parse = await importParseAnswerResponse();
    const result = parse(JSON.stringify({
      answer: "The campus held elections [Source 1].",
      follow_ups: ["Q1", "Q2"],
    }));
    expect(result.answer).toBe("The campus held elections [Source 1].");
    expect(result.followUps).toEqual(["Q1", "Q2"]);
  });

  it("falls back to raw text when JSON is malformed", async () => {
    const parse = await importParseAnswerResponse();
    const result = parse("not json at all");
    expect(result.answer).toBe("not json at all");
    expect(result.followUps).toEqual([]);
  });

  it("returns empty followUps when field is missing", async () => {
    const parse = await importParseAnswerResponse();
    const result = parse(JSON.stringify({ answer: "Just the answer [Source 1]." }));
    expect(result.answer).toBe("Just the answer [Source 1].");
    expect(result.followUps).toEqual([]);
  });

  it("filters non-string items from follow_ups", async () => {
    const parse = await importParseAnswerResponse();
    const result = parse(JSON.stringify({
      answer: "X [Source 1].",
      follow_ups: ["valid Q", 42, null, "", "another Q"],
    }));
    expect(result.followUps).toEqual(["valid Q", "another Q"]);
  });

  it("strips markdown code fences before parsing", async () => {
    const parse = await importParseAnswerResponse();
    const raw = "```json\n" + JSON.stringify({
      answer: "Hello [Source 1].",
      follow_ups: [],
    }) + "\n```";
    const result = parse(raw);
    expect(result.answer).toBe("Hello [Source 1].");
  });

  it("caps follow_ups at 3", async () => {
    const parse = await importParseAnswerResponse();
    const result = parse(JSON.stringify({
      answer: "X [Source 1].",
      follow_ups: ["Q1", "Q2", "Q3", "Q4", "Q5"],
    }));
    expect(result.followUps).toHaveLength(3);
    expect(result.followUps).toEqual(["Q1", "Q2", "Q3"]);
  });
});

describe("generateAnswer", () => {
  describe("empty articles", () => {
    it("returns low confidence when no articles provided", async () => {
      const generateAnswer = await importGenerateAnswer();

      const result = await generateAnswer("question", []);

      expect(result.answer).toBe(
        "I don't have enough information in the archive to answer this question."
      );
      expect(result.citations).toEqual([]);
      expect(result.confidence).toBe("low");
      expect(result.followUps).toEqual([]);
    });
  });

  describe("citation parsing", () => {
    it("extracts a single citation from the answer", async () => {
      const generateAnswer = await importGenerateAnswer();
      mockGenerateContent.mockResolvedValue(
        jsonMock("The campus held elections in January [Source 1].")
      );

      const articles = [
        makeArticle({ id: "1960-01-07-0", headline: "Election Results" }),
        makeArticle({ id: "1960-01-07-1", headline: "Sports Recap" }),
      ];

      const result = await generateAnswer("What happened?", articles);

      expect(result.citations).toHaveLength(1);
      expect(result.citations[0]).toEqual({
        articleId: "1960-01-07-0",
        headline: "Election Results",
        editionDate: "1960-01-07",
      });
    });

    it("extracts multiple citations from the answer", async () => {
      const generateAnswer = await importGenerateAnswer();
      mockGenerateContent.mockResolvedValue(
        jsonMock("Elections were held [Source 1] and sports continued [Source 3].")
      );

      const articles = [
        makeArticle({ id: "art-0", headline: "Elections" }),
        makeArticle({ id: "art-1", headline: "Weather" }),
        makeArticle({ id: "art-2", headline: "Sports" }),
      ];

      const result = await generateAnswer("What happened?", articles);

      expect(result.citations).toHaveLength(2);
      expect(result.citations[0]).toEqual({
        articleId: "art-0",
        headline: "Elections",
        editionDate: "1960-01-07",
      });
      expect(result.citations[1]).toEqual({
        articleId: "art-2",
        headline: "Sports",
        editionDate: "1960-01-07",
      });
    });

    it("deduplicates repeated citations to the same source", async () => {
      const generateAnswer = await importGenerateAnswer();
      mockGenerateContent.mockResolvedValue(
        jsonMock("The event was significant [Source 1] and had lasting impact [Source 1].")
      );

      const articles = [makeArticle({ id: "art-0", headline: "Big Event" })];

      const result = await generateAnswer("What happened?", articles);

      expect(result.citations).toHaveLength(1);
      expect(result.citations[0].articleId).toBe("art-0");
    });

    it("returns empty citations for out-of-range source references", async () => {
      const generateAnswer = await importGenerateAnswer();
      mockGenerateContent.mockResolvedValue(
        jsonMock("Something happened [Source 99].")
      );

      const articles = [makeArticle()];

      const result = await generateAnswer("What happened?", articles);

      expect(result.citations).toEqual([]);
    });

    it("strips preamble even with single newline separator", async () => {
      const generateAnswer = await importGenerateAnswer();
      mockGenerateContent.mockResolvedValue(
        jsonMock("Relevant sources: [Source 1]\nThe campus held elections [Source 1].")
      );

      const articles = [
        makeArticle({ id: "1960-01-07-0", headline: "Election Results" }),
      ];

      const result = await generateAnswer("What happened?", articles);

      // The "Relevant sources:" line should be stripped even with only \n
      expect(result.answer).not.toContain("Relevant sources:");
      expect(result.answer).toContain("The campus held elections");
    });
  });

  describe("confidence scoring", () => {
    it("returns high confidence for close vector matches", async () => {
      const generateAnswer = await importGenerateAnswer();
      mockGenerateContent.mockResolvedValue(
        jsonMock("The answer is clear [Source 1] [Source 2] [Source 3].")
      );

      const articles = [
        makeArticle({ id: "a", distance: 0.2, source: "vector" }),
        makeArticle({ id: "b", distance: 0.2, source: "vector" }),
        makeArticle({ id: "c", distance: 0.2, source: "vector" }),
      ];

      const result = await generateAnswer("question", articles);

      expect(result.confidence).toBe("high");
    });

    it("returns medium confidence for moderate vector distances", async () => {
      const generateAnswer = await importGenerateAnswer();
      mockGenerateContent.mockResolvedValue(
        jsonMock("Some relevant info [Source 1].")
      );

      const articles = [
        makeArticle({ id: "a", distance: 0.27, source: "vector", relevanceScore: 6 }),
        makeArticle({ id: "b", distance: 0.27, source: "vector", relevanceScore: 6 }),
      ];

      const result = await generateAnswer("question", articles);

      expect(result.confidence).toBe("medium");
    });

    it("returns low confidence disclaimer for distant vector matches without calling Gemini", async () => {
      const generateAnswer = await importGenerateAnswer();

      const articles = [
        makeArticle({ distance: 0.5, source: "vector", relevanceScore: 3 }),
        makeArticle({ distance: 0.5, source: "vector", relevanceScore: 3 }),
      ];

      const result = await generateAnswer("question", articles);

      expect(result.confidence).toBe("low");
      expect(result.answer).toContain("don't seem to be closely related");
      expect(result.citations).toEqual([]);
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it("FTS-only with mid reranker score (6) gives medium confidence", async () => {
      const generateAnswer = await importGenerateAnswer();
      mockGenerateContent.mockResolvedValue(
        jsonMock("Found via text search [Source 1].")
      );

      const articles = [
        makeArticle({ id: "a", distance: null, source: "fts", relevanceScore: 6 }),
        makeArticle({ id: "b", distance: null, source: "fts", relevanceScore: 6 }),
      ];

      const result = await generateAnswer("question", articles);

      expect(result.confidence).toBe("medium");
    });

    it("FTS-only with strong reranker score (>=8) gives HIGH confidence (issue 0029-related)", async () => {
      const generateAnswer = await importGenerateAnswer();
      mockGenerateContent.mockResolvedValue(
        jsonMock("Strong match found [Source 1] [Source 2].")
      );

      const articles = [
        makeArticle({ id: "a", distance: null, source: "fts", relevanceScore: 9 }),
        makeArticle({ id: "b", distance: null, source: "fts", relevanceScore: 8 }),
      ];

      const result = await generateAnswer("question", articles);

      expect(result.confidence).toBe("high");
    });

    it("FTS-only with weak reranker score (<5) gives low confidence", async () => {
      const generateAnswer = await importGenerateAnswer();
      mockGenerateContent.mockResolvedValue(
        jsonMock("Weak match [Source 1].")
      );

      const articles = [
        makeArticle({ id: "a", distance: null, source: "fts", relevanceScore: 3 }),
        makeArticle({ id: "b", distance: null, source: "fts", relevanceScore: 4 }),
      ];

      const result = await generateAnswer("question", articles);

      expect(result.confidence).toBe("low");
    });

    it("FTS-only does NOT trigger the 'don't seem to be closely related' skip", async () => {
      const generateAnswer = await importGenerateAnswer();
      mockGenerateContent.mockResolvedValue(
        jsonMock("FTS path reached the LLM [Source 1].")
      );

      const articles = [
        makeArticle({ id: "a", distance: null, source: "fts", relevanceScore: 4 }),
        makeArticle({ id: "b", distance: null, source: "fts", relevanceScore: 3 }),
      ];

      const result = await generateAnswer("question", articles);

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(result.answer).toContain("FTS path reached the LLM");
    });

    it("uses only vector distances when mixed with FTS results", async () => {
      const generateAnswer = await importGenerateAnswer();
      mockGenerateContent.mockResolvedValue(
        jsonMock("Good info [Source 1] [Source 2].")
      );

      const articles = [
        makeArticle({ id: "a", distance: 0.22, source: "vector" }),
        makeArticle({ id: "b", distance: 0.22, source: "vector" }),
        makeArticle({ id: "c", distance: null, source: "fts" }),
        makeArticle({ id: "d", distance: null, source: "fts" }),
      ];

      const result = await generateAnswer("question", articles);

      expect(result.confidence).toBe("high");
    });

    it("downgrades confidence when reranker scores are mediocre even with close distance", async () => {
      const generateAnswer = await importGenerateAnswer();
      mockGenerateContent.mockResolvedValue(
        jsonMock("Some info [Source 1].")
      );

      const articles = [
        makeArticle({ id: "a", distance: 0.20, source: "vector", relevanceScore: 5 }),
        makeArticle({ id: "b", distance: 0.20, source: "vector", relevanceScore: 5 }),
      ];

      const result = await generateAnswer("question", articles);

      expect(result.confidence).toBe("medium");
    });
  });

  describe("error handling", () => {
    it("returns fallback message when Gemini returns empty text", async () => {
      const generateAnswer = await importGenerateAnswer();
      mockGenerateContent.mockResolvedValue({ text: "" });

      const articles = [makeArticle()];

      const result = await generateAnswer("question", articles);

      expect(result.answer).toBe(
        "I wasn't able to generate an answer from the available sources. Please try rephrasing your question."
      );
      expect(result.citations).toEqual([]);
      expect(result.confidence).toBe("low");
    });

    it("returns timeout message when Gemini request is aborted", async () => {
      const generateAnswer = await importGenerateAnswer();
      const abortError = new Error("The operation was aborted.");
      abortError.name = "AbortError";
      mockGenerateContent.mockRejectedValue(abortError);

      const articles = [makeArticle()];

      const result = await generateAnswer("question", articles);

      expect(result.answer).toBe(
        "The answer took too long to generate. Please try a simpler question."
      );
      expect(result.citations).toEqual([]);
      expect(result.confidence).toBe("low");
    });

    it("returns error message when Gemini throws a generic error", async () => {
      const generateAnswer = await importGenerateAnswer();
      mockGenerateContent.mockRejectedValue(new Error("API limit reached"));

      const articles = [makeArticle()];

      const result = await generateAnswer("question", articles);

      expect(result.answer).toBe(
        "I encountered an error while generating an answer. Please try again."
      );
      expect(result.citations).toEqual([]);
      expect(result.confidence).toBe("low");
    });
  });

  describe("confidence validation", () => {
    it("downgrades to low confidence when answer has source refs but no valid citations", async () => {
      const generateAnswer = await importGenerateAnswer();
      mockGenerateContent.mockResolvedValue(
        jsonMock("The answer references [Source 2] which does not exist.")
      );

      const articles = [makeArticle({ distance: 0.2, source: "vector" })];

      const result = await generateAnswer("question", articles);

      expect(result.citations).toEqual([]);
      expect(result.confidence).toBe("low");
    });
  });

  describe("image-aware prompt", () => {
    function lastUserPromptText(): string {
      const call = mockGenerateContent.mock.calls[0][0] as {
        contents: Array<{ parts: Array<{ text: string }> }>;
      };
      return call.contents[0].parts[0].text;
    }

    it("appends an Images: block per source when imageUrls are present", async () => {
      const generateAnswer = await importGenerateAnswer();
      mockGenerateContent.mockResolvedValue(
        jsonMock("Answer with image [Source 1].")
      );

      const articles = [
        makeArticle({
          id: "1978-10-14-3",
          imageUrls: [
            "https://cdn/a.webp",
            "https://cdn/b.webp",
          ],
          imageCaptions: ["Homecoming parade 1978", null],
        }),
      ];

      await generateAnswer("what was homecoming like?", articles);

      const prompt = lastUserPromptText();
      expect(prompt).toContain("Images:");
      expect(prompt).toContain("[Homecoming parade 1978]");
      expect(prompt).toContain("https://cdn/a.webp");
      expect(prompt).toContain("[Untitled photo]");
      expect(prompt).toContain("https://cdn/b.webp");
    });

    it("omits the Images: block entirely when no sources have images", async () => {
      const generateAnswer = await importGenerateAnswer();
      mockGenerateContent.mockResolvedValue(
        jsonMock("Plain answer [Source 1].")
      );

      const articles = [makeArticle({ imageUrls: [], imageCaptions: [] })];

      await generateAnswer("what happened?", articles);

      const prompt = lastUserPromptText();
      expect(prompt).not.toContain("Images:");
    });
  });

  describe("follow-up questions", () => {
    it("returns followUps from valid JSON response", async () => {
      const generateAnswer = await importGenerateAnswer();
      mockGenerateContent.mockResolvedValue(
        jsonMock("Answer with source [Source 1].", [
          "Who coached that year?",
          "What was the record?",
        ])
      );

      const articles = [makeArticle()];
      const result = await generateAnswer("question", articles);

      expect(result.followUps).toEqual([
        "Who coached that year?",
        "What was the record?",
      ]);
    });

    it("returns empty followUps when Gemini returns malformed JSON", async () => {
      const generateAnswer = await importGenerateAnswer();
      mockGenerateContent.mockResolvedValue({
        text: "not valid json [Source 1]",
      });

      const articles = [makeArticle()];
      const result = await generateAnswer("question", articles);

      // Malformed JSON → fall back to raw text as answer, empty followUps
      expect(result.followUps).toEqual([]);
      // But the answer should still be the raw text
      expect(result.answer).toContain("not valid json");
    });
  });
});
