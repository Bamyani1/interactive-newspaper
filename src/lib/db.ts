import { neon } from "@neondatabase/serverless";
import type { Article, EditionInfo, VintageAd } from "@/src/types";

// Neon's serverless driver uses HTTP — no persistent connection, no pool.
// Each query is a single HTTP request, ideal for Vercel serverless functions.
const sql = neon(process.env.DATABASE_URL!);

const HYBRID_SEARCH_TIMEOUT_MS = 8_000;

// ── hybridSearch LRU cache ──
// Short-TTL cache for full hybrid-search results so repeated identical
// questions within the same function instance skip the double SQL round
// trip + RRF merge. Mirrors the shape of embeddings.ts's query cache.
const HYBRID_CACHE_TTL_MS = 5 * 60 * 1000;
const HYBRID_CACHE_MAX_SIZE = 50;

interface HybridCacheEntry {
    results: RetrievedArticle[];
    ts: number;
}

const hybridCache = new Map<string, HybridCacheEntry>();

function hybridCacheKey(
    question: string,
    options: {
        limit?: number;
        vectorWeight?: number;
        category?: string | null;
        startDate?: string | null;
        endDate?: string | null;
        onlyWithImages?: boolean;
    },
): string {
    return JSON.stringify({
        q: question,
        l: options.limit ?? 8,
        v: options.vectorWeight ?? 0.7,
        c: options.category ?? null,
        s: options.startDate ?? null,
        e: options.endDate ?? null,
        oi: options.onlyWithImages ?? false,
    });
}

function getCachedHybridSearch(key: string): RetrievedArticle[] | null {
    const entry = hybridCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > HYBRID_CACHE_TTL_MS) {
        hybridCache.delete(key);
        return null;
    }
    // Promote to most-recently-used
    hybridCache.delete(key);
    hybridCache.set(key, entry);
    return entry.results;
}

function setCachedHybridSearch(key: string, results: RetrievedArticle[]): void {
    if (hybridCache.size >= HYBRID_CACHE_MAX_SIZE) {
        const oldest = hybridCache.keys().next().value;
        if (oldest !== undefined) hybridCache.delete(oldest);
    }
    hybridCache.set(key, { results, ts: Date.now() });
}

// Test hook: clears the module-level cache between tests so prior runs
// don't leak into new ones.
export function _clearHybridSearchCacheForTests(): void {
    hybridCache.clear();
}

/**
 * Thrown by db.ts when a database operation exceeds its timeout budget.
 * Callers can check `err instanceof DbTimeoutError` to return a 504 instead
 * of an opaque 500. The orphaned underlying request may still keep running
 * on Neon's side because @neondatabase/serverless doesn't accept an
 * AbortSignal — this wrapper protects the caller, not the server.
 */
export class DbTimeoutError extends Error {
    constructor(
        public readonly op: string,
        public readonly timeoutMs: number,
    ) {
        super(`Database operation timed out: ${op} after ${timeoutMs}ms`);
        this.name = "DbTimeoutError";
    }
}

function raceWithTimeout<T>(
    op: string,
    promise: Promise<T>,
    timeoutMs: number,
): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
            () => reject(new DbTimeoutError(op, timeoutMs)),
            timeoutMs,
        );
    });
    return Promise.race([
        promise.finally(() => {
            if (timer) clearTimeout(timer);
        }),
        timeoutPromise,
    ]);
}

// ─── Edition Queries ─────────────────────────────────────────────

interface QueryEditionsOptions {
  limit?: number;
  offset?: number;
  startDate?: string;
  endDate?: string;
}

