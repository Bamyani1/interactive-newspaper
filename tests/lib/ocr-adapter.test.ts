import { describe, it, expect } from "vitest";
import { transformArticles, transformAds, computePageCount } from "@/src/lib/ocr-adapter";
import type { OcrEdition, OcrArticle, OcrEnrichedAd } from "@/src/types";

// Body text in test articles must exceed the 150-char content filter in
// transformArticles. BODY_PAD provides reusable filler to reach that threshold.
const _BODY_PAD =
  " The campus community gathered to discuss the implications of these developments at length, with several faculty members contributing additional perspectives on the matter.";

// ── Helpers ──────────────────────────────────────────────────────────

function makeArticle(overrides: Partial<OcrArticle> = {}): OcrArticle {
  return {
    headline: "Test Headline",
    author: "By Test Author",
    body: "The Ohio Wesleyan University campus was bustling with activity this week as students prepared for the upcoming semester.\n\nFaculty members announced several new courses that will be offered starting next fall, including expanded options in the sciences.",
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
          body: "The results are in and the student body has responded with great enthusiasm across all departments.\n\nMore details follow as the administration releases the full breakdown of votes and turnout numbers.",
          source_pages: ["3"],
        }),
      ],
    });

    const articles = transformArticles(edition);
    expect(articles).toHaveLength(1);
    expect(articles[0].id).toBe("1970-01-07-0");
    expect(articles[0].date).toBe("1970-01-07");
    expect(articles[0].headline).toBe("Campus Election Results");
    expect(articles[0].byline).toBe("Jane Doe");
    expect(articles[0].page).toBe(3);
  });

  it("extracts summary from first paragraph", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({ body: "Short first paragraph.\n\nSecond paragraph with more detail about the upcoming campus events and renovations that will affect daily student life throughout the remainder of the academic term." }),
      ],
    });

    const [article] = transformArticles(edition);
    expect(article.summary).toBe("Short first paragraph.");
  });

  it("truncates summary at word boundary within 300 characters", () => {
    // Build a paragraph of words that exceeds 300 chars
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`);
    const longParagraph = words.join(" "); // ~400 chars
    const edition = makeEdition({
      articles: [makeArticle({ body: longParagraph })],
    });

    const [article] = transformArticles(edition);
    expect(article.summary.length).toBeLessThanOrEqual(303); // 300 + "..."
    expect(article.summary).toMatch(/\.\.\.$/);
    // Should end at a complete word (no partial words before "...")
    const withoutEllipsis = article.summary.slice(0, -3);
    const lastChar = withoutEllipsis[withoutEllipsis.length - 1];
    // Last char should be a digit or letter (end of a word), not a space
    expect(lastChar).toMatch(/\w/);
    // The next char in the original should be a space (word boundary)
    const nextCharInOriginal = longParagraph[withoutEllipsis.length];
    expect(nextCharInOriginal).toBe(" ");
  });

  it("converts body to HTML with escaped characters", () => {
    const edition = makeEdition({
      articles: [makeArticle({ body: "Hello <world> & friends.\n\nSecond paragraph continues with additional details about the campus event schedule and upcoming renovations that will affect the student body throughout the remainder of the term." })],
    });

    const [article] = transformArticles(edition);
    expect(article.fullText).toContain("&lt;world&gt;");
    expect(article.fullText).toContain("&amp;");
    expect(article.fullText).toMatch(/<p>.*<\/p>/);
  });

  it("strips OCR page-break markers from body", () => {
    const edition = makeEdition({
      articles: [makeArticle({ body: "Start of text with an extended opening that provides enough context for the article to pass content filters.\n. 7\nContinued text covers the remaining details about the student organization event and its impact on campus life." })],
    });

    const [article] = transformArticles(edition);
    expect(article.fullText).not.toContain(". 7");
  });

  it("uses categories[] when provided", () => {
    const edition = makeEdition({
      articles: [makeArticle(), makeArticle()],
      categories: ["Sports", "Arts & Entertainment"],
    });

    const articles = transformArticles(edition);
    expect(articles[0].category).toBe("Sports");
    expect(articles[1].category).toBe("Arts & Entertainment");
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
    (edition as unknown as Record<string, unknown>).articles = null;
    expect(transformArticles(edition)).toEqual([]);
  });

  it("extracts image caption from first image", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          image_files: ["images/photo.jpg"],
          images: [{ caption: "A great photo", position: "top" }],
        }),
      ],
    });

    const [article] = transformArticles(edition);
    expect(article.imageCaption).toBe("A great photo");
  });

  it("builds imageCaptions array parallel to imageUrls", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          image_files: ["images/a.jpg", "images/b.jpg", "images/c.jpg"],
          images: [
            { caption: "First caption", position: "top" },
            { caption: "Second caption", position: "middle" },
            { caption: "Third caption", position: "bottom" },
          ],
        }),
      ],
    });

    const [article] = transformArticles(edition);
    expect(article.imageCaptions).toHaveLength(3);
    expect(article.imageCaptions[0]).toBe("First caption");
    expect(article.imageCaptions[1]).toBe("Second caption");
    expect(article.imageCaptions[2]).toBe("Third caption");
    expect(article.imageCaptions).toHaveLength(article.imageUrls.length);
  });

  it("returns null in imageCaptions when caption is missing", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          image_files: ["images/a.jpg", "images/b.jpg"],
          images: [{ caption: "Only first", position: "top" }],
        }),
      ],
    });

    const [article] = transformArticles(edition);
    expect(article.imageCaptions).toHaveLength(2);
    expect(article.imageCaptions[0]).toBe("Only first");
    expect(article.imageCaptions[1]).toBeNull();
  });

  it("returns empty imageCaptions when no image_files", () => {
    const edition = makeEdition({
      articles: [makeArticle({ image_files: [], images: [] })],
    });

    const [article] = transformArticles(edition);
    expect(article.imageCaptions).toEqual([]);
  });

  it("filters non-image files from imageCaptions using original indices", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          image_files: ["images/photo.jpg", "readme.txt", "images/pic.png"],
          images: [
            { caption: "Photo cap", position: "top" },
            { caption: "Text cap", position: "mid" },
            { caption: "Pic cap", position: "bot" },
          ],
        }),
      ],
    });

    const [article] = transformArticles(edition);
    // readme.txt is filtered out, so only 2 valid images
    expect(article.imageCaptions).toHaveLength(2);
    expect(article.imageUrls).toHaveLength(2);
    expect(article.imageCaptions[0]).toBe("Photo cap");
    // images/pic.png is at original index 2, so it gets images[2].caption
    expect(article.imageCaptions[1]).toBe("Pic cap");
  });

  it("strips 'By ' prefix from byline", () => {
    const edition = makeEdition({
      articles: [makeArticle({ author: "By Ray Esch" })],
    });

    const [article] = transformArticles(edition);
    expect(article.byline).toBe("Ray Esch");
  });

  it("handles byline without 'By ' prefix", () => {
    const edition = makeEdition({
      articles: [makeArticle({ author: "Staff Reporter" })],
    });

    const [article] = transformArticles(edition);
    expect(article.byline).toBe("Staff Reporter");
  });

  it("returns null byline for empty author", () => {
    const edition = makeEdition({
      articles: [makeArticle({ author: "" })],
    });

    const [article] = transformArticles(edition);
    expect(article.byline).toBeNull();
  });

  it("validates categories against allowed values", () => {
    const edition = makeEdition({
      articles: [makeArticle(), makeArticle()],
      categories: ["Sports", "InvalidCategory"],
    });

    const articles = transformArticles(edition);
    expect(articles[0].category).toBe("Sports");
    expect(articles[1].category).toBe("Campus News"); // invalid falls back to Campus News
  });

  it("defaults page to 1 when source_pages is empty", () => {
    const edition = makeEdition({
      articles: [makeArticle({ source_pages: [] })],
    });

    const [article] = transformArticles(edition);
    expect(article.page).toBe(1);
  });

  it("strips role title from body start and appends to byline", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          author: "By Tom Grissom",
          body: "Sports Editor\n\nOhio Wesleyan faces Otterbein in what promises to be the most anticipated matchup of the season, with both teams entering the contest undefeated in conference play and vying for the top spot in the standings.",
        }),
      ],
    });
    const [article] = transformArticles(edition);
    expect(article.byline).toBe("Tom Grissom");
    expect(article.writerPosition).toBe("Sports Editor");
    expect(article.fullText).not.toContain("Sports Editor");
    expect(article.summary).not.toContain("Sports Editor");
  });

  it("strips 'Transcript Staff' from body start and appends to byline", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          author: "By Pat Hanna",
          body: "Transcript Staff\n\nThe concert begins this Friday evening in Gray Chapel, featuring performances by the university choir and a guest string quartet from the Columbus Symphony Orchestra, with free admission for students.",
        }),
      ],
    });
    const [article] = transformArticles(edition);
    expect(article.byline).toBe("Pat Hanna");
    expect(article.writerPosition).toBe("Transcript Staff");
    expect(article.fullText).not.toContain("Transcript Staff");
  });

  it("does NOT strip a deck/sub-headline (long first line)", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          author: "By Ray Esch",
          body: "Conrades, Maxwell, Ollendorff To Vie\n\nThree juniors have announced their candidacy for student body president, each bringing distinct platforms focused on campus dining reform, expanded library hours, and improved dormitory conditions for the coming year.",
        }),
      ],
    });
    const [article] = transformArticles(edition);
    expect(article.byline).toBe("Ray Esch");
    expect(article.summary).toContain("Conrades");
  });

  it("does NOT strip short first paragraph when article has no author", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          author: "",
          body: "Opening Night\n\nThe performance was spectacular and drew a standing ovation from the packed auditorium, with critics praising the student cast for their compelling portrayals and the innovative staging that brought new life to the classic work.",
        }),
      ],
    });
    const [article] = transformArticles(edition);
    expect(article.fullText).toContain("Opening Night");
  });
});

// ── Ad-image-description filtering (via transformArticles) ───────────

describe("ad-image-description filtering", () => {
  it("drops articles whose headline is an AI-generated ad description", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          headline:
            "advertisement titled 'Super Featured Edibles' listing dining specials and hours for various campus locations",
          body: "",
          image_files: ["images/ad-scan.jpg"],
          images: [{ caption: "Super Featured Edibles", position: "top" }],
        }),
        makeArticle({ headline: "Bishops Win Big Game" }),
      ],
    });

    const articles = transformArticles(edition);
    expect(articles).toHaveLength(1);
    expect(articles[0].headline).toBe("Bishops Win Big Game");
  });

  it("keeps normal articles with images", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          headline: "Campus Photo Gallery",
          image_files: ["images/campus.jpg"],
        }),
      ],
    });

    const articles = transformArticles(edition);
    expect(articles).toHaveLength(1);
  });
});

// ── Salutation stripping (via transformArticles) ─────────────────────

describe("salutation stripping", () => {
  it("strips 'Editor, the Transcript:' salutation from body start", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          author: "John Smith '60",
          body: "Editor, the Transcript:\n\nA university needs more funding to maintain its academic programs and student services, particularly in light of recent budget cuts that have already impacted several departments and threatened the future of key research initiatives.",
        }),
      ],
    });
    const [article] = transformArticles(edition);
    expect(article.summary).toMatch(/^A university needs/);
    expect(article.fullText).not.toContain("Editor, the Transcript");
  });

  it("strips salutation without colon", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          author: "Jane Doe '60",
          body: "Editor, the Transcript\n\nI disagree with the policy changes proposed by the administration regarding campus parking regulations, which would disproportionately affect commuter students who already face significant challenges finding convenient spaces near their classes.",
        }),
      ],
    });
    const [article] = transformArticles(edition);
    expect(article.summary).toMatch(/^I disagree/);
    expect(article.fullText).not.toContain("Editor, the Transcript");
  });

  it("strips salutation case-insensitively", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          author: "Bob '60",
          body: "Editor, The Transcript:\n\nWe should consider the long-term consequences of reducing library hours during finals week, as this decision undermines the academic mission of our institution and places unnecessary stress on students preparing for their most important examinations.",
        }),
      ],
    });
    const [article] = transformArticles(edition);
    expect(article.summary).toMatch(/^We should consider/);
  });

  it("preserves embedded reference to editor (not standalone paragraph)", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          body: "I wrote to the Editor, the Transcript about funding concerns last semester and was disappointed by the lack of administrative response.\n\nMore details have since emerged about the budget shortfall that confirm many of the concerns raised by students and faculty members alike.",
        }),
      ],
    });
    const [article] = transformArticles(edition);
    expect(article.summary).toContain("I wrote to the Editor");
  });

  it("strips both salutation and role title in sequence", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          author: "By Tom Grissom",
          body: "Editor, the Transcript:\n\nStaff Writer\n\nThe body starts here with a detailed analysis of recent campus developments that have generated significant discussion among students, faculty, and administrators regarding the future direction of university programming.",
        }),
      ],
    });
    const [article] = transformArticles(edition);
    expect(article.fullText).not.toContain("Editor, the Transcript");
    expect(article.fullText).not.toContain("Staff Writer");
    expect(article.byline).toBe("Tom Grissom");
    expect(article.writerPosition).toBe("Staff Writer");
    expect(article.summary).toMatch(/^The body starts here/);
  });
});

// ── Headshot filtering (via transformArticles) ───────────────────────

describe("headshot filtering", () => {
  it("filters image when caption matches author name", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          author: "By Diser",
          image_files: ["images/headshot.jpg"],
          images: [{ caption: "Diser", position: "top" }],
        }),
      ],
    });
    const [article] = transformArticles(edition);
    expect(article.imageUrls).toHaveLength(0);
    expect(article.imageCaption).toBeNull();
  });

  it("filters image when caption matches author last name", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          author: "By Philip Diser",
          image_files: ["images/headshot.jpg"],
          images: [{ caption: "Diser", position: "top" }],
        }),
      ],
    });
    const [article] = transformArticles(edition);
    expect(article.imageUrls).toHaveLength(0);
  });

  it("keeps image when caption does not match author", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          author: "By Ray Esch",
          image_files: ["images/candidate.jpg"],
          images: [{ caption: "Conrades", position: "top" }],
        }),
      ],
    });
    const [article] = transformArticles(edition);
    expect(article.imageUrls).toHaveLength(1);
  });

  it("keeps image with long caption (more than 3 words)", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          author: "By Tom G.",
          image_files: ["images/action.jpg"],
          images: [{ caption: "Guard drives for a bucket", position: "top" }],
        }),
      ],
    });
    const [article] = transformArticles(edition);
    expect(article.imageUrls).toHaveLength(1);
  });

  it("filters only headshot when mixed with content images", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          author: "By Philip Diser",
          image_files: ["images/headshot.jpg", "images/campus.jpg"],
          images: [
            { caption: "Diser", position: "top" },
            { caption: "Campus quad at sunset", position: "bottom" },
          ],
        }),
      ],
    });
    const [article] = transformArticles(edition);
    expect(article.imageUrls).toHaveLength(1);
    expect(article.imageCaption).toBe("Campus quad at sunset");
    expect(article.imageCaptions).toEqual(["Campus quad at sunset"]);
  });

  it("strips trailing caption text duplicated in body", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          headline: "Senator To Speak",
          body: "The senator will speak at commencement this June and the campus community is buzzing with anticipation for this major event.\n\nMore details about the event and venue were released by the administration this week.\n\nSENATOR JOHN DOE will address the graduating class on June 14.",
          image_files: ["images/senator.jpg"],
          images: [{ caption: "SENATOR JOHN DOE will address the graduating class on June 14.", position: "top" }],
        }),
      ],
    });

    const [article] = transformArticles(edition);
    expect(article.fullText).not.toContain("SENATOR JOHN DOE will address");
    expect(article.fullText).toContain("More details");
  });

  it("does not filter when author is empty", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          author: "",
          image_files: ["images/smith.jpg"],
          images: [{ caption: "Smith", position: "top" }],
        }),
      ],
    });
    const [article] = transformArticles(edition);
    expect(article.imageUrls).toHaveLength(1);
  });
});

// ── dehyphenation (tested indirectly via transformArticles) ──────────

describe("dehyphenation", () => {
  it("rejoins words split across double newlines (paragraph breaks)", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          body: "He spoke per-\n\nsonally to the faculty about the proposed changes to the academic calendar that would affect all departments and their scheduling for the upcoming semester.",
        }),
      ],
    });
    const [article] = transformArticles(edition);
    expect(article.fullText).toContain("personally");
    expect(article.fullText).not.toContain("per-");
  });

  it("rejoins words split across single newlines", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          body: "There are many ex-\namples of student involvement in campus governance throughout the university's long and distinguished history of promoting democratic participation among its student body.",
        }),
      ],
    });
    const [article] = transformArticles(edition);
    expect(article.fullText).toContain("examples");
    expect(article.fullText).not.toContain("ex-");
  });

  it("does not merge when next line starts with uppercase (real paragraph break)", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          body: "The club held a bake-\n\nSale proceeds went to charity and were distributed among several local organizations serving the Delaware community throughout the year.",
        }),
      ],
    });
    const [article] = transformArticles(edition);
    expect(article.fullText).toContain("bake-");
  });

  it("dehyphenates in summary as well", () => {
    const edition = makeEdition({
      articles: [
        makeArticle({
          body: "The com-\nmittee met yesterday to discuss important matters.\n\nSecond paragraph covers additional details about the campus renovation project that will transform several key buildings over the coming academic year.",
        }),
      ],
    });
    const [article] = transformArticles(edition);
    expect(article.summary).toContain("committee");
    expect(article.summary).not.toContain("com-");
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

  it("detects Arts & Entertainment from byline 'Entertainment' keyword", () => {
    expect(classifyVia({ author: "By Jane, Entertainment" })).toBe("Arts & Entertainment");
  });

  it("detects Sports from byline without comma", () => {
    expect(classifyVia({ author: "By John Sports Editor" })).toBe("Sports");
  });

  it("detects Opinion from letter to editor", () => {
    expect(classifyVia({ body: "Editor, The Transcript\n\nI write to complain about the recent decision to close the student center on weekends, which significantly reduces the available gathering spaces for student organizations and social activities during a critical time." })).toBe(
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

  it("detects Arts & Entertainment from headline keywords", () => {
    expect(classifyVia({ headline: "New Film Festival Opens on Campus" })).toBe("Arts & Entertainment");
  });

  it("defaults to Campus News", () => {
    expect(classifyVia({ headline: "Budget Approved", author: "By Staff" })).toBe("Campus News");
  });

  it("detects News from headline keywords", () => {
    expect(classifyVia({ headline: "Congress Passes New Education Bill" })).toBe("News");
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
    (edition as unknown as Record<string, unknown>).ads = undefined;
    (edition as unknown as Record<string, unknown>).enriched_ads = undefined;
    expect(transformAds(edition)).toEqual([]);
  });

  it("returns empty array when source is not an array", () => {
    const edition = makeEdition();
    (edition as unknown as Record<string, unknown>).ads = "not-an-array";
    (edition as unknown as Record<string, unknown>).enriched_ads = undefined;
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

