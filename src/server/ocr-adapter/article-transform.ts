import type { Article, OcrEdition } from "@/src/types";
import { VALID_CATEGORIES, classifyCategory } from "./category-rules";
import {
  doesLastParagraphMatchAnyCaption,
  isAdImageDescription,
  isAuthorHeadshot,
  isBodyMostlyCaption,
  isValidImageFile,
} from "./image-rules";
import {
  bodyToHtml,
  cleanBodyPreamble,
  extractSummary,
} from "./text-cleaning";

export function computePageCount(edition: OcrEdition): number {
  if (!Array.isArray(edition.articles)) return 1;
  let max = 1;
  for (const article of edition.articles) {
    for (const p of article.source_pages ?? []) {
      const n = parseInt(p, 10);
      if (n > max) max = n;
    }
  }
  return max;
}

function getMinTextLength(): number {
  const raw = Number(process.env.OCR_MIN_TEXT_LENGTH ?? "150");
  return Number.isFinite(raw) && raw >= 0 ? raw : 150;
}

export function transformArticles(edition: OcrEdition): Article[] {
  const articles: Article[] = [];
  const date = edition.edition_date;
  const minTextLength = getMinTextLength();
  if (!Array.isArray(edition.articles)) return articles;

  for (let i = 0; i < edition.articles.length; i++) {
    const a = edition.articles[i];
    const authorRaw = a.author === "null" ? "" : (a.author || "");
    const hasAuthor = Boolean(authorRaw);
    const preamble = cleanBodyPreamble(a.body ?? "", hasAuthor);
    let cleanBody = preamble.body;
    const { roleTitle } = preamble;

    let fullText = bodyToHtml(cleanBody);

    // Build raw image arrays (valid image files only)
    const rawEntries = (a.image_files ?? [])
      .map((f, idx) => ({ f, idx }))
      .filter(({ f }) => isValidImageFile(f));

    const rawImageUrls = rawEntries.map(({ f }) => {
      const filename = f.replace(/^images\//, "");
      return `/api/editions/${date}/images/${encodeURIComponent(filename)}`;
    });

    const rawImageCaptions: (string | null)[] = rawEntries.map(
      ({ idx }) => a.images?.[idx]?.caption || null,
    );

    // Filter out author headshots
    const authorName = authorRaw.replace(/^by\s+/i, "").trim();
    const filtered = rawImageUrls
      .map((url, idx) => ({
        url,
        caption: rawImageCaptions[idx],
      }))
      .filter(({ caption }) => !isAuthorHeadshot(caption ?? undefined, authorName));

    const filteredImageUrls = filtered.map(({ url }) => url);
    const filteredImageCaptions = filtered.map(({ caption }) => caption);
    const imageCaption = filteredImageCaptions[0] || null;

    // Detect body/caption duplication: if body ~= caption, treat as photo-only.
    if (imageCaption && fullText && isBodyMostlyCaption(cleanBody, imageCaption)) {
      fullText = "";
    }

    // Strip trailing caption text from body (OCR often appends captions as body paragraphs)
    if (
      filteredImageCaptions.length > 0 &&
      cleanBody &&
      doesLastParagraphMatchAnyCaption(cleanBody, filteredImageCaptions)
    ) {
      const paragraphs = cleanBody.split(/\n\n+/);
      paragraphs.pop();
      cleanBody = paragraphs.join("\n\n");
      fullText = bodyToHtml(cleanBody);
    }

    articles.push({
      id: `${date}-${i}`,
      date,
      category: (() => {
        const rawCat = edition.categories?.[i] ?? a.category ?? classifyCategory(a);
        if (typeof rawCat === "string" && VALID_CATEGORIES.has(rawCat as Article["category"])) {
          return rawCat as Article["category"];
        }
        return "Campus News";
      })(),
      headline: a.headline ?? "",
      summary: extractSummary(cleanBody),
      fullText,
      imageUrls: filteredImageUrls,
      byline: authorRaw.replace(/^by\s+/i, "").trim() || null,
      writerPosition: a.writer_position || roleTitle || null,
      page: parseInt(a.source_pages?.[0], 10) || 1,
      isHero: false,
      isFeatured: false,
      imageCaption,
      imageCaptions: filteredImageCaptions,
    });
  }

  // Reclassify photo-only items as Arts & Entertainment
  for (const article of articles) {
    const plainText = article.fullText.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const hasHeadline = article.headline.trim().length > 0;
    const hasBody = plainText.length > 0;
    const hasImages = article.imageUrls.length > 0;
    if (!hasHeadline && !hasBody && hasImages) {
      article.category = "Arts & Entertainment";
    }
  }

  // Filter out empty and very-short text-only articles
  const filtered = articles.filter((article) => {
    const plainText = article.fullText.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const hasImages = article.imageUrls.length > 0;
    const hasHeadline = article.headline.trim().length > 0;

    // Remove completely empty articles (no headline, no text, no images)
    if (!hasHeadline && !plainText && !hasImages) return false;

    // Remove articles whose headline is an AI-generated ad image description
    if (isAdImageDescription(article.headline)) return false;

    // Remove image-described entries: headline is just the image caption with no real body
    if (hasImages && article.imageCaption) {
      const headlineNorm = article.headline.trim().toLowerCase();
      const captionNorm = article.imageCaption.trim().toLowerCase();
      if (headlineNorm === captionNorm && !plainText) return false;
    }

    // Keep articles that have images (photo features)
    if (hasImages) return true;

    // Remove text-only articles that are too short unless overridden for archival runs.
    if (minTextLength === 0) return plainText.length > 0;
    return plainText.length >= minTextLength;
  });

  // Assign hero & featured: prioritize articles with images (excluding photo-only items)
  const isPhotoOnly = (a: Article) =>
    a.imageUrls.length > 0 &&
    !a.headline.trim() &&
    !a.fullText.replace(/<[^>]+>/g, "").trim();

  const withImages = filtered.filter((a) => a.imageUrls.length > 0 && !isPhotoOnly(a));
  const withoutImages = filtered.filter((a) => a.imageUrls.length === 0);
  const candidates = [...withImages, ...withoutImages];

  for (let i = 0; i < Math.min(5, candidates.length); i++) {
    candidates[i].isFeatured = true;
    if (i === 0) candidates[i].isHero = true;
  }

  return filtered;
}
