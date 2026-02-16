import type { Article, SectionId } from "@/src/types";

export interface TopStoriesVariantProps {
  heroArticle: Article | null;
  featuredArticles: Article[];
  topExpandedArticle: Article | null;
  expandedId: string | null;
  focusedIndex: number;
  topArticles: Article[];
  onHeroReadMore: () => void;
  onFeaturedClick: (article: Article) => void;
  onExpandedToggle: () => void;
  onViewOriginal: (article: Article) => void;
  currentSection: SectionId;
  topExpandedRef: React.RefObject<HTMLDivElement | null>;
}
