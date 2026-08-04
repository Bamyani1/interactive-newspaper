import { describe, expect, it } from "vitest";
import {
    groundAgentAnswer,
    groundPipelineAnswer,
} from "@/src/lib/answer-grounding";
import type { RetrievedArticle } from "@/src/lib/db";

function article(overrides: Partial<RetrievedArticle> = {}): RetrievedArticle {
    return {
        id: "1960-01-07-0",
        editionDate: "1960-01-07",
        category: "News",
        headline: "Grounded headline",
        summary: "Summary",
        byline: null,
        bodyPlain: "Body",
        distance: null,
        source: "fts",
        imageUrls: ["https://archive.example/Page 1.webp"],
        imageCaptions: ["Verified printed caption"],
        ...overrides,
    };
}

describe("answer grounding", () => {
    it("removes invented source markers, links, and image URLs", () => {
        const result = groundPipelineAnswer(
            "Supported [Source 1]. Fake [Source 9]. " +
                "![fake](https://evil.example/image.webp) " +
                "[click](https://evil.example) https://evil.example/bare",
            [article()],
        );

        expect(result.citations.map((citation) => citation.articleId)).toEqual([
            "1960-01-07-0",
        ]);
        expect(result.answer).toContain("[Source 1]");
        expect(result.answer).not.toContain("Source 9");
        expect(result.answer).not.toContain("evil.example");
        expect(result.answer).toContain("click");
    });

    it("allows only a registered image belonging to a cited source", () => {
        const result = groundPipelineAnswer(
            "Evidence [Source 1]. ![invented description](https://archive.example/Page%201.webp)",
            [article()],
        );

        expect(result.answer).toContain(
            "![Verified printed caption](https://archive.example/Page%201.webp)",
        );
    });

    it("rejects a registered image when its article was not cited", () => {
        const result = groundPipelineAnswer(
            "No citation. ![caption](https://archive.example/Page%201.webp)",
            [article()],
        );

        expect(result.citations).toEqual([]);
        expect(result.answer).not.toContain("archive.example");
    });

    it("grounds agent citations and images against tool-returned metadata", () => {
        const lookup = new Map([
            [
                "1965-03-15-4",
                {
                    headline: "Tool result",
                    editionDate: "1965-03-15",
                    imageUrls: ["https://archive.example/tool.webp"],
                    imageCaptions: ["Tool caption"],
                },
            ],
        ]);
        const result = groundAgentAnswer(
            "Claim [1965-03-15-4]. Fake [2000-01-01-1]. " +
                "![wrong alt](https://archive.example/tool.webp)",
            lookup,
        );

        expect(result.citations).toEqual([
            {
                articleId: "1965-03-15-4",
                headline: "Tool result",
                editionDate: "1965-03-15",
            },
        ]);
        expect(result.answer).not.toContain("2000-01-01-1");
        expect(result.answer).toContain(
            "![Tool caption](https://archive.example/tool.webp)",
        );
    });

    it("enforces the three-image output cap", () => {
        const source = article({
            imageUrls: ["https://a/1", "https://a/2", "https://a/3", "https://a/4"],
            imageCaptions: ["One", "Two", "Three", "Four"],
        });
        const result = groundPipelineAnswer(
            "[Source 1] ![x](https://a/1) ![x](https://a/2) " +
                "![x](https://a/3) ![x](https://a/4)",
            [source],
        );

        expect(result.answer.match(/!\[/g)).toHaveLength(3);
        expect(result.answer).not.toContain("https://a/4");
    });
});
