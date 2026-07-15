import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const removedFiles = [
  "src/components/landing/CinemaBackground.tsx",
  "src/features/news-feed/components/ArticleCard.tsx",
  "src/features/news-feed/components/ScanViewer.tsx",
  "src/features/news-feed/hooks/useScanViewer.ts",
  "src/features/news-feed/hooks/useKeyboardNavigation.ts",
  "src/styles/components/article-card.css",
];

describe("removed edition UI", () => {
  it("has no dead component files or public exports", () => {
    for (const file of removedFiles) {
      expect(existsSync(resolve(file)), file).toBe(false);
    }

    const newsFeed = readFileSync(
      resolve("src/features/news-feed/components/NewsFeed.tsx"),
      "utf8",
    );
    const newsFeedIndex = readFileSync(
      resolve("src/features/news-feed/index.ts"),
      "utf8",
    );
    const sharedIndex = readFileSync(resolve("src/components/index.ts"), "utf8");
    const styleIndex = readFileSync(resolve("src/styles/index.css"), "utf8");
    const primitivesGallery = readFileSync(
      resolve("src/app/dev/primitives/page.tsx"),
      "utf8",
    );

    expect(newsFeed).not.toMatch(/ScanViewer|useScanViewer|useKeyboardNavigation/);
    expect(newsFeedIndex).not.toMatch(/ArticleCard/);
    expect(sharedIndex).not.toMatch(/CinemaBackground/);
    expect(styleIndex).not.toMatch(/article-card/);
    expect(primitivesGallery).not.toMatch(/ArticleCard/);
  });
});
