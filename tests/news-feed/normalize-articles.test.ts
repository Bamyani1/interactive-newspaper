import { describe, it, expect } from "vitest";
import { normalizeArticles, type RawArticle } from "../../src/features/news-feed/lib/normalize-articles";

describe("normalizeArticles", () => {
    it("normalizes malformed article payloads so click rendering stays stable", () => {
        const raw = [
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
        ] as unknown as RawArticle[];

        const result = normalizeArticles(raw, "1987-10-14");

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe("1987-10-14-article-2-0");
        expect(result[0].category).toBe("Campus News");
        expect(result[0].headline).toBe("Malformed row");
        expect(result[0].summary).toBe("");
        expect(result[0].fullText).toBe("");
        expect(result[0].isHero).toBe(false);
        expect(result[0].isFeatured).toBe(false);
    });

    it("normalizes Photography category to Arts & Entertainment and preserves empty headline for photo-only articles", () => {
        const raw = [
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
        ] as unknown as RawArticle[];

        const result = normalizeArticles(raw, "1970-05-06");

        expect(result).toHaveLength(2);
        // Photo-only articles keep empty headline (not "Untitled Article")
        expect(result[0].headline).toBe("");
        expect(result[1].headline).toBe("");
        // Photography normalizes to Arts & Entertainment (both cases)
        expect(result[0].category).toBe("Arts & Entertainment");
        expect(result[1].category).toBe("Arts & Entertainment");
    });

    it("defaults to Untitled Article when headline is missing and there are no images", () => {
        const raw = [
            {
                id: "missing",
                headline: "",
                summary: "",
                fullText: "<p>some body</p>",
                category: "News",
                byline: null,
                page: 1,
                imageUrls: [],
                imageCaptions: [],
                isHero: false,
                isFeatured: false,
            },
        ] as unknown as RawArticle[];

        const result = normalizeArticles(raw, "1965-04-01");
        expect(result[0].headline).toBe("Untitled Article");
        expect(result[0].category).toBe("News");
    });

    it("falls back to singular imageUrl when imageUrls is missing", () => {
        const raw = [
            {
                id: "single",
                headline: "Has Image",
                summary: "",
                fullText: "",
                category: "Sports",
                byline: null,
                page: 1,
                imageUrl: "/api/editions/1980-09-15/images/team.jpg",
                imageCaption: "team photo",
                imageCaptions: [],
                isHero: false,
                isFeatured: false,
            },
        ] as unknown as RawArticle[];

        const result = normalizeArticles(raw, "1980-09-15");
        expect(result[0].imageUrls).toEqual(["/api/editions/1980-09-15/images/team.jpg"]);
        expect(result[0].category).toBe("Sports");
    });
});
