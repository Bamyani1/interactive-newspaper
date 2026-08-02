import { describe, expect, it } from "vitest";
import {
    buildCitationSnapshots,
    isCitationSnapshot,
    type CitationSnapshotSource,
} from "@/src/lib/citation-snapshot";

function source(
    overrides: Partial<CitationSnapshotSource> = {},
): CitationSnapshotSource {
    return {
        id: "1960-01-07-0",
        headline: "Original headline",
        editionDate: "1960-01-07",
        category: "News",
        summary: "Original summary",
        byline: "Staff",
        bodyPlain: "Original body text",
        matchedPassages: ["Exact cited passage"],
        imageUrls: ["https://archive.example/image.webp"],
        imageCaptions: ["Original caption"],
        ...overrides,
    };
}

describe("citation snapshots", () => {
    it("pins the cited metadata and exact retrieval evidence", () => {
        const [snapshot] = buildCitationSnapshots(
            [
                {
                    articleId: "1960-01-07-0",
                    contentRevisionId: "revision-123",
                    headline: "Original headline",
                    editionDate: "1960-01-07",
                },
            ],
            [source()],
        );

        expect(snapshot).toMatchObject({
            articleId: "1960-01-07-0",
            contentRevisionId: "revision-123",
            headline: "Original headline",
            evidenceSnippet: "Exact cited passage",
            imageCaptions: ["Original caption"],
        });
        expect(isCitationSnapshot(snapshot)).toBe(true);
    });

    it("derives a deterministic legacy revision when none is supplied", () => {
        const citations = [
            {
                articleId: "1960-01-07-0",
                headline: "Original headline",
                editionDate: "1960-01-07",
            },
        ];
        const first = buildCitationSnapshots(citations, [source()])[0];
        const same = buildCitationSnapshots(citations, [source()])[0];
        const changed = buildCitationSnapshots(citations, [
            source({ bodyPlain: "Revised body text" }),
        ])[0];

        expect(first.contentRevisionId).toMatch(/^legacy-sha256:[a-f0-9]{64}$/);
        expect(same.contentRevisionId).toBe(first.contentRevisionId);
        expect(changed.contentRevisionId).not.toBe(first.contentRevisionId);
    });

    it("retains citation order, deduplicates IDs, and ignores ungrounded sources", () => {
        const snapshots = buildCitationSnapshots(
            [
                { articleId: "b", headline: "B", editionDate: "1960-01-02" },
                { articleId: "b", headline: "B", editionDate: "1960-01-02" },
                { articleId: "missing", headline: "M", editionDate: "1960-01-03" },
                { articleId: "a", headline: "A", editionDate: "1960-01-01" },
            ],
            [
                source({ id: "a", headline: "A", editionDate: "1960-01-01" }),
                source({ id: "b", headline: "B", editionDate: "1960-01-02" }),
            ],
        );

        expect(snapshots.map((snapshot) => snapshot.articleId)).toEqual(["b", "a"]);
    });

    it("bounds retained evidence rather than storing a full article", () => {
        const [snapshot] = buildCitationSnapshots(
            [{ articleId: "1960-01-07-0", headline: "H", editionDate: "1960-01-07" }],
            [source({ matchedPassages: ["x".repeat(5_000)] })],
        );

        expect(snapshot.evidenceSnippet.length).toBeLessThanOrEqual(2_000);
        expect(snapshot.evidenceSnippet).toContain("snapshot clipped");
    });
});
