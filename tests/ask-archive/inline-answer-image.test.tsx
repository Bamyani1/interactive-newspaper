import React from "react";
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Markdown } from "@/features/ask-archive/components/Markdown";
import { AnswerImageContext } from "@/features/ask-archive/components/AnswerImageContext";
import type { TurnImage } from "@/features/ask-archive/lib/dedup-source-images";

function renderWithContext(
  md: string,
  images: TurnImage[],
  onOpen: (url: string) => void = () => {}
) {
  const metaByUrl = new Map(images.map((img, index) => [img.src, { ...img, index }] as const));
  return render(
    <AnswerImageContext.Provider value={{ metaByUrl, openLightbox: onOpen }}>
      <Markdown turnId="t-1">{md}</Markdown>
    </AnswerImageContext.Provider>
  );
}

/**
 * jsdom never fetches an image, so nothing fires load or error on its
 * own. The caption and source chip are held back until one of them does
 * — that is the behaviour under test — so a test that wants a settled
 * photo has to say so.
 */
function settleImage(container: HTMLElement, event: "load" | "error" = "load") {
  const img = container.querySelector("img");
  if (!img) throw new Error("no <img> rendered");
  if (event === "load") {
    Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });
    fireEvent.load(img);
  } else {
    fireEvent.error(img);
  }
}

describe("Markdown inline images", () => {
  it("renders a plain <img> when no context is provided", () => {
    const { container } = render(<Markdown turnId="t-1">{"![alt](https://x/p.webp)"}</Markdown>);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(container.querySelector(".ask-answer-figure")).toBeNull();
    expect(container.querySelector(".ask-answer-figcaption")).toBeNull();
  });

  it("drops empty-src images silently", () => {
    const { container } = render(<Markdown turnId="t-1">{"![alt]()"}</Markdown>);
    expect(container.querySelector("img")).toBeNull();
  });

  it("upgrades to figure wrapper with caption + attribution when url is in context", () => {
    const img: TurnImage = {
      src: "https://x/p.webp",
      caption: "Homecoming queen, 1965",
      sourceIndex: 2,
      sourceId: "1965-10-15-3",
    };
    const { container } = renderWithContext("![alt](https://x/p.webp)", [img]);
    settleImage(container);
    const figure = container.querySelector(".ask-answer-figure");
    expect(figure).not.toBeNull();
    expect(figure?.getAttribute("role")).toBe("figure");
    expect(container.querySelector(".ask-answer-figcaption")?.textContent).toBe(
      "Homecoming queen, 1965"
    );
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
    const { container } = renderWithContext("![](https://x/p.webp)", [img]);
    settleImage(container);
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
    const { container } = renderWithContext("![alt](https://x/unknown.webp)", [img]);
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
    const { container } = renderWithContext("![alt](https://x/p.webp)", [img], (u) =>
      calls.push(u)
    );
    settleImage(container);
    const btn = screen.getByRole("button", { name: /expand photo/i });
    btn.click();
    expect(calls).toEqual(["https://x/p.webp"]);
  });

  // The reported symptom behind this: "the pictures are not loading". The
  // photo was loading fine — the caption and the FROM chip simply rendered
  // the instant the markdown arrived, several seconds ahead of the bytes,
  // so mid-stream the reader saw an italic caption under blank space.
  describe("while the photo is still arriving", () => {
    const img: TurnImage = {
      src: "https://x/p.webp",
      caption: "Homecoming queen, 1965",
      sourceIndex: 2,
      sourceId: "1965-10-15-3",
    };

    it("holds back the caption and the source chip", () => {
      const { container } = renderWithContext("![alt](https://x/p.webp)", [img]);
      expect(container.querySelector(".ask-answer-figcaption")).toBeNull();
      expect(container.querySelector(".ask-answer-image-attr")).toBeNull();
    });

    it("reserves the space with a marked placeholder", () => {
      const { container } = renderWithContext("![alt](https://x/p.webp)", [img]);
      expect(
        container.querySelector('.ask-answer-figure[data-loading="true"]')
      ).not.toBeNull();
    });

    // The <img> has to stay mounted or it would never load at all.
    it("keeps the image in the tree so it can load", () => {
      const { container } = renderWithContext("![alt](https://x/p.webp)", [img]);
      expect(container.querySelector("img")?.getAttribute("src")).toBe("https://x/p.webp");
    });

    it("reveals both once the photo lands, and clears the placeholder", () => {
      const { container } = renderWithContext("![alt](https://x/p.webp)", [img]);
      settleImage(container);
      expect(container.querySelector(".ask-answer-figcaption")?.textContent).toBe(
        "Homecoming queen, 1965"
      );
      expect(container.querySelector(".ask-answer-image-attr")).not.toBeNull();
      expect(container.querySelector('.ask-answer-figure[data-loading="true"]')).toBeNull();
    });

    // An empty box with a caption and a source chip under it is the one
    // state that reads as broken rather than as slow.
    it("removes the figure entirely when the photo cannot load", () => {
      const { container } = renderWithContext("![alt](https://x/p.webp)", [img]);
      settleImage(container, "error");
      expect(container.querySelector(".ask-answer-figure")).toBeNull();
      expect(container.querySelector(".ask-answer-figcaption")).toBeNull();
    });
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
    const { container } = renderWithContext("sentence ![alt](https://x/p.webp) tail", [img]);
    expect(container.querySelector("figure")).toBeNull();
    expect(container.querySelector("figcaption")).toBeNull();
    const wrapper = container.querySelector(".ask-answer-figure");
    expect(wrapper?.tagName.toLowerCase()).toBe("span");
  });
});
