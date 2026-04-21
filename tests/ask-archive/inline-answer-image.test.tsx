import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "@/features/ask-archive/components/Markdown";
import { AnswerImageContext } from "@/features/ask-archive/components/AnswerImageContext";
import type { TurnImage } from "@/features/ask-archive/lib/dedup-source-images";

function renderWithContext(
    md: string,
    images: TurnImage[],
    onOpen: (url: string) => void = () => {},
) {
    const metaByUrl = new Map(
        images.map((img, index) => [img.src, { ...img, index }] as const),
    );
    return render(
        <AnswerImageContext.Provider
            value={{ metaByUrl, openLightbox: onOpen }}
        >
            <Markdown>{md}</Markdown>
        </AnswerImageContext.Provider>,
    );
}

describe("Markdown inline images", () => {
    it("renders a plain <img> when no context is provided", () => {
        const { container } = render(
            <Markdown>{"![alt](https://x/p.webp)"}</Markdown>,
        );
        const img = container.querySelector("img");
        expect(img).not.toBeNull();
        expect(container.querySelector(".ask-answer-figure")).toBeNull();
        expect(container.querySelector(".ask-answer-figcaption")).toBeNull();
    });

    it("drops empty-src images silently", () => {
        const { container } = render(<Markdown>{"![alt]()"}</Markdown>);
        expect(container.querySelector("img")).toBeNull();
    });

    it("upgrades to figure wrapper with caption + attribution when url is in context", () => {
        const img: TurnImage = {
            src: "https://x/p.webp",
            caption: "Homecoming queen, 1965",
            sourceIndex: 2,
            sourceId: "1965-10-15-3",
        };
        const { container } = renderWithContext(
            "![alt](https://x/p.webp)",
            [img],
        );
        const figure = container.querySelector(".ask-answer-figure");
        expect(figure).not.toBeNull();
        expect(figure?.getAttribute("role")).toBe("figure");
        expect(
            container.querySelector(".ask-answer-figcaption")?.textContent,
        ).toBe("Homecoming queen, 1965");
        const attr = container.querySelector(".ask-answer-image-attr");
        expect(attr).not.toBeNull();
        expect(attr?.getAttribute("href")).toBe("#ask-source-2");
        expect(attr?.textContent).toBe("from [2]");
    });

    it("omits figcaption when caption is null but still shows attribution", () => {
        const img: TurnImage = {
            src: "https://x/p.webp",
            caption: null,
            sourceIndex: 3,
            sourceId: "x",
        };
        const { container } = renderWithContext(
            "![](https://x/p.webp)",
            [img],
        );
        expect(container.querySelector(".ask-answer-figure")).not.toBeNull();
        expect(container.querySelector(".ask-answer-figcaption")).toBeNull();
        const attr = container.querySelector(".ask-answer-image-attr");
        expect(attr?.getAttribute("href")).toBe("#ask-source-3");
    });

    it("falls back to plain <img> when url is not in the context map", () => {
        const img: TurnImage = {
            src: "https://x/known.webp",
            caption: "c",
            sourceIndex: 1,
            sourceId: "x",
        };
        const { container } = renderWithContext(
            "![alt](https://x/unknown.webp)",
            [img],
        );
        expect(container.querySelector(".ask-answer-figure")).toBeNull();
        expect(container.querySelector("img")).not.toBeNull();
    });

    it("clicks through to openLightbox with the matching url", () => {
        const img: TurnImage = {
            src: "https://x/p.webp",
            caption: "c",
            sourceIndex: 1,
            sourceId: "x",
        };
        const calls: string[] = [];
        renderWithContext("![alt](https://x/p.webp)", [img], (u) =>
            calls.push(u),
        );
        const btn = screen.getByRole("button", { name: /expand photo/i });
        btn.click();
        expect(calls).toEqual(["https://x/p.webp"]);
    });

    it("does not wrap the figure in a paragraph that produces invalid HTML", () => {
        // Regression guard: the inline image in a sentence with a citation
        // should not nest <figure>/<figcaption> inside <p> (which would
        // trigger a hydration error). Using phrasing-content spans makes
        // nesting valid regardless of surrounding inline text.
        const img: TurnImage = {
            src: "https://x/p.webp",
            caption: "c",
            sourceIndex: 1,
            sourceId: "x",
        };
        const { container } = renderWithContext(
            "sentence ![alt](https://x/p.webp) tail",
            [img],
        );
        expect(container.querySelector("figure")).toBeNull();
        expect(container.querySelector("figcaption")).toBeNull();
        const wrapper = container.querySelector(".ask-answer-figure");
        expect(wrapper?.tagName.toLowerCase()).toBe("span");
    });
});
