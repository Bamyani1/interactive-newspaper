import { describe, expect, it } from "vitest";

import { trimIncompleteMarkdown } from "@/src/features/ask-archive/lib/trim-incomplete-markdown";

describe("trimIncompleteMarkdown", () => {
    it("returns complete text unchanged", () => {
        const text =
            "In 1968 students marched [Source 1].\n\n## Aftermath\n\nThe **dean** responded.";
        expect(trimIncompleteMarkdown(text)).toBe(text);
    });

    it("holds back a partial citation bracket", () => {
        expect(trimIncompleteMarkdown("The dean resigned [Sour")).toBe(
            "The dean resigned ",
        );
    });

    it("keeps a complete citation at the end", () => {
        expect(trimIncompleteMarkdown("The dean resigned [Source 2]")).toBe(
            "The dean resigned [Source 2]",
        );
    });

    it("holds back a partial image embed and its URL", () => {
        expect(
            trimIncompleteMarkdown("See the rally ![crowd](https://arch"),
        ).toBe("See the rally ");
        expect(trimIncompleteMarkdown("See the rally ![cro")).toBe(
            "See the rally ",
        );
    });

    it("keeps a complete image embed", () => {
        const text = "See ![crowd](https://archive.org/a.jpg)";
        expect(trimIncompleteMarkdown(text)).toBe(text);
    });

    it("strips an unclosed bold marker but keeps its words", () => {
        expect(
            trimIncompleteMarkdown("The **Board of Trustees voted"),
        ).toBe("The Board of Trustees voted");
    });

    it("leaves balanced bold alone", () => {
        expect(trimIncompleteMarkdown("The **Board** voted")).toBe(
            "The **Board** voted",
        );
    });

    it("trims a bare heading marker awaiting its text", () => {
        expect(trimIncompleteMarkdown("Intro text.\n\n## ")).toBe(
            "Intro text.\n\n",
        );
        expect(trimIncompleteMarkdown("Intro text.\n\n##")).toBe(
            "Intro text.\n\n",
        );
    });

    it("keeps a heading that already has text", () => {
        expect(trimIncompleteMarkdown("Intro.\n\n## Athle")).toBe(
            "Intro.\n\n## Athle",
        );
    });

    it("holds trailing characters that may open a construct", () => {
        expect(trimIncompleteMarkdown("It was dramatic !")).toBe(
            "It was dramatic ",
        );
        expect(trimIncompleteMarkdown("It was *")).toBe("It was ");
    });
});
