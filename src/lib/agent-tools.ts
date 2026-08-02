import { Type } from "@google/genai";
import {
  fetchArticleForRag,
  queryEditions,
} from "@/src/lib/db";
import { searchAndRankArchive } from "@/src/lib/retrieval";
import type { RetrievalFilters } from "@/src/lib/retrieval";

const CATEGORIES = [
  "Campus News",
  "News",
  "Sports",
  "Arts & Entertainment",
  "Opinion",
] as const;

function mdSafeUrls(urls: string[]): string[] {
  return urls.map((url) => url.replace(/ /g, "%20"));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const AGENT_TOOL_DECLARATIONS: any[] = [
  {
    name: "search_archive",
    description:
      "Search the Ohio Wesleyan Transcript newspaper archive (1950-2006). " +
      "Uses the same reformulation, chunk/image retrieval, reranking, and corrective retry as the main RAG path.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "Natural-language search query" },
        startDate: { type: Type.STRING, description: "Earliest edition date (YYYY-MM-DD)" },
        endDate: { type: Type.STRING, description: "Latest edition date (YYYY-MM-DD)" },
        category: {
          type: Type.STRING,
          description: "Filter by article category",
          enum: [...CATEGORIES],
        },
        limit: { type: Type.NUMBER, description: "Maximum results (1-20, default 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "read_article",
    description: "Retrieve the complete text of an article returned by search_archive.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        articleId: { type: Type.STRING, description: "Article ID returned by search_archive" },
      },
      required: ["articleId"],
    },
  },
  {
    name: "list_editions",
    description: "List archive edition dates with pagination and article counts.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        startDate: { type: Type.STRING, description: "Earliest date (YYYY-MM-DD)" },
        endDate: { type: Type.STRING, description: "Latest date (YYYY-MM-DD)" },
        offset: { type: Type.NUMBER, description: "Pagination offset (default 0)" },
        limit: { type: Type.NUMBER, description: "Page size (1-100, default 50)" },
      },
    },
  },
];

class ToolArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolArgumentError";
  }
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new ToolArgumentError(`${key} must be a string`);
  return value.trim();
}

function requiredString(args: Record<string, unknown>, key: string, maxLength = 500): string {
  const value = optionalString(args, key);
  if (!value) throw new ToolArgumentError(`${key} is required`);
  if (value.length > maxLength) throw new ToolArgumentError(`${key} is too long`);
  return value;
}

function dateArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = optionalString(args, key);
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ToolArgumentError(`${key} must use YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(value)) {
    throw new ToolArgumentError(`${key} is not a real date`);
  }
  return value;
}

function boundedInteger(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = args[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ToolArgumentError(`${key} must be an integer`);
  }
  return Math.max(min, Math.min(max, value));
}

function dateRange(args: Record<string, unknown>) {
  const startDate = dateArg(args, "startDate");
  const endDate = dateArg(args, "endDate");
  if (startDate && endDate && startDate > endDate) {
    throw new ToolArgumentError("startDate must not be after endDate");
  }
  return { startDate, endDate };
}

function constrainedFilters(
  requested: { startDate?: string; endDate?: string; category?: string },
  enforced: RetrievalFilters | undefined,
): RetrievalFilters {
  const startDates = [requested.startDate, enforced?.startDate].filter(
    (value): value is string => Boolean(value),
  );
  const endDates = [requested.endDate, enforced?.endDate].filter(
    (value): value is string => Boolean(value),
  );
  const startDate = startDates.sort().at(-1);
  const endDate = endDates.sort().at(0);
  if (startDate && endDate && startDate > endDate) {
    throw new ToolArgumentError("tool date range falls outside the enforced archive filters");
  }
  return {
    startDate,
    endDate,
    category: enforced?.category ?? requested.category,
  };
}

async function executeSearchArchive(
  args: Record<string, unknown>,
  opts: { signal?: AbortSignal; requestId?: string; filters?: RetrievalFilters },
): Promise<Record<string, unknown>> {
  const query = requiredString(args, "query");
  const requestedDates = dateRange(args);
  const category = optionalString(args, "category");
  if (category && !CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
    throw new ToolArgumentError("category is not supported");
  }
  const filters = constrainedFilters(
    { ...requestedDates, category },
    opts.filters,
  );
  const limit = boundedInteger(args, "limit", 10, 1, 20);
  const retrieval = await searchAndRankArchive({
    question: query,
    filters,
    maxArticles: limit,
    signal: opts.signal,
    requestId: opts.requestId,
  });

  return {
    results: retrieval.articles.map((article) => ({
      id: article.id,
      headline: article.headline,
      editionDate: article.editionDate,
      category: article.category,
      summary: article.summary,
      byline: article.byline,
      relevantPassages: article.matchedPassages ?? [],
      excerpt:
        article.matchedPassages?.join("\n\n") ||
        article.summary ||
        article.bodyPlain,
      relevanceScore: article.relevanceScore,
      imageUrls: mdSafeUrls(article.imageUrls),
      imageCaptions: article.imageCaptions ?? [],
    })),
    retrieval: {
      candidates: retrieval.candidates,
      method: retrieval.method,
      mode: retrieval.mode,
      elapsedMs: retrieval.retrievalTimeMs,
    },
  };
}

async function executeReadArticle(
  args: Record<string, unknown>,
  opts: { signal?: AbortSignal; filters?: RetrievalFilters },
): Promise<Record<string, unknown>> {
  const articleId = requiredString(args, "articleId", 100);
  if (!/^\d{4}-\d{2}-\d{2}-\d+$/.test(articleId)) {
    throw new ToolArgumentError("articleId has an invalid format");
  }
  const article = await fetchArticleForRag(articleId, { signal: opts.signal });
  if (!article) return { error: "Article not found" };
  if (
    (opts.filters?.startDate && article.editionDate < opts.filters.startDate) ||
    (opts.filters?.endDate && article.editionDate > opts.filters.endDate) ||
    (opts.filters?.category && article.category !== opts.filters.category)
  ) {
    return { error: "Article falls outside the enforced archive filters" };
  }
  return {
    id: article.id,
    editionDate: article.editionDate,
    category: article.category,
    headline: article.headline,
    summary: article.summary,
    byline: article.byline,
    bodyPlain: article.bodyPlain,
    imageUrls: mdSafeUrls(article.imageUrls),
    imageCaptions: article.imageCaptions ?? [],
  };
}

async function executeListEditions(
  args: Record<string, unknown>,
  opts: { signal?: AbortSignal; filters?: RetrievalFilters },
): Promise<Record<string, unknown>> {
  const { startDate, endDate } = constrainedFilters(dateRange(args), opts.filters);
  const offset = boundedInteger(args, "offset", 0, 0, 100_000);
  const limit = boundedInteger(args, "limit", 50, 1, 100);
  const result = await queryEditions({ startDate, endDate, offset, limit, signal: opts.signal });
  return {
    editions: result.editions.map((edition) => ({
      date: edition.date,
      articleCount: edition.articleCount,
    })),
    pagination: result.pagination,
  };
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  opts: { signal?: AbortSignal; requestId?: string; filters?: RetrievalFilters } = {},
): Promise<Record<string, unknown>> {
  try {
    switch (name) {
      case "search_archive":
        return await executeSearchArchive(args, opts);
      case "read_article":
        return await executeReadArticle(args, opts);
      case "list_editions":
        return await executeListEditions(args, opts);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof ToolArgumentError ? { kind: "invalid_arguments" } : {}),
    };
  }
}
