import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useEditionArticles } from "../../src/features/news-feed/hooks/useEditionArticles";

interface MockArticle {
    id: string;
    headline: string;
    summary: string | null;
    fullText: string | null;
    category: string | null;
    byline: string | null;
    page: number;
    imageUrl: string | null;
    imageCaption: string | null;
    isHero: boolean;
    isFeatured: boolean;
}

function makeArticle(index: number): MockArticle {
    return {
        id: `article-${index}`,
        headline: `Headline ${index}`,
        summary: `Summary ${index}`,
        fullText: `<p>Full text ${index}</p>`,
        category: "Campus News",
        byline: null,
        page: Math.floor(index / 10) + 1,
        imageUrl: null,
        imageCaption: null,
        isHero: index === 0,
        isFeatured: false,
    };
}

function jsonResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
    });
}

describe("useEditionArticles pagination", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("fetches all paginated articles with limit=100 and cursor chaining", async () => {
        const firstBatch = Array.from({ length: 100 }, (_, idx) => makeArticle(idx));
        const secondBatch = Array.from({ length: 30 }, (_, idx) => makeArticle(idx + 100));

        const fetchMock = vi
            .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
            .mockResolvedValueOnce(
                jsonResponse({
                    edition: { id: "ed-1", date: "1987-10-14", pageCount: 8, publicationInfo: "Vol. 110, No. 3" },
                    articles: firstBatch,
                    pagination: { nextCursor: "cursor-100", hasMore: true },
                })
            )
            .mockResolvedValueOnce(
                jsonResponse({
                    edition: { id: "ed-1", date: "1987-10-14", pageCount: 8, publicationInfo: "Vol. 110, No. 3" },
                    articles: secondBatch,
                    pagination: { nextCursor: null, hasMore: false },
                })
            );

        vi.stubGlobal("fetch", fetchMock);

        const { result } = renderHook(() => useEditionArticles("1987-10-14"));

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            "/api/editions/1987-10-14?limit=100",
            expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            "/api/editions/1987-10-14?limit=100&cursor=cursor-100",
            expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
        expect(result.current.error).toBeNull();
        expect(result.current.articles).toHaveLength(130);
        expect(result.current.articles[0].id).toBe("article-0");
        expect(result.current.articles[129].id).toBe("article-129");
        expect(result.current.publicationInfo).toBe("Vol. 110, No. 3");
    });

    it("normalizes malformed article payloads so click rendering stays stable", async () => {
        const fetchMock = vi
            .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
            .mockResolvedValueOnce(
                jsonResponse({
                    edition: { id: "ed-1", date: "1987-10-14", pageCount: 8 },
                    articles: [
                        {
                            id: "",
                            headline: "Malformed row",
                            summary: null,
                            fullText: null,
                            category: "campus news",
                            byline: null,
                            page: 2,
                            imageUrl: null,
                            imageCaption: null,
                            isHero: null,
                            isFeatured: undefined,
                        },
                    ],
                    pagination: { nextCursor: null, hasMore: false },
                })
            );

        vi.stubGlobal("fetch", fetchMock);

        const { result } = renderHook(() => useEditionArticles("1987-10-14"));

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        expect(result.current.error).toBeNull();
        expect(result.current.articles).toHaveLength(1);
        expect(result.current.articles[0].id).toBe("1987-10-14-article-2-0");
        expect(result.current.articles[0].category).toBe("Campus News");
        expect(result.current.articles[0].summary).toBe("");
        expect(result.current.articles[0].fullText).toBe("");
        expect(result.current.articles[0].isHero).toBe(false);
        expect(result.current.articles[0].isFeatured).toBe(false);
    });

    it("normalizes Photography category to Arts & Entertainment and preserves empty headline for photo-only articles", async () => {
        const fetchMock = vi
            .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
            .mockResolvedValueOnce(
                jsonResponse({
                    edition: { id: "ed-1", date: "1970-05-06", pageCount: 4 },
                    articles: [
                        {
                            id: "photo-1",
                            headline: "",
                            summary: "",
                            fullText: "",
                            category: "Photography",
                            byline: null,
                            page: 2,
                            imageUrls: ["/api/editions/1970-05-06/images/photo1.jpg"],
                            imageCaptions: ["Students on campus"],
                            imageCaption: "Students on campus",
                            isHero: false,
                            isFeatured: false,
                        },
                        {
                            id: "photo-2",
                            headline: "",
                            summary: "",
                            fullText: "",
                            category: "photography",
                            byline: null,
                            page: 3,
                            imageUrls: ["/api/editions/1970-05-06/images/photo2.jpg"],
                            imageCaptions: ["Library exterior"],
                            imageCaption: "Library exterior",
                            isHero: false,
                            isFeatured: false,
                        },
                    ],
                    pagination: { nextCursor: null, hasMore: false },
                })
            );

        vi.stubGlobal("fetch", fetchMock);

        const { result } = renderHook(() => useEditionArticles("1970-05-06"));

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        expect(result.current.error).toBeNull();
        expect(result.current.articles).toHaveLength(2);

        // Photo-only articles keep empty headline (not "Untitled Article")
        expect(result.current.articles[0].headline).toBe("");
        expect(result.current.articles[1].headline).toBe("");

        // Photography normalizes to Arts & Entertainment (both cases)
        expect(result.current.articles[0].category).toBe("Arts & Entertainment");
        expect(result.current.articles[1].category).toBe("Arts & Entertainment");
    });
});
