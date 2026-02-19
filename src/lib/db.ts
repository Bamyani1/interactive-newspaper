import { neon } from "@neondatabase/serverless";
import type { Article, EditionInfo, VintageAd } from "@/src/types";

// Neon's serverless driver uses HTTP — no persistent connection, no pool.
// Each query is a single HTTP request, ideal for Vercel serverless functions.
const sql = neon(process.env.DATABASE_URL!);

// ─── Edition Queries ─────────────────────────────────────────────

interface QueryEditionsOptions {
  limit?: number;
  offset?: number;
  startDate?: string;
  endDate?: string;
}

export async function queryEditions(
  options: QueryEditionsOptions = {},
): Promise<{ editions: EditionInfo[]; pagination: { total: number; limit: number; offset: number; hasMore: boolean } }> {
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;
  const startDate = options.startDate ?? null;
  const endDate = options.endDate ?? null;

  const countResult = await sql`
    SELECT COUNT(*)::int as total FROM editions
    WHERE (${startDate}::text IS NULL OR date >= ${startDate})
      AND (${endDate}::text IS NULL OR date <= ${endDate})
  `;
  const total = countResult[0].total;

  const rows = await sql`
    SELECT date, publication_info, page_count, article_count
    FROM editions
    WHERE (${startDate}::text IS NULL OR date >= ${startDate})
      AND (${endDate}::text IS NULL OR date <= ${endDate})
    ORDER BY date DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const editions: EditionInfo[] = rows.map((r) => ({
    id: r.date,
    date: r.date,
    pageCount: r.page_count,
    articleCount: r.article_count,
  }));

  return {
    editions,
    pagination: { total, limit, offset, hasMore: offset + limit < total },
  };
}

export async function queryEditionByDate(date: string): Promise<{
  edition: { id: string; date: string; pageCount: number; publicationInfo: string };
  articles: Article[];
  ads: VintageAd[];
} | null> {
  const editionRows = await sql`
    SELECT date, publication_info, page_count FROM editions WHERE date = ${date}
  `;

  if (editionRows.length === 0) return null;
  const ed = editionRows[0];

  const [articleRows, adRows] = await sql.transaction([
    sql`
      SELECT id, edition_date, position, category, headline, summary, full_text,
             byline, page, is_hero, is_featured, image_urls, image_caption, image_captions
      FROM articles WHERE edition_date = ${date}
      ORDER BY position
    `,
    sql`
      SELECT position, title, body, category, ad_type, display_text, phone, address, price
      FROM ads WHERE edition_date = ${date}
      ORDER BY position
    `,
  ]);

  const articles: Article[] = articleRows.map((r) => ({
    id: r.id,
    date: r.edition_date,
    category: r.category,
    headline: r.headline,
    summary: r.summary,
    fullText: r.full_text,
    imageUrls: r.image_urls ?? [],
    byline: r.byline ?? null,
    page: r.page,
    isHero: r.is_hero,
    isFeatured: r.is_featured,
    imageCaption: r.image_caption ?? null,
    imageCaptions: r.image_captions ?? [],
  }));

  const ads: VintageAd[] = adRows.map((r) => ({
    title: r.title,
    body: r.body,
    category: r.category ?? undefined,
    adType: r.ad_type ?? undefined,
    displayText: r.display_text ?? undefined,
    phone: r.phone ?? undefined,
    address: r.address ?? undefined,
    price: r.price ?? undefined,
  }));

  return {
    edition: {
      id: date,
      date,
      pageCount: ed.page_count,
      publicationInfo: ed.publication_info ?? "",
    },
    articles,
    ads,
  };
}

// ─── Search Queries ──────────────────────────────────────────────

interface SearchOptions {
  query: string;
  category?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  limit?: number;
  offset?: number;
}

export interface SearchResultRow {
  id: string;
  editionDate: string;
  category: string;
  headline: string;
  summary: string;
  byline: string | null;
  snippet: string;
  rank: number;
}

export async function searchArticles(
  options: SearchOptions,
): Promise<{ results: SearchResultRow[]; total: number }> {
  const { query, limit = 20, offset = 0 } = options;
  const category = options.category ?? null;
  const startDate = options.startDate ?? null;
  const endDate = options.endDate ?? null;

  const countResult = await sql`
    SELECT COUNT(*)::int as total
    FROM articles a, plainto_tsquery('english', ${query}) q
    WHERE a.search_vector @@ q
      AND (${category}::text IS NULL OR a.category = ${category})
      AND (${startDate}::text IS NULL OR a.edition_date >= ${startDate})
      AND (${endDate}::text IS NULL OR a.edition_date <= ${endDate})
  `;

  const rows = await sql`
    SELECT a.id, a.edition_date, a.category, a.headline, a.summary, a.byline,
      ts_headline('english', a.body_plain, q,
        'StartSel=<mark>, StopSel=</mark>, MaxFragments=3, MaxWords=30'
      ) as snippet,
      ts_rank(a.search_vector, q) as rank
    FROM articles a, plainto_tsquery('english', ${query}) q
    WHERE a.search_vector @@ q
      AND (${category}::text IS NULL OR a.category = ${category})
      AND (${startDate}::text IS NULL OR a.edition_date >= ${startDate})
      AND (${endDate}::text IS NULL OR a.edition_date <= ${endDate})
    ORDER BY rank DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  return {
    results: rows.map((r) => ({
      id: r.id,
      editionDate: r.edition_date,
      category: r.category,
      headline: r.headline,
      summary: r.summary,
      byline: r.byline ?? null,
      snippet: r.snippet,
      rank: parseFloat(r.rank),
    })),
    total: countResult[0].total,
  };
}

