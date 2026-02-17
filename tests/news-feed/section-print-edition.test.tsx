/* eslint-disable @next/next/no-img-element */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SectionPrintEdition } from "../../src/features/news-feed/components/variants/SectionPrintEdition";
import type { Article } from "../../src/types";

vi.mock("next/image", () => ({
  default: ({
    alt,
    src,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & { src?: string }) => (
    <img alt={alt ?? ""} src={src ?? ""} {...props} />
  ),
}));

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: "article-1",
    date: "1987-10-14",
    category: "News",
    headline: "Lead Story Headline",
    summary: "Lead story summary text.",
    fullText: "<p>First paragraph of lead story.</p><p>Second paragraph.</p>",
    imageUrls: [],
    page: 1,
    isHero: false,
    isFeatured: false,
    ...overrides,
  };
}

const onViewOriginal = vi.fn();

describe("SectionPrintEdition", () => {
  it("renders lead article with H1 headline", () => {
    render(
      <SectionPrintEdition
        articles={[makeArticle()]}
        onViewOriginal={onViewOriginal}
      />
    );

    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("Lead Story Headline");
  });

  it("renders remaining articles with H2 headlines", () => {
    render(
      <SectionPrintEdition
        articles={[
          makeArticle({ id: "a1", headline: "First Story" }),
          makeArticle({ id: "a2", headline: "Second Story" }),
          makeArticle({ id: "a3", headline: "Third Story" }),
        ]}
        onViewOriginal={onViewOriginal}
      />
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("First Story");

    const h2s = screen.getAllByRole("heading", { level: 2 });
    expect(h2s).toHaveLength(2);
    expect(h2s[0]).toHaveTextContent("Second Story");
    expect(h2s[1]).toHaveTextContent("Third Story");
  });

  it("renders DoubleRule at top", () => {
    const { container } = render(
      <SectionPrintEdition
        articles={[makeArticle()]}
        onViewOriginal={onViewOriginal}
      />
    );

    // DoubleRule renders an aria-hidden div with two child divs (thick + thin borders)
    const ariaHiddenDivs = container.querySelectorAll("[aria-hidden='true']");
    const doubleRule = Array.from(ariaHiddenDivs).find(
      (el) => el.classList.contains("mb-6") && el.children.length >= 2
    );
    expect(doubleRule).toBeTruthy();
  });

  it("renders OrnamentRow at bottom", () => {
    render(
      <SectionPrintEdition
        articles={[makeArticle()]}
        onViewOriginal={onViewOriginal}
      />
    );

    expect(screen.getByText("— § —")).toBeTruthy();
  });

  it("returns null for empty articles array", () => {
    const { container } = render(
      <SectionPrintEdition articles={[]} onViewOriginal={onViewOriginal} />
    );

    expect(container.innerHTML).toBe("");
  });

  it("handles single article (hero only, no featured)", () => {
    render(
      <SectionPrintEdition
        articles={[makeArticle({ headline: "Solo Article" })]}
        onViewOriginal={onViewOriginal}
      />
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Solo Article");
    expect(screen.queryAllByRole("heading", { level: 2 })).toHaveLength(0);
  });

  it("renders Kicker badges for all articles", () => {
    render(
      <SectionPrintEdition
        articles={[
          makeArticle({ id: "a1", category: "Sports" }),
          makeArticle({ id: "a2", category: "Sports" }),
        ]}
        onViewOriginal={onViewOriginal}
      />
    );

    const kickers = screen.getAllByText("Sports");
    expect(kickers).toHaveLength(2);
  });

  it("renders Byline when present", () => {
    render(
      <SectionPrintEdition
        articles={[makeArticle({ byline: "Jane Reporter" })]}
        onViewOriginal={onViewOriginal}
      />
    );

    expect(screen.getByText("By Jane Reporter")).toBeTruthy();
  });

  it("does not render Byline when absent", () => {
    render(
      <SectionPrintEdition
        articles={[makeArticle({ byline: null })]}
        onViewOriginal={onViewOriginal}
      />
    );

    expect(screen.queryByText(/^By /)).toBeNull();
  });

  it("renders images when imageUrls present", () => {
    render(
      <SectionPrintEdition
        articles={[
          makeArticle({
            imageUrls: ["/editions/1987-10-14/images/photo.jpg"],
            imageCaption: "A campus photo",
          }),
        ]}
        onViewOriginal={onViewOriginal}
      />
    );

    const img = screen.getByAltText("Lead Story Headline");
    expect(img).toBeTruthy();
    expect(screen.getByText("A campus photo")).toBeTruthy();
  });

  it("lightbox opens on image click", () => {
    render(
      <SectionPrintEdition
        articles={[
          makeArticle({
            imageUrls: ["/editions/1987-10-14/images/photo.jpg"],
          }),
        ]}
        onViewOriginal={onViewOriginal}
      />
    );

    // Click the article image to open lightbox
    const articleImg = screen.getByAltText("Lead Story Headline");
    fireEvent.click(articleImg.closest("[class*='cursor-pointer']")!);

    // Lightbox should render a full-size img
    const lightboxImg = screen.getByAltText("Full-size view");
    expect(lightboxImg).toBeTruthy();
    expect(lightboxImg).toHaveAttribute("src", "/editions/1987-10-14/images/photo.jpg");
  });

  it("renders summary fallback when fullText is missing", () => {
    render(
      <SectionPrintEdition
        articles={[makeArticle({ fullText: "", summary: "Summary fallback text." })]}
        onViewOriginal={onViewOriginal}
      />
    );

    expect(screen.getByText("Summary fallback text.")).toBeTruthy();
  });
});
