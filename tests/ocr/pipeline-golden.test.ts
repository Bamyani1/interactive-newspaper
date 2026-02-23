import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const ROOT = process.cwd();
const EDITION = path.join(ROOT, "public/editions/1980-04-17/edition.json");
const GOLDEN = path.join(ROOT, "tests/ocr/fixtures/golden/1980-04-17.metrics.json");

describe("OCR golden snapshot", () => {
  it("matches frozen edition-level metrics", () => {
    const edition = JSON.parse(readFileSync(EDITION, "utf-8"));
    const golden = JSON.parse(readFileSync(GOLDEN, "utf-8"));

    const observed = {
      articleCount: Array.isArray(edition.articles) ? edition.articles.length : 0,
      adCount: Array.isArray(edition.ads) ? edition.ads.length : 0,
      otherCount: Array.isArray(edition.other_content) ? edition.other_content.length : 0,
      categories: Array.from(
        new Set(
          (Array.isArray(edition.articles) ? edition.articles : [])
            .map((a: { category?: string }) => a.category)
            .filter(Boolean),
        ),
      ).sort(),
    };

    expect(observed).toEqual(golden);
  });
});
