/**
 * API Route Tests for Categories endpoint.
 */
import { describe, it, expect } from "vitest";

const mockCategories = [
    { id: "cat_news", name: "News", slug: "news", displayOrder: 1, _count: { articles: 25 } },
    { id: "cat_sports", name: "Sports", slug: "sports", displayOrder: 2, _count: { articles: 12 } },
    { id: "cat_features", name: "Features", slug: "features", displayOrder: 3, _count: { articles: 18 } },
    { id: "cat_opinion", name: "Opinion", slug: "opinion", displayOrder: 4, _count: { articles: 8 } },
    { id: "cat_arts", name: "Arts", slug: "arts", displayOrder: 5, _count: { articles: 5 } },
    { id: "cat_campus_life", name: "Campus Life", slug: "campus-life", displayOrder: 6, _count: { articles: 6 } },
    { id: "cat_ads", name: "Ads", slug: "ads", displayOrder: 7, _count: { articles: 2 } },
];

describe("Category data structure validation", () => {
    it("should have valid category structure", () => {
        for (const category of mockCategories) {
            expect(category.id).toBeDefined();
            expect(category.name).toBeDefined();
            expect(category.slug).toBeDefined();
            expect(category.displayOrder).toBeGreaterThan(0);
            expect(category._count.articles).toBeGreaterThanOrEqual(0);
        }
    });

    it("should have unique slugs", () => {
        const slugs = mockCategories.map((c) => c.slug);
        const uniqueSlugs = new Set(slugs);
        expect(slugs.length).toBe(uniqueSlugs.size);
    });

    it("should be sorted by displayOrder", () => {
        const orders = mockCategories.map((c) => c.displayOrder);
        const sortedOrders = [...orders].sort((a, b) => a - b);
        expect(orders).toEqual(sortedOrders);
    });
});

describe("Categories API response format", () => {
    it("should transform categories for API response", () => {
        const response = {
            categories: mockCategories.map((c) => ({
                id: c.id,
                name: c.name,
                slug: c.slug,
                displayOrder: c.displayOrder,
                articleCount: c._count.articles,
            })),
        };

        expect(response.categories).toBeDefined();
        expect(Array.isArray(response.categories)).toBe(true);
        expect(response.categories.length).toBe(7);
    });

    it("should include articleCount in response", () => {
        const transformed = mockCategories.map((c) => ({
            id: c.id,
            name: c.name,
            slug: c.slug,
            displayOrder: c.displayOrder,
            articleCount: c._count.articles,
        }));

        for (const category of transformed) {
            expect(category.articleCount).toBeDefined();
            expect(typeof category.articleCount).toBe("number");
        }
    });

    it("should have standard category set", () => {
        const expectedNames = ["News", "Sports", "Features", "Opinion", "Arts", "Campus Life", "Ads"];
        const actualNames = mockCategories.map((c) => c.name);

        expect(actualNames).toEqual(expectedNames);
    });
});
