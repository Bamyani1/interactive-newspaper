import { describe, it, expect } from "vitest";
import { transformArticles, transformAds, transformOtherContent, computePageCount } from "@/src/lib/ocr-adapter";
import type { OcrEdition, OcrArticle, OcrEnrichedAd } from "@/src/types";

// ── Helpers ──────────────────────────────────────────────────────────

function makeArticle(overrides: Partial<OcrArticle> = {}): OcrArticle {
  return {
    headline: "Test Headline",
    author: "By Test Author",
    body: "First paragraph.\n\nSecond paragraph.",
    images: [],
    image_files: [],
    source_pages: ["1"],
    ...overrides,
  };
}

function makeEdition(overrides: Partial<OcrEdition> = {}): OcrEdition {
  return {
    edition_date: "1970-01-07",
    publication_info: "The Transcript",
    articles: [makeArticle()],
    ads: [],
    other_content: [],
    ...overrides,
  };
}

// ── transformArticles ────────────────────────────────────────────────

describe("transformArticles", () => {
  it("maps basic fields correctly", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          headline: "Campus Election Results",
          author: "By Jane Doe",
          body: "The results are in.\n\nMore details follow.",
          source_pages: ["3"],
        }),
      ],
    });

    const articles = transformArticles(edition);
    expect(articles).toHaveLength(1);
    expect(articles[0].id).toBe("1970-01-07-0");
    expect(articles[0].date).toBe("1970-01-07");
    expect(articles[0].headline).toBe("Campus Election Results");
    expect(articles[0].byline).toBe("By Jane Doe");
    expect(articles[0].page).toBe(3);
  });

  it("extracts summary from first paragraph", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({ body: "Short first paragraph.\n\nSecond paragraph with more detail." }),
      ],
    });

    const [article] = transformArticles(edition);
    expect(article.summary).toBe("Short first paragraph.");
  });

  it("truncates summary at 300 characters", () => {
    const longParagraph = "A".repeat(350);
    const edition = makeEdition({
      articles: [makeArticle({ body: longParagraph })],
    });

    const [article] = transformArticles(edition);
    expect(article.summary.length).toBe(300);
    expect(article.summary).toMatch(/\.\.\.$/);
  });

  it("converts body to HTML with escaped characters", () => {
    const edition = makeEdition({
      articles: [makeArticle({ body: "Hello <world> & friends.\n\nSecond para." })],
    });

    const [article] = transformArticles(edition);
    expect(article.fullText).toContain("&lt;world&gt;");
    expect(article.fullText).toContain("&amp;");
    expect(article.fullText).toMatch(/<p>.*<\/p>/);
  });

  it("strips OCR page-break markers from body", () => {
    const edition = makeEdition({
      articles: [makeArticle({ body: "Start of text.\n. 7\nContinued text." })],
    });

    const [article] = transformArticles(edition);
    expect(article.fullText).not.toContain(". 7");
  });

  it("uses categories[] when provided", () => {
    const edition = makeEdition({
      articles: [makeArticle(), makeArticle()],
      categories: ["Sports", "Arts"],
    });

    const articles = transformArticles(edition);
    expect(articles[0].category).toBe("Sports");
    expect(articles[1].category).toBe("Arts");
  });

  it("falls back to heuristic classification when no categories[]", () => {
    const edition = makeEdition({
      articles: [makeArticle({ author: "By John Smith, Sports" })],
    });

    const [article] = transformArticles(edition);
    expect(article.category).toBe("Sports");
  });

  it("constructs image URLs correctly", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({ image_files: ["images/photo1.jpg", "images/photo2.png"] }),
      ],
    });

    const [article] = transformArticles(edition);
    expect(article.imageUrls).toHaveLength(2);
    expect(article.imageUrls[0]).toBe("/api/editions/1970-01-07/images/photo1.jpg");
    expect(article.imageUrls[1]).toBe("/api/editions/1970-01-07/images/photo2.png");
  });

  it("filters out non-image files", () => {
    const edition = makeEdition({
      articles: [makeArticle({ image_files: ["images/photo.jpg", "readme.txt"] })],
    });

    const [article] = transformArticles(edition);
    expect(article.imageUrls).toHaveLength(1);
  });

  it("sets isHero=true on first featured candidate", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({ image_files: ["images/a.jpg"] }),
        makeArticle({ image_files: ["images/b.jpg"] }),
        makeArticle(),
      ],
    });

    const articles = transformArticles(edition);
    const hero = articles.find((a) => a.isHero);
    expect(hero).toBeDefined();
    expect(hero!.isFeatured).toBe(true);
    // Hero should be the first article with an image
    expect(hero!.imageUrls.length).toBeGreaterThan(0);
  });

  it("marks up to 5 articles as featured", () => {
    const edition = makeEdition({
      articles: Array.from({ length: 10 }, () => makeArticle()),
    });

    const articles = transformArticles(edition);
    const featured = articles.filter((a) => a.isFeatured);
    expect(featured).toHaveLength(5);
  });

  it("prioritizes articles with images for featured", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({ headline: "No Image 1" }),
        makeArticle({ headline: "Has Image", image_files: ["images/pic.jpg"] }),
        makeArticle({ headline: "No Image 2" }),
      ],
    });

    const articles = transformArticles(edition);
    const heroArticle = articles.find((a) => a.isHero);
    expect(heroArticle!.headline).toBe("Has Image");
  });

  it("returns empty array for missing articles", () => {
    const edition = { edition_date: "1970-01-07" } as unknown as OcrEdition;
    expect(transformArticles(edition)).toEqual([]);
  });

  it("returns empty array for null articles", () => {
    const edition = makeEdition();
    (edition as Record<string, unknown>).articles = null;
    expect(transformArticles(edition)).toEqual([]);
  });

  it("extracts image caption from first image", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          images: [{ caption: "A great photo", position: "top" }],
        }),
      ],
    });

    const [article] = transformArticles(edition);
    expect(article.imageCaption).toBe("A great photo");
  });

  it("defaults page to 1 when source_pages is empty", () => {
    const edition = makeEdition({
      articles: [makeArticle({ source_pages: [] })],
    });

    const [article] = transformArticles(edition);
    expect(article.page).toBe(1);
  });
});

