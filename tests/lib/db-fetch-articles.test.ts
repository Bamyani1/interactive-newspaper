/** @vitest-environment node */
/**
 * fetchArticlesByIds is on the request path — /api/ask/session calls it on
 * every hydrate. Neon's serverless driver has no AbortSignal support of its
 * own, so an un-raced call leaves an orphaned query running server-side and
 * the route hanging. These tests lock in the timer and the signal.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSql } = vi.hoisted(() => {
  const fn = vi.fn() as ReturnType<typeof vi.fn> & {
    query: ReturnType<typeof vi.fn>;
    transaction: ReturnType<typeof vi.fn>;
  };
  fn.query = vi.fn();
  fn.transaction = vi.fn();
  return { mockSql: fn };
});

vi.mock("@neondatabase/serverless", () => ({
  neon: vi.fn(() => mockSql),
}));

import { DbTimeoutError, fetchArticlesByIds } from "@/src/lib/db";

function articleRow(id: string) {
  return {
    id,
    edition_date: "1960-01-13",
    category: "News",
    headline: `Headline ${id}`,
    summary: "Summary",
    byline: null,
    body_plain: "Body text",
    image_urls: null,
    image_captions: null,
  };
}

describe("fetchArticlesByIds", () => {
  beforeEach(() => {
    mockSql.mockReset();
    mockSql.query.mockReset();
  });

  it("returns an empty map without touching Neon for an empty id list", async () => {
    await expect(fetchArticlesByIds([])).resolves.toEqual(new Map());
    expect(mockSql.query).not.toHaveBeenCalled();
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("maps rows by id with a truncated body snippet", async () => {
    mockSql.query.mockResolvedValueOnce([articleRow("a-1")]);
    const map = await fetchArticlesByIds(["a-1"]);
    expect(map.get("a-1")).toEqual({
      id: "a-1",
      headline: "Headline a-1",
      editionDate: "1960-01-13",
      category: "News",
      summary: "Summary",
      byline: null,
      bodySnippet: "Body text",
      imageUrls: [],
      imageCaptions: [],
    });
  });

  it("hands Neon an AbortSignal so a timeout cancels the fetch", async () => {
    mockSql.query.mockResolvedValueOnce([]);
    await fetchArticlesByIds(["a-1"]);
    const options = mockSql.query.mock.calls[0][2] as { fetchOptions?: { signal?: AbortSignal } };
    expect(options?.fetchOptions?.signal).toBeInstanceOf(AbortSignal);
    expect(options?.fetchOptions?.signal?.aborted).toBe(false);
  });

  it("rejects with DbTimeoutError once its budget elapses", async () => {
    mockSql.query.mockImplementationOnce(() => new Promise(() => {}));
    await expect(fetchArticlesByIds(["a-1"], { timeoutMs: 20 })).rejects.toBeInstanceOf(
      DbTimeoutError
    );
  });

  it("aborts the query signal when the timer fires", async () => {
    let seen: AbortSignal | undefined;
    mockSql.query.mockImplementationOnce(
      (_text: string, _params: unknown[], options: { fetchOptions?: { signal?: AbortSignal } }) => {
        seen = options?.fetchOptions?.signal;
        return new Promise(() => {});
      }
    );
    await expect(fetchArticlesByIds(["a-1"], { timeoutMs: 20 })).rejects.toBeInstanceOf(
      DbTimeoutError
    );
    expect(seen?.aborted).toBe(true);
  });

  it("honors a caller signal that is already aborted", async () => {
    await expect(
      fetchArticlesByIds(["a-1"], { signal: AbortSignal.abort() })
    ).rejects.toBeInstanceOf(DbTimeoutError);
    expect(mockSql.query).not.toHaveBeenCalled();
  });
});
