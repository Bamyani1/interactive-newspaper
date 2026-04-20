import { Type } from "@google/genai";
import { neon } from "@neondatabase/serverless";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { hybridSearch, queryEditions } from "@/src/lib/db";
import { embedQuery } from "@/src/lib/embeddings";

let _sql: NeonQueryFunction<false, false> | null = null;
function getSql() {
    if (!_sql) _sql = neon(process.env.DATABASE_URL!);
    return _sql;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const AGENT_TOOL_DECLARATIONS: any[] = [
  {
    name: "search_archive",
    description:
      "Search the Ohio Wesleyan Transcript newspaper archive (1950-2006, 11705 articles). " +
      "Uses hybrid vector + full-text search. Returns matching articles ranked by relevance.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "Natural-language search query",
        },
        startDate: {
          type: Type.STRING,
          description: "Earliest edition date to include (YYYY-MM-DD)",
        },
        endDate: {
          type: Type.STRING,
          description: "Latest edition date to include (YYYY-MM-DD)",
        },
        category: {
          type: Type.STRING,
          description: "Filter by article category",
          enum: [
            "Campus News",
            "News",
            "Sports",
            "Arts & Entertainment",
            "Opinion",
          ],
        },
        limit: {
          type: Type.NUMBER,
          description: "Max results to return (default 10, max 20)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "read_article",
    description:
      "Retrieve the full text of a single article by its ID. " +
      "Use after search_archive to read an article in full.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        articleId: {
          type: Type.STRING,
          description: "The article ID returned by search_archive",
        },
      },
      required: ["articleId"],
    },
  },
  {
    name: "list_editions",
    description:
      "List available newspaper editions (dates) with article counts. " +
      "Useful for browsing what dates are in the archive or narrowing a date range.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        startDate: {
          type: Type.STRING,
          description: "Earliest date to include (YYYY-MM-DD)",
        },
        endDate: {
          type: Type.STRING,
          description: "Latest date to include (YYYY-MM-DD)",
        },
      },
    },
  },
];

async function executeSearchArchive(
  args: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
): Promise<Record<string, unknown>> {
  const query = args.query as string;
  const startDate = (args.startDate as string) ?? undefined;
  const endDate = (args.endDate as string) ?? undefined;
  const category = (args.category as string) ?? undefined;
  const rawLimit = (args.limit as number) ?? 10;
  const limit = Math.max(1, Math.min(rawLimit, 20));

  const embedding = await embedQuery(query, { signal: opts?.signal });
  const results = await hybridSearch(query, embedding, {
    limit,
    startDate,
    endDate,
    category,
    signal: opts?.signal,
  });

  return {
    results: results.map((r) => ({
      id: r.id,
      headline: r.headline,
      editionDate: r.editionDate,
      category: r.category,
      summary: r.summary,
      excerpt: r.bodyPlain.slice(0, 500),
      imageUrls: r.imageUrls,
    })),
  };
}

async function executeReadArticle(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const articleId = args.articleId as string;

  const rows = await getSql()`
    SELECT id, edition_date, category, headline, summary, byline,
           body_plain, image_urls
    FROM articles
    WHERE id = ${articleId}
  `;

  if (rows.length === 0) {
    return { error: "Article not found" };
  }

  const r = rows[0];
  return {
    id: r.id,
    editionDate: r.edition_date,
    category: r.category,
    headline: r.headline,
    summary: r.summary,
    byline: r.byline ?? null,
    bodyPlain: r.body_plain,
    imageUrls: r.image_urls ?? [],
  };
}

async function executeListEditions(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const startDate = (args.startDate as string) ?? undefined;
  const endDate = (args.endDate as string) ?? undefined;

  const { editions } = await queryEditions({
    startDate,
    endDate,
    limit: 50,
  });

  return {
    editions: editions.map((e) => ({
      date: e.date,
      articleCount: e.articleCount,
    })),
  };
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
): Promise<Record<string, unknown>> {
  try {
    switch (name) {
      case "search_archive":
        return await executeSearchArchive(args, opts);
      case "read_article":
        return await executeReadArticle(args);
      case "list_editions":
        return await executeListEditions(args);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}