// ── classifyCategory (tested indirectly via transformArticles) ───────

describe("classifyCategory (via transformArticles)", () => {
  function classifyVia(article: Partial<OcrArticle>): string {
    const edition = makeEdition({ articles: [makeArticle(article)] });
    return transformArticles(edition)[0].category;
  }

  it("detects Sports from byline tag after comma", () => {
    expect(classifyVia({ author: "By John Smith, Sports" })).toBe("Sports");
  });

  it("detects Arts from byline 'Entertainment' keyword", () => {
    expect(classifyVia({ author: "By Jane, Entertainment" })).toBe("Arts");
  });

  it("detects Sports from byline without comma", () => {
    expect(classifyVia({ author: "By John Sports Editor" })).toBe("Sports");
  });

  it("detects Opinion from letter to editor", () => {
    expect(classifyVia({ body: "Editor, The Transcript\n\nI write to complain..." })).toBe(
      "Opinion"
    );
  });

  it("detects Opinion from 'by editorial' byline", () => {
    expect(classifyVia({ author: "By editorial" })).toBe("Opinion");
  });

  it("detects Opinion from class year byline", () => {
    expect(classifyVia({ author: "John Smith '89" })).toBe("Opinion");
  });

  it("detects Sports from headline keywords", () => {
    expect(classifyVia({ headline: "Bishops Win Basketball Championship" })).toBe("Sports");
  });

  it("detects Arts from headline keywords", () => {
    expect(classifyVia({ headline: "New Film Festival Opens on Campus" })).toBe("Arts");
  });

  it("defaults to News", () => {
    expect(classifyVia({ headline: "Budget Approved", author: "By Staff" })).toBe("News");
  });
});

// ── transformAds ─────────────────────────────────────────────────────

