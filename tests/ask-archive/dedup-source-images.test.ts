import { describe, it, expect } from "vitest";
import {
    dedupSourceImages,
    indexImagesByUrl,
} from "@/features/ask-archive/lib/dedup-source-images";
import type { AskResponse } from "@/src/types";

type Source = AskResponse["sourceArticles"][number];

function src(
    id: string,
    images: string[],
    captions: (string | null)[] = [],
): Source {
    return {
        id,
        headline: `headline-${id}`,
        editionDate: "1960-01-13",
        category: "News",
        summary: "",
        byline: null,
        bodySnippet: "",
        distance: 0,
        imageUrls: images,
        imageCaptions:
            captions.length === images.length
                ? captions
                : images.map(() => null),
    };
}

describe("dedupSourceImages", () => {
    it("keeps order of first-seen URLs across sources", () => {
        const out = dedupSourceImages([
            src("a", ["https://x/1.webp", "https://x/2.webp"]),
            src("b", ["https://x/3.webp"]),
        ]);
        expect(out.map((i) => i.src)).toEqual([
            "https://x/1.webp",
            "https://x/2.webp",
            "https://x/3.webp",
        ]);
        expect(out.map((i) => i.sourceIndex)).toEqual([1, 1, 2]);
    });

    it("collapses duplicates across sources to the first occurrence", () => {
        const out = dedupSourceImages([
            src("a", ["https://x/shared.webp"], ["caption-a"]),
            src("b", ["https://x/shared.webp"], ["caption-b"]),
        ]);
        expect(out).toHaveLength(1);
        expect(out[0].sourceIndex).toBe(1);
        expect(out[0].caption).toBe("caption-a");
    });

    it("treats raw space and %20 encodings as the same image", () => {
        const out = dedupSourceImages([
            src("a", ["https://x/Page 1.webp"]),
            src("b", ["https://x/Page%201.webp"]),
        ]);
        expect(out).toHaveLength(1);
    });

    it("returns [] for no sources", () => {
        expect(dedupSourceImages([])).toEqual([]);
    });

    it("preserves nullable captions by parallel index", () => {
        const out = dedupSourceImages([
            src("a", ["u1", "u2"], [null, "second"]),
        ]);
        expect(out[0].caption).toBeNull();
        expect(out[1].caption).toBe("second");
    });
});

describe("indexImagesByUrl", () => {
    it("keys by both raw and %20-encoded forms", () => {
        const images = dedupSourceImages([
            src("a", ["https://x/Page 1.webp"], ["cap"]),
        ]);
        const ix = indexImagesByUrl(images);
        expect(ix.get("https://x/Page 1.webp")?.caption).toBe("cap");
        expect(ix.get("https://x/Page%201.webp")?.caption).toBe("cap");
    });

    it("keys by the fully decoded form as well", () => {
        const images = dedupSourceImages([
            src("a", ["https://x/Page%201.webp"], ["cap"]),
        ]);
        const ix = indexImagesByUrl(images);
        expect(ix.get("https://x/Page%201.webp")?.caption).toBe("cap");
        expect(ix.get("https://x/Page 1.webp")?.caption).toBe("cap");
    });

    it("tolerates malformed percent escapes without throwing", () => {
        const images = dedupSourceImages([
            src("a", ["https://x/bad%Zfile.webp"]),
        ]);
        expect(() => indexImagesByUrl(images)).not.toThrow();
    });

    it("returns the canonical index for each URL", () => {
        const images = dedupSourceImages([
            src("a", ["u1", "u2"]),
            src("b", ["u3"]),
        ]);
        const ix = indexImagesByUrl(images);
        expect(ix.get("u1")?.index).toBe(0);
        expect(ix.get("u2")?.index).toBe(1);
        expect(ix.get("u3")?.index).toBe(2);
    });
});