// ─── Browse Queries (cross-edition) ──────────────────────────────

interface BrowseOptions {
  category?: string | null;
  author?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  limit?: number;
  offset?: number;
}

export async function browseArticles(options: BrowseOptions = {}): Promise<{
  articles: (Article & { editionDate: string })[];
  total: number;
}> {
  const { limit = 20, offset = 0 } = options;
  const category = options.category ?? null;
  const author = options.author ?? null;
  const startDate = options.startDate ?? null;
  const endDate = options.endDate ?? null;

  const countResult = await sql`
    SELECT COUNT(*)::int as total
    FROM articles
    WHERE (${category}::text IS NULL OR category = ${category})
      AND (${author}::text IS NULL OR byline ILIKE '%' || ${author} || '%')
      AND (${startDate}::text IS NULL OR edition_date >= ${startDate})
      AND (${endDate}::text IS NULL OR edition_date <= ${endDate})
  `;

  const rows = await sql`
    SELECT id, edition_date, position, category, headline, summary, full_text,
           byline, page, is_hero, is_featured, image_urls, image_caption, image_captions
    FROM articles
    WHERE (${category}::text IS NULL OR category = ${category})
      AND (${author}::text IS NULL OR byline ILIKE '%' || ${author} || '%')
      AND (${startDate}::text IS NULL OR edition_date >= ${startDate})
      AND (${endDate}::text IS NULL OR edition_date <= ${endDate})
    ORDER BY edition_date DESC, position
    LIMIT ${limit} OFFSET ${offset}
  `;

  const articles = rows.map((r) => ({
    id: r.id,
    date: r.edition_date,
    editionDate: r.edition_date,
    category: r.category as Article["category"],
    headline: r.headline,
    summary: r.summary,
    fullText: r.full_text,
    imageUrls: r.image_urls ?? [],
    byline: r.byline ?? null,
    page: r.page,
    isHero: r.is_hero,
    isFeatured: r.is_featured,
    imageCaption: r.image_caption ?? null,
    imageCaptions: r.image_captions ?? [],
  }));

  return { articles, total: countResult[0].total };
}

// ─── Weather Queries ─────────────────────────────────────────────

export interface WeatherRow {
  date: string;
  scope: string;
  tmax_c: number | null;
  tmin_c: number | null;
  precip_mm: number | null;
  source: string;
  source_station_id: string | null;
  quality_flag: string | null;
  is_estimated: boolean;
}

export async function queryWeatherByDate(
  date: string,
  scope = "delaware",
): Promise<WeatherRow | null> {
  const rows = await sql`
    SELECT * FROM weather WHERE date = ${date} AND scope = ${scope}
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    date: r.date,
    scope: r.scope,
    tmax_c: r.tmax_c,
    tmin_c: r.tmin_c,
    precip_mm: r.precip_mm,
    source: r.source,
    source_station_id: r.source_station_id,
    quality_flag: r.quality_flag,
    is_estimated: r.is_estimated,
  };
}

// ─── Music Queries ───────────────────────────────────────────────

export interface MusicRow {
  year: number;
  month: string;
  rank: number;
  title: string;
  artist: string;
  youtubeId: string;
}

export async function queryMusicByMonth(
  year: number,
  month: string,
): Promise<MusicRow[]> {
  const rows = await sql`
    SELECT year, month, rank, title, artist, youtube_id
    FROM music WHERE year = ${year} AND month = ${month}
    ORDER BY rank
  `;
  return rows.map((r) => ({
    year: r.year,
    month: r.month,
    rank: r.rank,
    title: r.title,
    artist: r.artist,
    youtubeId: r.youtube_id,
  }));
}

// ─── Vector / RAG Queries ────────────────────────────────────────

export interface RetrievedArticle {
  id: string;
  editionDate: string;
  category: string;
  headline: string;
  summary: string;
  byline: string | null;
  bodyPlain: string;
  distance: number;
  source: "vector" | "fts";
}

interface VectorSearchOptions {
  limit?: number;
  category?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

/**
 * Retrieve articles by cosine similarity to a query embedding vector.
 * Uses the HNSW index for fast approximate nearest-neighbor search.
 */
export async function queryArticlesByEmbedding(
  embeddingVec: number[],
  options: VectorSearchOptions = {},
): Promise<RetrievedArticle[]> {
  const limit = options.limit ?? 10;
  const category = options.category ?? null;
  const startDate = options.startDate ?? null;
  const endDate = options.endDate ?? null;
  const vecStr = `[${embeddingVec.join(",")}]`;

  const rows = await sql`
    SELECT
      a.id, a.edition_date, a.category, a.headline, a.summary,
      a.byline, a.body_plain,
      (a.embedding <=> ${vecStr}::vector) as distance
    FROM articles a
    WHERE a.embedding IS NOT NULL
      AND (${category}::text IS NULL OR a.category = ${category})
      AND (${startDate}::text IS NULL OR a.edition_date >= ${startDate})
      AND (${endDate}::text IS NULL OR a.edition_date <= ${endDate})
    ORDER BY a.embedding <=> ${vecStr}::vector
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    id: r.id,
    editionDate: r.edition_date,
    category: r.category,
    headline: r.headline,
    summary: r.summary,
    byline: r.byline ?? null,
    bodyPlain: r.body_plain,
    distance: parseFloat(r.distance),
    source: "vector" as const,
  }));
}