describe("transformAds", () => {
  it("falls back to raw ads when no enriched_ads", () => {
    const edition = makeEdition({
      ads: [{ business_name: "Pizza Place", body: "Best pizza in town", image_files: [] }],
    });

    const ads = transformAds(edition);
    expect(ads).toHaveLength(1);
    expect(ads[0].title).toBe("Pizza Place");
    expect(ads[0].body).toBe("Best pizza in town");
    expect(ads[0].category).toBeUndefined();
  });

  it("uses enriched_ads when available", () => {
    const enriched: OcrEnrichedAd = {
      business_name: "Pizza Place",
      body: "Best pizza",
      image_files: [],
      category: "Food & Drink",
      ad_type: "display",
      display_text: "Pizza Place — Best pizza in Delaware!",
      phone: "740-555-1234",
      address: "123 Main St",
      price: "$5.99",
    };
    const edition = makeEdition({ enriched_ads: [enriched] });

    const ads = transformAds(edition);
    expect(ads[0].category).toBe("Food & Drink");
    expect(ads[0].adType).toBe("display");
    expect(ads[0].displayText).toBe("Pizza Place — Best pizza in Delaware!");
    expect(ads[0].phone).toBe("740-555-1234");
    expect(ads[0].address).toBe("123 Main St");
    expect(ads[0].price).toBe("$5.99");
  });

  it("defaults invalid category to 'Other'", () => {
    const enriched: OcrEnrichedAd = {
      business_name: "Test",
      body: "test",
      image_files: [],
      category: "InvalidCategory",
      ad_type: "display",
      display_text: "test",
      phone: "",
      address: "",
      price: "",
    };
    const edition = makeEdition({ enriched_ads: [enriched] });

    const ads = transformAds(edition);
    expect(ads[0].category).toBe("Other");
  });

  it("returns empty array when ads/enriched_ads missing", () => {
    const edition = makeEdition();
    (edition as Record<string, unknown>).ads = undefined;
    (edition as Record<string, unknown>).enriched_ads = undefined;
    expect(transformAds(edition)).toEqual([]);
  });

  it("returns empty array when source is not an array", () => {
    const edition = makeEdition();
    (edition as Record<string, unknown>).ads = "not-an-array";
    (edition as Record<string, unknown>).enriched_ads = undefined;
    expect(transformAds(edition)).toEqual([]);
  });
});

// ── computePageCount ─────────────────────────────────────────────────

describe("computePageCount", () => {
  it("returns highest page number across articles", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({ source_pages: ["1", "2"] }),
        makeArticle({ source_pages: ["4"] }),
      ],
    });
    expect(computePageCount(edition)).toBe(4);
  });

  it("returns 1 for empty source_pages", () => {
    const edition = makeEdition({
      articles: [makeArticle({ source_pages: [] })],
    });
    expect(computePageCount(edition)).toBe(1);
  });

  it("handles non-numeric source_pages gracefully", () => {
    const edition = makeEdition({
      articles: [makeArticle({ source_pages: ["abc", "2"] })],
    });
    expect(computePageCount(edition)).toBe(2);
  });

  it("returns 1 when articles is missing", () => {
    const edition = { edition_date: "1970-01-07" } as unknown as OcrEdition;
    expect(computePageCount(edition)).toBe(1);
  });

  it("returns 1 for empty articles array", () => {
    const edition = makeEdition({ articles: [] });
    expect(computePageCount(edition)).toBe(1);
  });
});

// ── transformOtherContent ────────────────────────────────────────────

describe("transformOtherContent", () => {
  it("passes through other_content items", () => {
    const edition = makeEdition({
      other_content: [
        { title: "Class Schedule", body: "Monday: Math 101 at 9am" },
        { title: "Campus Notice", body: "Library closed Saturday" },
      ],
    });

    const result = transformOtherContent(edition);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Class Schedule");
    expect(result[1].body).toBe("Library closed Saturday");
  });

  it("returns empty array when other_content is missing", () => {
    const edition = makeEdition();
    (edition as Record<string, unknown>).other_content = undefined;
    expect(transformOtherContent(edition)).toEqual([]);
  });

  it("defaults empty title/body to empty string", () => {
    const edition = makeEdition({
      other_content: [{ title: "", body: "" }],
    });

    const [item] = transformOtherContent(edition);
    expect(item.title).toBe("");
    expect(item.body).toBe("");
  });
});
