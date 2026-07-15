import type { Article } from "@/src/types";

export interface TopStoriesVariantProps {
  heroArticle: Article | null;
  featuredArticles: Article[];
}