/**
 * Hybrid search: combine vector similarity + full-text search using
 * Reciprocal Rank Fusion (RRF). Returns the top-K most relevant articles
 * by merging both ranking signals.
 */
export async function hybridSearch(
  question: string,
  embeddingVec: number[],
  options: { limit?: number; vectorWeight?: number; category?: string | null; startDate?: string | null; endDate?: string | null } = {},
): Promise<RetrievedArticle[]> {
  const limit = options.limit ?? 8;
  const vectorWeight = options.vectorWeight ?? 0.7;
  const ftsWeight = 1 - vectorWeight;
  const fetchK = Math.min(3 * limit, 100); // fetch from each source before fusion

  // Run vector search and FTS search in parallel
  const [vectorResults, ftsResults] = await Promise.all([
    queryArticlesByEmbedding(embeddingVec, {
      limit: fetchK,
      category: options.category,
      startDate: options.startDate,
      endDate: options.endDate,
    }),
    searchArticlesForRag(question, {
      limit: fetchK,
      category: options.category ?? undefined,
      startDate: options.startDate ?? undefined,
      endDate: options.endDate ?? undefined,
    }),
  ]);

  // Reciprocal Rank Fusion (RRF): score = sum(weight / (k + rank))
  const RRF_K = 60; // standard RRF constant
  const scoreMap = new Map<string, { score: number; article: RetrievedArticle }>();

  // Score vector results
  for (let i = 0; i < vectorResults.length; i++) {
    const article = vectorResults[i];
    const rrfScore = vectorWeight / (RRF_K + i);
    scoreMap.set(article.id, { score: rrfScore, article });
  }

  // Score FTS results and merge
  for (let i = 0; i < ftsResults.length; i++) {
    const article = ftsResults[i];
    const rrfScore = ftsWeight / (RRF_K + i);
    const existing = scoreMap.get(article.id);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scoreMap.set(article.id, { score: rrfScore, article });
    }
  }

  // Sort by fused score (descending) and return top-K
  return Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.article);
}

/**
 * Internal FTS search that returns RetrievedArticle (includes body_plain).
 * Used by hybridSearch for rank fusion — not exported.
 */
async function searchArticlesForRag(
  query: string,
  options: { limit?: number; category?: string; startDate?: string; endDate?: string } = {},
): Promise<RetrievedArticle[]> {
  const limit = options.limit ?? 20;
  const category = options.category ?? null;
  const startDate = options.startDate ?? null;
  const endDate = options.endDate ?? null;

  const rows = await sql`
    SELECT a.id, a.edition_date, a.category, a.headline, a.summary,
           a.byline, a.body_plain,
           ts_rank(a.search_vector, q) as rank
    FROM articles a, plainto_tsquery('english', ${query}) q
    WHERE a.search_vector @@ q
      AND (${category}::text IS NULL OR a.category = ${category})
      AND (${startDate}::text IS NULL OR a.edition_date >= ${startDate})
      AND (${endDate}::text IS NULL OR a.edition_date <= ${endDate})
    ORDER BY rank DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    id: r.id,
    editionDate: r.edition_date,
    category: r.category,
    headline: r.headline,
    summary: r.summary,
    byline: r.byline ?? null,
    bodyPlain: r.body_plain,
    distance: 0, // FTS doesn't produce cosine distance
    source: "fts" as const,
  }));
}
