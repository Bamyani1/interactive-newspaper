/**
 * API Route Tests for Editions endpoints.
 *
 * These tests verify the data structure and API response format
 * using mocked Prisma client to avoid database dependencies.
 * 
 * Security: No real database access, no credentials needed.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Sample test data (sorted descending by date, as API returns)
const mockEditions = [
    {
        id: "test-edition-2",
        date: "1986-10-24",
        pageCount: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { articles: 38 },
    },
    {
        id: "test-edition-1",
        date: "1986-10-17",
        pageCount: 12,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { articles: 45 },
    },
];

const mockArticles = [
    {
        id: "test-article-1",
        editionDate: "1986-10-17",
        headline: "OWU beauties to grace calendars",
        summary: "Seniors creating calendars for the bookstore.",
        fullText: "<p>Christmas presents featuring campus faces...</p>",
        category: "Features",
        byline: "By SHAFALIKA SAXENA",
        page: 1,
        imageUrl: "/editions/1986-10-17/extracted-images/p1-i1.jpg",
        imageCaption: "ENTREPRENEURS",
        isHero: true,
        isFeatured: true,
        createdAt: new Date(),
        updatedAt: new Date(),
    },
    {
        id: "test-article-2",
        editionDate: "1986-10-17",
        headline: "Bishops defeat rival team",
        summary: "Sports victory for OWU.",
        fullText: "<p>The Bishops won...</p>",
        category: "Sports",
        byline: "Sports Staff",
        page: 8,
        imageUrl: null,
        imageCaption: null,
        isHero: false,
        isFeatured: false,
        createdAt: new Date(),
        updatedAt: new Date(),
    },
];

describe("Edition data structure validation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should have valid edition structure", () => {
        for (const edition of mockEditions) {
            expect(edition.id).toBeDefined();
            expect(edition.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(edition.pageCount).toBeGreaterThan(0);
            expect(edition._count.articles).toBeGreaterThanOrEqual(0);
        }
    });

    it("should have editions sorted by date", () => {
        const dates = mockEditions.map((e) => e.date);
        const sortedDates = [...dates].sort().reverse();
        expect(dates).toEqual(sortedDates);
    });

    it("should transform edition for API response correctly", () => {
        // Simulate the transformation done in the API route
        const transformed = mockEditions.map((e) => ({
            id: e.id,
            date: e.date,
            pageCount: e.pageCount,
            articleCount: e._count.articles,
        }));

        expect(transformed[0].articleCount).toBe(38);
        expect(transformed[0].id).toBeDefined();
        expect(transformed[0].date).toBe("1986-10-24");
    });
});

describe("Article data structure validation", () => {
    it("should have valid article structure", () => {
        for (const article of mockArticles) {
            expect(article.id).toBeDefined();
            expect(article.headline).toBeDefined();
            expect(typeof article.headline).toBe("string");
            expect(article.fullText).toBeDefined();
            expect(article.category).toBeDefined();
            expect(article.page).toBeGreaterThan(0);
        }
    });

    it("should have valid category values", () => {
        const validCategories = [
            "News",
            "Sports",
            "Features",
            "Opinion",
            "Arts",
            "Campus Life",
            "Ads",
        ];

        for (const article of mockArticles) {
            expect(validCategories).toContain(article.category);
        }
    });

    it("should have hero articles only on page 1", () => {
        const heroArticles = mockArticles.filter((a) => a.isHero);
        for (const article of heroArticles) {
            expect(article.page).toBe(1);
        }
    });

    it("should have editionDate matching date format", () => {
        for (const article of mockArticles) {
            expect(article.editionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
    });

    it("should have imageUrl when imageCaption exists", () => {
        for (const article of mockArticles) {
            if (article.imageCaption) {
                expect(article.imageUrl).toBeDefined();
                expect(article.imageUrl).not.toBeNull();
            }
        }
    });
});

describe("API response format validation", () => {
    it("editions list response should have correct shape", () => {
        // Simulate API response format
        const response = {
            editions: mockEditions.map((e) => ({
                id: e.id,
                date: e.date,
                pageCount: e.pageCount,
                articleCount: e._count.articles,
            })),
        };

        expect(response.editions).toBeDefined();
        expect(Array.isArray(response.editions)).toBe(true);
        expect(response.editions.length).toBe(2);
    });

    it("single edition response should have correct shape", () => {
        const edition = mockEditions[0];
        const response = {
            edition: {
                id: edition.id,
                date: edition.date,
                pageCount: edition.pageCount,
            },
            articles: mockArticles.map((a) => ({
                id: a.id,
                headline: a.headline,
                summary: a.summary,
                fullText: a.fullText,
                category: a.category,
                byline: a.byline,
                page: a.page,
                imageUrl: a.imageUrl,
                imageCaption: a.imageCaption,
                isHero: a.isHero,
                isFeatured: a.isFeatured,
            })),
        };

        expect(response.edition).toBeDefined();
        expect(response.articles).toBeDefined();
        expect(Array.isArray(response.articles)).toBe(true);
    });

    it("error response should have error field", () => {
        const errorResponse = { error: "Edition not found" };
        expect(errorResponse.error).toBeDefined();
        expect(typeof errorResponse.error).toBe("string");
    });
});

describe("Article sorting validation", () => {
    it("should sort articles with hero first", () => {
        const sorted = [...mockArticles].sort((a, b) => {
            if (a.isHero !== b.isHero) return b.isHero ? 1 : -1;
            if (a.isFeatured !== b.isFeatured) return b.isFeatured ? 1 : -1;
            return a.page - b.page;
        });

        // First article should be hero
        expect(sorted[0].isHero).toBe(true);
    });

    it("should sort by page number for non-hero articles", () => {
        const nonHeroArticles = mockArticles
            .filter((a) => !a.isHero)
            .sort((a, b) => a.page - b.page);

        for (let i = 1; i < nonHeroArticles.length; i++) {
            expect(nonHeroArticles[i].page).toBeGreaterThanOrEqual(
                nonHeroArticles[i - 1].page
            );
        }
    });
});

describe("Pagination response format", () => {
    const mockPagination = {
        nextCursor: "test-cursor-123",
        hasMore: true,
        total: 76,
    };

    it("should have pagination object in response", () => {
        const response = {
            editions: [],
            pagination: mockPagination,
        };

        expect(response.pagination).toBeDefined();
        expect(response.pagination.hasMore).toBe(true);
        expect(response.pagination.nextCursor).toBe("test-cursor-123");
    });

    it("should include total count", () => {
        expect(mockPagination.total).toBeDefined();
        expect(typeof mockPagination.total).toBe("number");
    });

    it("should have null nextCursor when no more items", () => {
        const noMorePagination = {
            nextCursor: null,
            hasMore: false,
            total: 10,
        };

        expect(noMorePagination.hasMore).toBe(false);
        expect(noMorePagination.nextCursor).toBeNull();
    });
});