export async function queryEditions(
  options: QueryEditionsOptions = {},
): Promise<{
  editions: EditionInfo[];
  pagination: { total: number; limit: number; offset: number; hasMore: boolean };
}> {
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;
  const startDate = options.startDate ?? null;
  const endDate = options.endDate ?? null;

  // The internal layout helper (src/lib/editions-server.ts) calls this with a
  // large limit and ignores `pagination` — so the COUNT query is only relevant
  // when /api/editions is hit by an external/paginating consumer. Keeping it
  // here gives those consumers a correct `total` and `hasMore`.
  const [countResult, rows] = await sql.transaction([
    sql`
      SELECT COUNT(*)::int as total FROM editions
      WHERE (${startDate}::text IS NULL OR date >= ${startDate})
        AND (${endDate}::text IS NULL OR date <= ${endDate})
    `,
    sql`
      SELECT date, publication_info, page_count, article_count
      FROM editions
      WHERE (${startDate}::text IS NULL OR date >= ${startDate})
        AND (${endDate}::text IS NULL OR date <= ${endDate})
      ORDER BY date DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
  ]);
  const total = countResult[0].total;

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
             byline, writer_position, page, is_hero, is_featured, image_urls, image_caption, image_captions
      FROM articles WHERE edition_date = ${date}
      ORDER BY position
    `,
    sql`
      SELECT position, title, body, category, ad_type, display_text, phone, address, price, image_urls
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
    writerPosition: r.writer_position ?? null,
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
    imageUrls: r.image_urls?.length ? r.image_urls : undefined,
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

interface SearchResultRow {
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
    FROM articles a, websearch_to_tsquery('english', ${query}) q
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
    FROM articles a, websearch_to_tsquery('english', ${query}) q
    WHERE a.search_vector @@ q
      AND (${category}::text IS NULL OR a.category = ${category})
      AND (${startDate}::text IS NULL OR a.edition_date >= ${startDate})
      AND (${endDate}::text IS NULL OR a.edition_date <= ${endDate})
    ORDER BY rank DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  return {
    results: rows.map((r) => {
      // Guard against NaN from parseFloat(null) or malformed rank values.
      // FTS rank is a ts_rank float; if something weird comes back from the
      // DB we'd rather serve 0 than let NaN corrupt downstream sort/compare.
      // See docs/issues/0006.
      const rankValue = parseFloat(r.rank);
      return {
        id: r.id,
        editionDate: r.edition_date,
        category: r.category,
        headline: r.headline,
        summary: r.summary,
        byline: r.byline ?? null,
        snippet: r.snippet,
        rank: Number.isFinite(rankValue) ? rankValue : 0,
      };
    }),
    total: countResult[0].total,
  };
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
  distance: number | null;
  source: "vector" | "fts" | "both";
  imageUrls: string[];
}

interface VectorSearchOptions {
  limit?: number;
  category?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  onlyWithImages?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Retrieve articles by cosine similarity to a query embedding vector.
 * Uses the HNSW index for fast approximate nearest-neighbor search.
 * Sets ef_search=100 (vs default 40) for better recall on our small corpus.
 */
export async function queryArticlesByEmbedding(
  embeddingVec: number[],
  options: VectorSearchOptions = {},
): Promise<RetrievedArticle[]> {
  const limit = options.limit ?? 10;
  const category = options.category ?? null;
  const startDate = options.startDate ?? null;
  const endDate = options.endDate ?? null;
  const onlyWithImages = options.onlyWithImages ?? false;
  const timeoutMs = options.timeoutMs ?? HYBRID_SEARCH_TIMEOUT_MS;
  const vecStr = `[${embeddingVec.join(",")}]`;

  // Mirror hybridSearch's early-exit so the /api/ask fallback path
  // doesn't orphan a DB call when the global deadline has already fired.
  if (options.signal?.aborted) {
    throw new DbTimeoutError("queryArticlesByEmbedding", timeoutMs);
  }

  const [, rows] = await raceWithTimeout(
    "queryArticlesByEmbedding",
    sql.transaction([
      sql`SET LOCAL hnsw.ef_search = 100`,
      sql`
        SELECT
          a.id, a.edition_date, a.category, a.headline, a.summary,
          a.byline, a.body_plain, a.image_urls,
          (a.embedding <=> ${vecStr}::vector) as distance
        FROM articles a
        WHERE a.embedding IS NOT NULL
          AND (${category}::text IS NULL OR a.category = ${category})
          AND (${startDate}::text IS NULL OR a.edition_date >= ${startDate})
          AND (${endDate}::text IS NULL OR a.edition_date <= ${endDate})
          AND (${onlyWithImages}::boolean = false OR (a.image_urls IS NOT NULL AND jsonb_array_length(a.image_urls) > 0))
        ORDER BY a.embedding <=> ${vecStr}::vector
        LIMIT ${limit}
      `,
    ]),
    timeoutMs,
  );

  return rows.map((r) => {
    // Guard against NaN from parseFloat(null/undefined/malformed).
    // Downstream confidence math (answer-generator.ts:109-112) already
    // filters out null distance; a NaN would silently corrupt the sum.
    // See docs/issues/0006.
    const distValue = parseFloat(r.distance);
    return {
      id: r.id,
      editionDate: r.edition_date,
      category: r.category,
      headline: r.headline,
      summary: r.summary,
      byline: r.byline ?? null,
      bodyPlain: r.body_plain,
      distance: Number.isFinite(distValue) ? distValue : null,
      source: "vector" as const,
      imageUrls: r.image_urls ?? [],
    };
  });
}

/**
 * Hybrid search: combine vector similarity + full-text search using
 * Reciprocal Rank Fusion (RRF). Returns the top-K most relevant articles
 * by merging both ranking signals.
 */
export async function hybridSearch(
  question: string,
  embeddingVec: number[],
  options: {
    limit?: number;
    vectorWeight?: number;
    category?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    onlyWithImages?: boolean;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<RetrievedArticle[]> {
  const limit = options.limit ?? 8;
  const vectorWeight = options.vectorWeight ?? 0.7;
  const ftsWeight = 1 - vectorWeight;
  const fetchK = Math.min(3 * limit, 100); // fetch from each source before fusion
  const timeoutMs = options.timeoutMs ?? HYBRID_SEARCH_TIMEOUT_MS;

  // If the outer deadline has already fired, short-circuit.
  if (options.signal?.aborted) {
    throw new DbTimeoutError("hybridSearch", timeoutMs);
  }

  // Cache check: identical (question, filters, limit, weights) hits skip
  // the full double-SQL + RRF round trip. Keyed on the question string
  // (not the embedding) since embedQuery's cache ensures the same
  // question produces the same vector.
  const cacheKey = hybridCacheKey(question, options);
  const cached = getCachedHybridSearch(cacheKey);
  if (cached) return cached;

  // Run vector search and FTS search in parallel, wrapped in a single
  // timeout budget. A hung Neon call would otherwise block /api/ask
  // indefinitely because @neondatabase/serverless has no AbortSignal
  // support. See docs/issues/0005.
  const [vectorResults, ftsResults] = await raceWithTimeout(
    "hybridSearch",
    Promise.all([
      queryArticlesByEmbedding(embeddingVec, {
        limit: fetchK,
        category: options.category,
        startDate: options.startDate,
        endDate: options.endDate,
        onlyWithImages: options.onlyWithImages,
      }),
      searchArticlesForRag(question, {
        limit: fetchK,
        category: options.category ?? undefined,
        startDate: options.startDate ?? undefined,
        endDate: options.endDate ?? undefined,
        onlyWithImages: options.onlyWithImages,
      }),
    ]),
    timeoutMs,
  );

  // Reciprocal Rank Fusion (RRF): score = sum(weight / (k + rank))
  // K=40 (vs standard 60) gives better rank differentiation for our small corpus
  const RRF_K = 40;
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
      existing.article = { ...existing.article, source: "both" };
    } else {
      scoreMap.set(article.id, { score: rrfScore, article });
    }
  }

  // Sort by fused score (descending) and return top-K
  const fused = Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.article);

  setCachedHybridSearch(cacheKey, fused);
  return fused;
}

/**
 * Internal FTS search that returns RetrievedArticle (includes body_plain).
 * Used by hybridSearch for rank fusion — not exported.
 */
async function searchArticlesForRag(
  query: string,
  options: { limit?: number; category?: string; startDate?: string; endDate?: string; onlyWithImages?: boolean } = {},
): Promise<RetrievedArticle[]> {
  const limit = options.limit ?? 20;
  const category = options.category ?? null;
  const startDate = options.startDate ?? null;
  const endDate = options.endDate ?? null;
  const onlyWithImages = options.onlyWithImages ?? false;

  const rows = await sql`
    SELECT a.id, a.edition_date, a.category, a.headline, a.summary,
           a.byline, a.body_plain, a.image_urls,
           ts_rank(a.search_vector, q) as rank
    FROM articles a, websearch_to_tsquery('english', ${query}) q
    WHERE a.search_vector @@ q
      AND (${category}::text IS NULL OR a.category = ${category})
      AND (${startDate}::text IS NULL OR a.edition_date >= ${startDate})
      AND (${endDate}::text IS NULL OR a.edition_date <= ${endDate})
      AND (${onlyWithImages}::boolean = false OR (a.image_urls IS NOT NULL AND jsonb_array_length(a.image_urls) > 0))
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
    distance: null, // FTS doesn't produce cosine distance
    source: "fts" as const,
    imageUrls: r.image_urls ?? [],
  }));
}
