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
    relevanceScore: 8, // default to "relevant" so confidence tests still work
    ...overrides,
  };
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
    });
  });

  describe("citation parsing", () => {
    it("extracts a single citation from the answer", async () => {
      const generateAnswer = await importGenerateAnswer();
      mockGenerateContent.mockResolvedValue({
        text: "The campus held elections in January [Source 1].",
      });

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
      mockGenerateContent.mockResolvedValue({
        text: "Elections were held [Source 1] and sports continued [Source 3].",
      });

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
      mockGenerateContent.mockResolvedValue({
        text: "The event was significant [Source 1] and had lasting impact [Source 1].",
      });

      const articles = [makeArticle({ id: "art-0", headline: "Big Event" })];

      const result = await generateAnswer("What happened?", articles);

      expect(result.citations).toHaveLength(1);
      expect(result.citations[0].articleId).toBe("art-0");
    });

    it("returns empty citations for out-of-range source references", async () => {
      const generateAnswer = await importGenerateAnswer();
      mockGenerateContent.mockResolvedValue({
        text: "Something happened [Source 99].",
      });

      const articles = [makeArticle()];

      const result = await generateAnswer("What happened?", articles);

      expect(result.citations).toEqual([]);
    });

    it("strips preamble even with single newline separator", async () => {
      const generateAnswer = await importGenerateAnswer();
      mockGenerateContent.mockResolvedValue({
        text: "Relevant sources: [Source 1]\nThe campus held elections [Source 1].",
      });

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
      mockGenerateContent.mockResolvedValue({
        text: "The answer is clear [Source 1] [Source 2] [Source 3].",
      });

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
      mockGenerateContent.mockResolvedValue({
        text: "Some relevant info [Source 1].",
      });

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
      mockGenerateContent.mockResolvedValue({
        text: "Found via text search [Source 1].",
      });

      const articles = [
        makeArticle({ id: "a", distance: null, source: "fts", relevanceScore: 6 }),
        makeArticle({ id: "b", distance: null, source: "fts", relevanceScore: 6 }),
      ];

      const result = await generateAnswer("question", articles);

      expect(result.confidence).toBe("medium");
    });

    it("FTS-only with strong reranker score (>=8) gives HIGH confidence (issue 0029-related)", async () => {
      // Before Step 9, FTS-only paths were capped at medium because a fake
      // 0.27 default distance failed the < 0.26 high gate. After fix: high
      // reranker score lifts FTS-only to high.
      const generateAnswer = await importGenerateAnswer();
      mockGenerateContent.mockResolvedValue({
        text: "Strong match found [Source 1] [Source 2].",
      });

      const articles = [
        makeArticle({ id: "a", distance: null, source: "fts", relevanceScore: 9 }),
        makeArticle({ id: "b", distance: null, source: "fts", relevanceScore: 8 }),
      ];

      const result = await generateAnswer("question", articles);

      expect(result.confidence).toBe("high");
    });

    it("FTS-only with weak reranker score (<5) gives low confidence", async () => {
      const generateAnswer = await importGenerateAnswer();
      mockGenerateContent.mockResolvedValue({
        text: "Weak match [Source 1].",
      });

      const articles = [
        makeArticle({ id: "a", distance: null, source: "fts", relevanceScore: 3 }),
        makeArticle({ id: "b", distance: null, source: "fts", relevanceScore: 4 }),
      ];

      const result = await generateAnswer("question", articles);

      expect(result.confidence).toBe("low");
    });

    it("FTS-only does NOT trigger the 'don't seem to be closely related' skip", async () => {
      // The skip-Gemini check used to fire on the fake 0.27 default; after
      // Step 9 it only fires when actual vector distance > 0.30. FTS-only
      // questions should always reach the LLM.
      const generateAnswer = await importGenerateAnswer();
      mockGenerateContent.mockResolvedValue({
        text: "FTS path reached the LLM [Source 1].",
      });

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
      mockGenerateContent.mockResolvedValue({
        text: "Good info [Source 1] [Source 2].",
      });

      const articles = [
        makeArticle({ id: "a", distance: 0.22, source: "vector" }),
        makeArticle({ id: "b", distance: 0.22, source: "vector" }),
        makeArticle({ id: "c", distance: null, source: "fts" }),
        makeArticle({ id: "d", distance: null, source: "fts" }),
      ];

      const result = await generateAnswer("question", articles);

      // avgDistance = 0.22 from vector-only, articleCount = 4 >= 2 -> high
      expect(result.confidence).toBe("high");
    });

    it("downgrades confidence when reranker scores are mediocre even with close distance", async () => {
      const generateAnswer = await importGenerateAnswer();
      mockGenerateContent.mockResolvedValue({
        text: "Some info [Source 1].",
      });

      // Close vector distance but reranker says only "somewhat relevant"
      // → should be medium, not high
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
      mockGenerateContent.mockResolvedValue({
        text: "The answer references [Source 2] which does not exist.",
      });

      // Only 1 article, but the answer references [Source 2] (out of range)
      const articles = [makeArticle({ distance: 0.2, source: "vector" })];

      const result = await generateAnswer("question", articles);

      // hasSourceRefs is true, but citations.length is 0 -> downgrade to low
      expect(result.citations).toEqual([]);
      expect(result.confidence).toBe("low");
    });
  });
});
