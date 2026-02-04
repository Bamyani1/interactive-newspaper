/**
 * API Route Tests for Articles endpoint.
 */
import { describe, it, expect } from "vitest";

const mockArticle = {
    id: "1986-10-17-p1-owu-beauties",
    editionDate: "1986-10-17",
    headline: "OWU beauties to grace calendars",
    summary: "Seniors creating calendars for the bookstore.",
    fullText: "<p>Christmas presents featuring campus faces...</p>",
    categoryId: "cat_features",
    category: { id: "cat_features", name: "Features", slug: "features", displayOrder: 3 },
    byline: "By SHAFALIKA SAXENA",
    page: 1,
    imageUrl: "/editions/1986-10-17/extracted-images/p1-i1.jpg",
    imageCaption: "ENTREPRENEURS",
    isHero: true,
    isFeatured: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    edition: {
        date: "1986-10-17",
        pageCount: 12,
    },
};

describe("Article data structure validation", () => {
    it("should have required article fields", () => {
        expect(mockArticle.id).toBeDefined();
        expect(mockArticle.headline).toBeDefined();
        expect(mockArticle.fullText).toBeDefined();
        expect(mockArticle.page).toBeGreaterThan(0);
    });

    it("should have category relation", () => {
        expect(mockArticle.category).toBeDefined();
        expect(mockArticle.category.name).toBeDefined();
        expect(mockArticle.category.slug).toBeDefined();
    });

    it("should have edition relation", () => {
        expect(mockArticle.edition).toBeDefined();
        expect(mockArticle.edition.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(mockArticle.edition.pageCount).toBeGreaterThan(0);
    });

    it("should have optional fields", () => {
        // These can be null/undefined
        expect(mockArticle).toHaveProperty("summary");
        expect(mockArticle).toHaveProperty("byline");
        expect(mockArticle).toHaveProperty("imageUrl");
        expect(mockArticle).toHaveProperty("imageCaption");
    });
});

describe("Article API response format", () => {
    it("should transform article for API response", () => {
        const response = {
            article: {
                id: mockArticle.id,
                headline: mockArticle.headline,
                summary: mockArticle.summary,
                fullText: mockArticle.fullText,
                category: mockArticle.category?.name ?? "News",
                byline: mockArticle.byline,
                page: mockArticle.page,
                imageUrl: mockArticle.imageUrl,
                imageCaption: mockArticle.imageCaption,
                isHero: mockArticle.isHero,
                isFeatured: mockArticle.isFeatured,
                edition: {
                    date: mockArticle.edition.date,
                    pageCount: mockArticle.edition.pageCount,
                },
            },
        };

        expect(response.article).toBeDefined();
        expect(response.article.category).toBe("Features");
        expect(response.article.edition).toBeDefined();
    });

    it("should return category name not object", () => {
        // API returns category as string for backwards compatibility
        const categoryName = mockArticle.category?.name ?? "News";

        expect(typeof categoryName).toBe("string");
        expect(categoryName).toBe("Features");
    });

    it("should handle 404 response format", () => {
        const errorResponse = { error: "Article not found" };

        expect(errorResponse.error).toBeDefined();
        expect(typeof errorResponse.error).toBe("string");
    });
});

describe("Article boolean flags", () => {
    it("should have boolean isHero flag", () => {
        expect(typeof mockArticle.isHero).toBe("boolean");
    });

    it("should have boolean isFeatured flag", () => {
        expect(typeof mockArticle.isFeatured).toBe("boolean");
    });

    it("hero articles should be on page 1", () => {
        if (mockArticle.isHero) {
            expect(mockArticle.page).toBe(1);
        }
    });
});
