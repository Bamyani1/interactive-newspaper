import { Article } from "../data/mockData";

export const getArticleAuthor = (article: Article): string | undefined => {
  return article.byline ?? undefined;
};

export const getArticlePage = (article: Article): number | undefined => {
  if (article.page) return article.page;

  const match = article.imageUrl?.match(/p(\d+)/i);
  if (match) {
    const parsed = Number.parseInt(match[1], 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  return undefined;
};

