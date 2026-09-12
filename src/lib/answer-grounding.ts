import type { RetrievedArticle } from "@/src/lib/db";
import type { Citation } from "@/src/types";

interface AgentGroundingArticle {
  headline: string;
  editionDate: string;
  contentRevisionId?: string;
  imageUrls: string[];
  imageCaptions: (string | null)[];
}

export interface GroundedAnswer {
  answer: string;
  citations: Citation[];
}

// Groups match the reader's parser (src/features/ask-archive/lib/citations.ts):
// "[Source 1, Source 2]", the shorthand "[Source 3, 4]", and comma-joined agent
// ids. Counting only lone markers made an answer that cites in groups read as
// uncited, and it was replaced by a refusal.
const PIPELINE_CITATION_RE = /\[Source (\d+(?:\s*,\s*(?:Source\s*)?\d+)*)\]/gi;
const AGENT_CITATION_RE = /\[(\d{4}-\d{2}-\d{2}-\d+(?:\s*,\s*\d{4}-\d{2}-\d{2}-\d+)*)\]/g;
const IMAGE_MARKDOWN_RE = /!\[([^\]\r\n]*)\]\(([^)\r\n]+)\)/g;
const MARKDOWN_LINK_RE = /(?<!!)\[([^\]\r\n]+)\]\(([^)\r\n]+)\)/g;
const BARE_WEB_URL_RE = /https?:\/\/[^\s<>]+/gi;
const MAX_INLINE_IMAGES = 3;

function markdownSafeUrl(url: string): string {
  return url.replace(/ /g, "%20");
}

function cleanPunctuationSpacing(value: string): string {
  return value
    .replace(/[ \t]+([.,;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeLinksAndImages(answer: string, allowedImages: Map<string, string>): string {
  const placeholders: string[] = [];
  const emitted = new Set<string>();
  let imageCount = 0;

  let sanitized = answer.replace(IMAGE_MARKDOWN_RE, (_match, _modelAlt: string, rawUrl: string) => {
    const url = markdownSafeUrl(rawUrl.trim());
    const groundedCaption = allowedImages.get(url);
    if (groundedCaption === undefined || emitted.has(url) || imageCount >= MAX_INLINE_IMAGES) {
      return "";
    }
    emitted.add(url);
    imageCount += 1;
    const alt =
      groundedCaption
        .replace(/[\[\]\r\n]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180) || "Archive image";
    const placeholder = `\u0000RAG_IMAGE_${placeholders.length}\u0000`;
    placeholders.push(`![${alt}](${url})`);
    return placeholder;
  });

  // Archive answers have no supported general-link source. Preserve the
  // visible label but discard every model-produced destination.
  sanitized = sanitized.replace(MARKDOWN_LINK_RE, "$1");
  sanitized = sanitized.replace(BARE_WEB_URL_RE, "");
  sanitized = sanitized.replace(
    /\u0000RAG_IMAGE_(\d+)\u0000/g,
    (_match, index: string) => placeholders[Number(index)] ?? ""
  );
  return cleanPunctuationSpacing(sanitized);
}

export function groundPipelineAnswer(
  answer: string,
  sourceArticles: RetrievedArticle[]
): GroundedAnswer {
  const citedIndexes: number[] = [];
  const cleanedMarkers = answer.replace(PIPELINE_CITATION_RE, (_marker, inner: string) => {
    const indexes = inner
      .split(/\s*,\s*/)
      .map((raw) => Number.parseInt(raw.replace(/^Source\s*/i, ""), 10) - 1)
      .filter((index) => index >= 0 && index < sourceArticles.length);
    citedIndexes.push(...indexes);
    return indexes.length === 0
      ? ""
      : `[${indexes.map((index) => `Source ${index + 1}`).join(", ")}]`;
  });

  const citations: Citation[] = [];
  const citedIds = new Set<string>();
  const allowedImages = new Map<string, string>();
  for (const index of citedIndexes) {
    const article = sourceArticles[index];
    if (!citedIds.has(article.id)) {
      citedIds.add(article.id);
      citations.push({
        articleId: article.id,
        ...(article.contentRevisionId ? { contentRevisionId: article.contentRevisionId } : {}),
        headline: article.headline,
        editionDate: article.editionDate,
      });
    }
    article.imageUrls.forEach((rawUrl, imageIndex) => {
      const url = markdownSafeUrl(rawUrl);
      const caption = article.imageCaptions[imageIndex]?.trim();
      allowedImages.set(url, caption || "Archive image");
    });
  }

  return {
    answer: sanitizeLinksAndImages(cleanedMarkers, allowedImages),
    citations,
  };
}

export function groundAgentAnswer(
  answer: string,
  articleLookup: Map<string, AgentGroundingArticle>
): GroundedAnswer {
  const citedIdsInOrder: string[] = [];
  const cleanedMarkers = answer.replace(AGENT_CITATION_RE, (_marker, inner: string) => {
    const ids = inner.split(/\s*,\s*/).filter((articleId) => articleLookup.has(articleId));
    citedIdsInOrder.push(...ids);
    return ids.length === 0 ? "" : `[${ids.join(", ")}]`;
  });

  const citations: Citation[] = [];
  const seen = new Set<string>();
  const allowedImages = new Map<string, string>();
  for (const articleId of citedIdsInOrder) {
    const article = articleLookup.get(articleId);
    if (!article) continue;
    if (!seen.has(articleId)) {
      seen.add(articleId);
      citations.push({
        articleId,
        ...(article.contentRevisionId ? { contentRevisionId: article.contentRevisionId } : {}),
        headline: article.headline,
        editionDate: article.editionDate,
      });
    }
    article.imageUrls.forEach((rawUrl, imageIndex) => {
      const url = markdownSafeUrl(rawUrl);
      const caption = article.imageCaptions[imageIndex]?.trim();
      allowedImages.set(url, caption || "Archive image");
    });
  }

  return {
    answer: sanitizeLinksAndImages(cleanedMarkers, allowedImages),
    citations,
  };
}
