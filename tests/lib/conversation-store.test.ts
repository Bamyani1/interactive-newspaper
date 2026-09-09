/** @vitest-environment node */
import { createHash } from "node:crypto";
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

// Mock the Neon SQL tag so tests can control each returned row.
const { sqlMock } = vi.hoisted(() => {
  const mock = vi.fn() as ReturnType<typeof vi.fn> & {
    transaction: ReturnType<typeof vi.fn>;
  };
  mock.transaction = vi.fn();
  return { sqlMock: mock };
});
vi.mock("@neondatabase/serverless", () => ({ neon: () => sqlMock }));

// Ensure lazy getSql() returns our mock (requires a non-empty URL).
beforeAll(() => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://fake/test";
});

import {
  getConversationHistory,
  addConversationTurn,
  deleteConversationTurns,
  deleteLatestTurn,
  sessionHasAnyTurns,
  newSessionId,
  formatHistoryForPrompt,
  _clearSessionsForTests,
} from "@/src/lib/conversation-store";

describe("conversation-store", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    _clearSessionsForTests();
    sqlMock.mockReset();
    sqlMock.transaction.mockReset();
  });

  it("generates unique session IDs", () => {
    const a = newSessionId();
    const b = newSessionId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(8);
  });

  it("generates 43-char base64url session tokens", () => {
    const a = newSessionId();
    const b = newSessionId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(b).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("never sends the raw session token to the database — only its sha256 hex", async () => {
    const rawToken = "raw-session-token-for-capture-test";
    const hashed = createHash("sha256").update(rawToken).digest("hex");

    sqlMock.mockResolvedValue([]);
    sqlMock.transaction.mockResolvedValue(undefined);

    await getConversationHistory(rawToken);
    await addConversationTurn(rawToken, "Q", "A", ["art-1"]);
    await deleteConversationTurns(rawToken);
    await sessionHasAnyTurns(rawToken);

    const allParams = sqlMock.mock.calls.flatMap((call) => call.slice(1));
    expect(allParams.length).toBeGreaterThan(0);
    expect(allParams).not.toContain(rawToken);
    for (const param of allParams) {
      if (typeof param === "string") {
        expect(param.includes(rawToken)).toBe(false);
      }
    }
    expect(allParams).toContain(hashed);

    // Every session_id-bearing query keys on the hash: the SELECT,
    // the INSERT, the per-session trim, the DELETE, and the probe.
    const hashCount = allParams.filter((p) => p === hashed).length;
    expect(hashCount).toBeGreaterThanOrEqual(4);
  });

  // The browser-side sidebar keeps threads for 7 days, so a server window
  // shorter than that made a reopened thread silently lose every follow-up's
  // context. Both sides are 7 days now. MAX_TURNS stays 5 — that is the
  // prompt-context budget, a separate concern.
  describe("recall window", () => {
    function isoParams(): string[] {
      return sqlMock.mock.calls
        .flatMap((call) => call.slice(1))
        .filter(
          (param): param is string => typeof param === "string" && /^\d{4}-\d{2}-\d{2}T/.test(param)
        );
    }

    function daysAgo(iso: string): number {
      return (Date.now() - new Date(iso).getTime()) / 86_400_000;
    }

    it("reads history back 7 days, not 30 minutes", async () => {
      sqlMock.mockResolvedValueOnce([]);
      await getConversationHistory("sid");

      const [since] = isoParams();
      expect(since).toBeDefined();
      expect(daysAgo(since)).toBeCloseTo(7, 2);
    });

    it("sweeps rows older than 7 days on write", async () => {
      sqlMock.mockResolvedValue([{ exists: true }]);
      sqlMock.transaction.mockResolvedValue(undefined);
      await addConversationTurn("sid", "Q", "A", []);

      const [cutoff] = isoParams();
      expect(cutoff).toBeDefined();
      expect(daysAgo(cutoff)).toBeCloseTo(7, 2);
    });

    it("still caps the prompt context at 5 turns", async () => {
      sqlMock.mockResolvedValueOnce([]);
      await getConversationHistory("sid");
      const numbers = sqlMock.mock.calls.flatMap((call) => call.slice(1)).filter(Number.isInteger);
      expect(numbers).toContain(5);
    });

    it("honors ASK_SESSION_TTL_DAYS", async () => {
      vi.stubEnv("ASK_SESSION_TTL_DAYS", "2");
      sqlMock.mockResolvedValueOnce([]);
      await getConversationHistory("sid");
      expect(daysAgo(isoParams()[0])).toBeCloseTo(2, 2);
    });

    it("clamps ASK_SESSION_TTL_DAYS to the 30-day maximum", async () => {
      vi.stubEnv("ASK_SESSION_TTL_DAYS", "365");
      sqlMock.mockResolvedValueOnce([]);
      await getConversationHistory("sid");
      expect(daysAgo(isoParams()[0])).toBeCloseTo(30, 2);
    });

    it("falls back to 7 days on a junk ASK_SESSION_TTL_DAYS", async () => {
      vi.stubEnv("ASK_SESSION_TTL_DAYS", "a week");
      sqlMock.mockResolvedValueOnce([]);
      await getConversationHistory("sid");
      expect(daysAgo(isoParams()[0])).toBeCloseTo(7, 2);
    });
  });

  it("reports { ok: true } when a delete matches zero rows", async () => {
    sqlMock.mockResolvedValueOnce([]);
    await expect(deleteConversationTurns("no-such-session")).resolves.toEqual({
      ok: true,
    });
  });

  it("reports { ok: false, error } without throwing when the delete fails", async () => {
    sqlMock.mockRejectedValueOnce(new Error("neon down"));
    await expect(deleteConversationTurns("sid")).resolves.toEqual({
      ok: false,
      error: "neon down",
    });
  });

  it("returns empty history when the DB returns no rows", async () => {
    sqlMock.mockResolvedValueOnce([]);
    expect(await getConversationHistory("unknown-session")).toEqual([]);
  });

  it("maps DB rows to ConversationTurn objects in chronological order", async () => {
    // The SELECT orders DESC so we pass newest first; the function
    // reverses internally to return oldest-first.
    const now = new Date("2026-04-16T12:00:00Z");
    sqlMock.mockResolvedValueOnce([
      {
        question: "Q2",
        answer: "A2",
        cited_article_ids: ["art-2"],
        citation_snapshots: [],
        created_at: now,
      },
      {
        question: "Q1",
        answer: "A1",
        cited_article_ids: ["art-1"],
        citation_snapshots: [],
        created_at: new Date(now.getTime() - 1000),
      },
    ]);

    const history = await getConversationHistory("sid");
    expect(history).toHaveLength(2);
    expect(history[0].question).toBe("Q1");
    expect(history[1].question).toBe("Q2");
    expect(history[0].citedArticleIds).toEqual(["art-1"]);
    expect(history[1].citedArticleIds).toEqual(["art-2"]);
  });

  it("stores short answers verbatim on addConversationTurn", async () => {
    sqlMock.transaction.mockResolvedValueOnce(undefined);
    sqlMock.mockResolvedValueOnce([{ exists: true }]);
    const shortAnswer = "x".repeat(1000);
    await addConversationTurn("sid", "What?", shortAnswer, ["a", "b"]);

    expect(sqlMock).toHaveBeenCalledTimes(4);
    expect(sqlMock.transaction).toHaveBeenCalledTimes(1);
    const substitutions = sqlMock.mock.calls[1].slice(1);
    const stringArgs = substitutions.filter((v: unknown) => typeof v === "string");
    const stored = stringArgs.find((s): s is string => typeof s === "string" && s.startsWith("x"));
    expect(stored).toBe(shortAnswer);
  });

  it("caps over-long answers at 8000 chars with a truncation marker", async () => {
    sqlMock.transaction.mockResolvedValueOnce(undefined);
    sqlMock.mockResolvedValueOnce([{ exists: true }]);
    const longAnswer = "x".repeat(10_000);
    await addConversationTurn("sid", "What?", longAnswer, []);

    const substitutions = sqlMock.mock.calls[1].slice(1);
    const stringArgs = substitutions.filter((v: unknown) => typeof v === "string");
    const stored = stringArgs.find((s): s is string => typeof s === "string" && s.startsWith("x"));
    expect(stored).toBeDefined();
    expect(stored!.length).toBe(8000);
    expect(stored!.endsWith("[…truncated]")).toBe(true);
  });

  it("does not throw when the DB read fails", async () => {
    sqlMock.mockRejectedValueOnce(new Error("neon down"));
    await expect(getConversationHistory("sid")).resolves.toEqual([]);
  });

  it("does not throw when the DB write fails", async () => {
    sqlMock.transaction.mockRejectedValueOnce(new Error("neon down"));
    await expect(addConversationTurn("sid", "Q", "A", [])).resolves.toBeUndefined();
  });

  it("treats a nullish cited_article_ids as an empty array", async () => {
    sqlMock.mockResolvedValueOnce([
      {
        question: "Q",
        answer: "A",
        cited_article_ids: null,
        citation_snapshots: null,
        created_at: new Date(),
      },
    ]);
    const history = await getConversationHistory("sid");
    expect(history[0].citedArticleIds).toEqual([]);
    expect(history[0].citationSnapshots).toEqual([]);
  });

  it("stores and restores immutable citation snapshots when the column exists", async () => {
    const snapshot = {
      articleId: "1960-01-07-0",
      contentRevisionId: "legacy-sha256:abc",
      headline: "Original headline",
      editionDate: "1960-01-07",
      category: "News",
      summary: "Original summary",
      byline: "Staff",
      bodySnippet: "Original body",
      evidenceSnippet: "Exact cited evidence",
      imageUrls: [],
      imageCaptions: [],
    };
    sqlMock.mockResolvedValueOnce([{ exists: true }]);
    sqlMock.transaction.mockResolvedValueOnce(undefined);

    await addConversationTurn("sid", "Q", "A", [snapshot.articleId], [snapshot]);

    const insertSql = Array.isArray(sqlMock.mock.calls[1][0])
      ? sqlMock.mock.calls[1][0].join(" ")
      : "";
    expect(insertSql).toContain("citation_snapshots");
    expect(sqlMock.mock.calls[1]).toContain(JSON.stringify([snapshot]));

    sqlMock.mockResolvedValueOnce([
      {
        question: "Q",
        answer: "A",
        cited_article_ids: [snapshot.articleId],
        citation_snapshots: [snapshot],
        created_at: new Date(),
      },
    ]);
    const history = await getConversationHistory("sid");
    expect(history[0].citationSnapshots).toEqual([snapshot]);
  });

  // Regenerate drops the turn it is replacing before generating. The
  // question check is what makes that safe to call optimistically: a
  // stopped turn never reached the store, so the newest row there is the
  // *previous* good turn, and deleting blind would throw it away.
  it("deletes the newest turn only when its question matches", async () => {
    sqlMock.mockResolvedValueOnce([{ id: 42 }]);
    await expect(deleteLatestTurn("sid", "the question being replaced")).resolves.toEqual({
      ok: true,
      deleted: true,
    });
    const params = sqlMock.mock.calls[0].slice(1);
    expect(params).toContain("the question being replaced");
  });

  it("deletes nothing when the newest turn is a different question", async () => {
    sqlMock.mockResolvedValueOnce([]);
    await expect(deleteLatestTurn("sid", "a question that was never stored")).resolves.toEqual({
      ok: true,
      deleted: false,
    });
  });

  it("reports a failed regenerate delete without throwing", async () => {
    sqlMock.mockRejectedValueOnce(new Error("neon down"));
    await expect(deleteLatestTurn("sid", "Q")).resolves.toEqual({ ok: false, deleted: false });
  });

  it("pops the matching in-memory turn in evaluation mode", async () => {
    vi.stubEnv("RAG_EVALUATION_MODE", "1");
    await addConversationTurn("eval-regen", "first", "A1", []);
    await addConversationTurn("eval-regen", "second", "A2", []);

    await expect(deleteLatestTurn("eval-regen", "not the newest")).resolves.toEqual({
      ok: true,
      deleted: false,
    });
    expect(await getConversationHistory("eval-regen")).toHaveLength(2);

    await expect(deleteLatestTurn("eval-regen", "second")).resolves.toEqual({
      ok: true,
      deleted: true,
    });
    expect(await getConversationHistory("eval-regen")).toMatchObject([{ question: "first" }]);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("uses an ephemeral store and makes no Neon call in evaluation mode", async () => {
    vi.stubEnv("RAG_EVALUATION_MODE", "1");
    await addConversationTurn("eval-session", "Q", "A", ["article-1"]);

    expect(await getConversationHistory("eval-session")).toMatchObject([
      { question: "Q", answer: "A", citedArticleIds: ["article-1"] },
    ]);
    expect(sqlMock).not.toHaveBeenCalled();
    expect(sqlMock.transaction).not.toHaveBeenCalled();
  });
});

describe("formatHistoryForPrompt", () => {
  it("returns empty string for no turns", () => {
    expect(formatHistoryForPrompt([])).toBe("");
  });

  it("formats turns with numbered labels", () => {
    const turns = [
      { question: "Q1", answer: "A1", citedArticleIds: [], citationSnapshots: [], timestamp: 0 },
      { question: "Q2", answer: "A2", citedArticleIds: [], citationSnapshots: [], timestamp: 0 },
    ];
    const result = formatHistoryForPrompt(turns);
    expect(result).toContain("[Turn 1] Q: Q1");
    expect(result).toContain("[Turn 2] Q: Q2");
    expect(result).toContain("A: A1");
    expect(result).toContain("A: A2");
  });
});
