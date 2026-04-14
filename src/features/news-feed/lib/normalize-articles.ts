import type { Article } from "@/src/types";

export interface RawArticle extends Omit<Article, "imageUrls"> {
  imageUrls?: string[];
  imageUrl?: string;
}

const CATEGORY_LOOKUP: Record<string, Article["category"]> = {
  "campus news": "Campus News",
  "campus-news": "Campus News",
  news: "News",
  "world & nation": "News",
  "world-and-nation": "News",
  sports: "Sports",
  features: "Campus News",
  opinion: "Opinion",
  "arts & entertainment": "Arts & Entertainment",
  "arts-and-entertainment": "Arts & Entertainment",
  arts: "Arts & Entertainment",
  photography: "Arts & Entertainment",
};

const normalizeText = (value: unknown): string =>
  typeof value === "string" ? value : "";

const normalizeCategory = (value: unknown): Article["category"] => {
  if (typeof value !== "string") return "Campus News";
  return CATEGORY_LOOKUP[value.trim().toLowerCase()] ?? "Campus News";
};

const normalizeId = (
  value: unknown,
  editionDate: string,
  page: number | undefined,
  index: number,
): string => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return `${editionDate}-article-${page ?? 0}-${index}`;
};

export function normalizeArticles(
  rawArticles: RawArticle[],
  editionDate: string,
): Article[] {
  return rawArticles.map((a, index) => {
    const normalizedFullText = normalizeText(a.fullText);
    const page = typeof a.page === "number" ? a.page : 1;
    const imageUrls = Array.isArray(a.imageUrls)
      ? a.imageUrls.map((u) => normalizeText(u)).filter(Boolean)
      : a.imageUrl && normalizeText(a.imageUrl)
        ? [normalizeText(a.imageUrl)]
        : [];

    const headline =
      normalizeText(a.headline) ||
      (imageUrls.length > 0 && !normalizedFullText ? "" : "Untitled Article");

    return {
      id: normalizeId(a.id, editionDate, page, index),
      date: editionDate,
      category: normalizeCategory(a.category),
      headline,
      summary: normalizeText(a.summary),
      fullText: normalizedFullText,
      imageUrls,
      byline: normalizeText(a.byline) || undefined,
      writerPosition: normalizeText(a.writerPosition) || undefined,
      imageCaption: normalizeText(a.imageCaption) || undefined,
      imageCaptions: Array.isArray(a.imageCaptions)
        ? a.imageCaptions.map((c: string | null) => (c ? normalizeText(c) : null))
        : [],
      page,
      isFeatured: Boolean(a.isFeatured),
      isHero: Boolean(a.isHero),
    };
  });
}
