import { neon } from "@neondatabase/serverless";
import type { Article, EditionInfo, VintageAd } from "@/src/types";
import { createHash } from "crypto";
import {
  RAG_EMBEDDING_MODEL,
  RAG_PIPELINE_VERSION,
} from "@/src/lib/rag-model-config";
import {
  EMBEDDING_INPUT_VERSION,
  IMAGE_EMBEDDING_INPUT_VERSION,
} from "@/src/lib/embeddings";
import {
  getRagRetrievalConfig,
  shouldServeVersionedRetrieval,
} from "@/src/lib/rag-index-config";

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
    embeddingVec: number[],
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
        fts: question,
        semantic: createHash("sha256")
          .update(Buffer.from(new Float32Array(embeddingVec).buffer))
          .digest("base64url"),
        pipeline: RAG_PIPELINE_VERSION,
        corpus: process.env.RAG_CORPUS_VERSION ?? "default",
        index: getRagRetrievalConfig().cacheIdentity,
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
 * Neon HTTP requests receive the same AbortSignal, so a timeout cancels the
 * underlying fetch instead of leaving an orphaned database request running.
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

async function runWithDbTimeout<T>(
    op: string,
    operation: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
    outerSignal?: AbortSignal,
): Promise<T> {
    const controller = new AbortController();
    const signal = outerSignal
      ? AbortSignal.any([outerSignal, controller.signal])
      : controller.signal;
    let rejectOnAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      rejectOnAbort = () => reject(new DbTimeoutError(op, timeoutMs));
      signal.addEventListener("abort", rejectOnAbort, { once: true });
    });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      if (signal.aborted) throw new DbTimeoutError(op, timeoutMs);
      // Neon receives the signal and normally rejects its fetch itself. The
      // race is still required so a driver regression or test double that
      // ignores AbortSignal can never pin a request past its deadline.
      return await Promise.race([operation(signal), aborted]);
    } catch (error) {
      if (signal.aborted) throw new DbTimeoutError(op, timeoutMs);
      throw error;
    } finally {
      clearTimeout(timer);
      if (rejectOnAbort) signal.removeEventListener("abort", rejectOnAbort);
    }
}

const RAG_SCHEMA_PROBE_TTL_MS = 30_000;
let ragV2TablesAvailable: { value: boolean; checkedAt: number } | null = null;

async function hasRagV2Tables(signal: AbortSignal): Promise<boolean> {
  if (
    ragV2TablesAvailable !== null &&
    Date.now() - ragV2TablesAvailable.checkedAt < RAG_SCHEMA_PROBE_TTL_MS
  ) {
    return ragV2TablesAvailable.value;
  }
  const rows = await sql.query(
    "SELECT to_regclass('public.article_chunks') IS NOT NULL AS chunks, to_regclass('public.article_images') IS NOT NULL AS images",
    [],
    { fetchOptions: { signal } },
  );
  const value = Boolean(rows[0]?.chunks && rows[0]?.images);
  ragV2TablesAvailable = { value, checkedAt: Date.now() };
  return value;
}

export function _setRagV2TablesAvailableForTests(value: boolean | null): void {
  ragV2TablesAvailable = value === null
    ? null
    : { value, checkedAt: Date.now() };
}

// ─── Edition Queries ─────────────────────────────────────────────

interface QueryEditionsOptions {
  limit?: number;
  offset?: number;
  startDate?: string;
  endDate?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
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
  const [countResult, rows] = await runWithDbTimeout(
    "queryEditions",
    (signal) => sql.transaction([
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
    ], { readOnly: true, fetchOptions: { signal } }),
    options.timeoutMs ?? HYBRID_SEARCH_TIMEOUT_MS,
    options.signal,
  );
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
  imageCaptions: (string | null)[];
  /** Retrieval-local evidence, populated by chunk/image indexes when available. */
  matchedPassages?: string[];
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

interface RagResultRow {
  id?: string;
  edition_date?: string;
  category?: string;
  headline?: string;
  summary?: string;
  byline?: string | null;
  body_plain?: string;
  image_urls?: string[] | null;
  image_captions?: (string | null)[] | null;
  distance?: string | number | null;
  chunk_text?: string | null;
  matched_caption?: string | null;
  matched_image_url?: string | null;
}

function retrievedFromRow(
  row: RagResultRow,
  source: "vector" | "fts",
): RetrievedArticle {
  const distanceValue = Number.parseFloat(String(row.distance ?? ""));
  let imageUrls: string[] = Array.isArray(row.image_urls) ? row.image_urls : [];
  let imageCaptions: (string | null)[] = Array.isArray(row.image_captions)
    ? row.image_captions
    : [];
  if (row.matched_image_url && imageUrls.includes(row.matched_image_url)) {
    const matchedIndex = imageUrls.indexOf(row.matched_image_url);
    imageUrls = [imageUrls[matchedIndex], ...imageUrls.filter((_, i) => i !== matchedIndex)];
    imageCaptions = [
      imageCaptions[matchedIndex] ?? row.matched_caption ?? null,
      ...imageCaptions.filter((_, i) => i !== matchedIndex),
    ];
  }
  const passage = cleanEvidencePassage(row.chunk_text ?? row.matched_caption);
  return {
    id: row.id ?? "",
    editionDate: row.edition_date ?? "",
    category: row.category ?? "",
    headline: row.headline ?? "",
    summary: row.summary ?? "",
    byline: row.byline ?? null,
    bodyPlain: row.body_plain ?? "",
    distance: Number.isFinite(distanceValue) ? distanceValue : null,
    source,
    imageUrls,
    imageCaptions,
    matchedPassages: passage ? [passage] : [],
  };
}

function cleanEvidencePassage(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.replace(/<\/?b>/gi, "").replace(/\s+/g, " ").trim();
}

function aggregateEvidenceRows(
  rows: RagResultRow[],
  source: "vector" | "fts",
  limit: number,
): RetrievedArticle[] {
  const results = new Map<string, RetrievedArticle>();
  for (const row of rows) {
    if (!row.id) continue;
    const existing = results.get(row.id);
    const passage = cleanEvidencePassage(row.chunk_text ?? row.matched_caption);
    if (existing) {
      if (
        passage &&
        !existing.matchedPassages?.includes(passage)
      ) {
        existing.matchedPassages = [...(existing.matchedPassages ?? []), passage];
      }
      continue;
    }
    if (results.size >= limit) continue;
    results.set(row.id, retrievedFromRow(row, source));
  }
  return [...results.values()];
}

async function queryRagV2ByEmbedding(
  embeddingVec: number[],
  options: VectorSearchOptions,
): Promise<RetrievedArticle[]> {
  const limit = options.limit ?? 10;
  const category = options.category ?? null;
  const startDate = options.startDate ?? null;
  const endDate = options.endDate ?? null;
  const onlyWithImages = options.onlyWithImages ?? false;
  const timeoutMs = options.timeoutMs ?? HYBRID_SEARCH_TIMEOUT_MS;
  const vecStr = `[${embeddingVec.join(",")}]`;
  const evidenceLimit = Math.min(Math.max(limit * 5, 40), 150);

  return runWithDbTimeout(
    "queryArticlesByEmbedding.v2",
    async (signal) => {
      if (onlyWithImages) {
        const [, , rows] = await sql.transaction([
          sql`SET LOCAL hnsw.ef_search = 100`,
          sql`SET LOCAL hnsw.iterative_scan = 'relaxed_order'`,
          sql`
            SELECT a.id, a.edition_date, a.category, a.headline, a.summary,
                   a.byline, a.body_plain, a.image_urls, a.image_captions,
                   i.image_url AS matched_image_url, i.caption AS matched_caption,
                   (i.embedding <=> ${vecStr}::vector) AS distance
            FROM article_images i JOIN articles a ON a.id = i.article_id
            WHERE i.embedding IS NOT NULL
              AND i.embedding_model = ${RAG_EMBEDDING_MODEL}
              AND i.embedding_input_version = ${IMAGE_EMBEDDING_INPUT_VERSION}
              AND (${category}::text IS NULL OR a.category = ${category})
              AND (${startDate}::text IS NULL OR a.edition_date >= ${startDate})
              AND (${endDate}::text IS NULL OR a.edition_date <= ${endDate})
            ORDER BY i.embedding <=> ${vecStr}::vector
            LIMIT ${evidenceLimit}
          `,
        ], { readOnly: true, fetchOptions: { signal } });
        return aggregateEvidenceRows(rows, "vector", limit);
      }

      const [, , rows] = await sql.transaction([
        sql`SET LOCAL hnsw.ef_search = 100`,
        sql`SET LOCAL hnsw.iterative_scan = 'relaxed_order'`,
        sql`
          SELECT a.id, a.edition_date, a.category, a.headline, a.summary,
                 a.byline, a.body_plain, a.image_urls, a.image_captions,
                 c.chunk_text, (c.embedding <=> ${vecStr}::vector) AS distance
          FROM article_chunks c JOIN articles a ON a.id = c.article_id
          WHERE c.embedding IS NOT NULL
            AND c.embedding_model = ${RAG_EMBEDDING_MODEL}
            AND c.embedding_input_version = ${EMBEDDING_INPUT_VERSION}
            AND (${category}::text IS NULL OR a.category = ${category})
            AND (${startDate}::text IS NULL OR a.edition_date >= ${startDate})
            AND (${endDate}::text IS NULL OR a.edition_date <= ${endDate})
          ORDER BY c.embedding <=> ${vecStr}::vector
          LIMIT ${evidenceLimit}
        `,
      ], { readOnly: true, fetchOptions: { signal } });
      return aggregateEvidenceRows(rows, "vector", limit);
    },
    timeoutMs,
    options.signal,
  );
}

async function queryLegacyArticlesByEmbedding(
  embeddingVec: number[],
  options: VectorSearchOptions,
): Promise<RetrievedArticle[]> {
  const limit = options.limit ?? 10;
  const category = options.category ?? null;
  const startDate = options.startDate ?? null;
  const endDate = options.endDate ?? null;
  const onlyWithImages = options.onlyWithImages ?? false;
  const timeoutMs = options.timeoutMs ?? HYBRID_SEARCH_TIMEOUT_MS;
  const vecStr = `[${embeddingVec.join(",")}]`;
  return runWithDbTimeout(
    "queryArticlesByEmbedding.legacy",
    async (signal) => {
      const [, rows] = await sql.transaction([
        sql`SET LOCAL hnsw.ef_search = 100`,
        sql`
          SELECT a.id, a.edition_date, a.category, a.headline, a.summary,
                 a.byline, a.body_plain, a.image_urls, a.image_captions,
                 (a.embedding <=> ${vecStr}::vector) AS distance
          FROM articles a
          WHERE a.embedding IS NOT NULL
            AND a.embedding_model = ${RAG_EMBEDDING_MODEL}
            AND (${category}::text IS NULL OR a.category = ${category})
            AND (${startDate}::text IS NULL OR a.edition_date >= ${startDate})
            AND (${endDate}::text IS NULL OR a.edition_date <= ${endDate})
            AND (${onlyWithImages}::boolean = false OR jsonb_array_length(a.image_urls) > 0)
          ORDER BY a.embedding <=> ${vecStr}::vector
          LIMIT ${limit}
        `,
      ], { readOnly: true, fetchOptions: { signal } });
      return rows.map((row) => retrievedFromRow(row, "vector"));
    },
    timeoutMs,
    options.signal,
  );
}

/** Retrieve articles using chunk vectors, or the legacy article index pre-migration. */
export async function queryArticlesByEmbedding(
  embeddingVec: number[],
  options: VectorSearchOptions = {},
): Promise<RetrievedArticle[]> {
  const timeoutMs = options.timeoutMs ?? HYBRID_SEARCH_TIMEOUT_MS;
  if (options.signal?.aborted) {
    throw new DbTimeoutError("queryArticlesByEmbedding", timeoutMs);
  }
  if (!shouldServeVersionedRetrieval()) {
    return queryLegacyArticlesByEmbedding(embeddingVec, options);
  }
  const v2 = await runWithDbTimeout(
    "detectRagV2Tables",
    (signal) => hasRagV2Tables(signal),
    timeoutMs,
    options.signal,
  );
  if (!v2) {
    throw new Error(
      "Versioned RAG retrieval was selected, but its required tables are unavailable.",
    );
  }
  return queryRagV2ByEmbedding(embeddingVec, options);
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

  // The key includes both the lexical query and a digest of the semantic
  // vector. A CRAG retry can therefore never receive an earlier result just
  // because its FTS string happens to collide.
  const cacheKey = hybridCacheKey(question, embeddingVec, options);
  const cached = getCachedHybridSearch(cacheKey);
  if (cached) return cached;

  // Each Neon HTTP fetch receives the outer signal and its own bounded
  // timeout, so a timed-out branch is actually cancelled.
  const [vectorResults, ftsResults] = await Promise.all(
    [
      queryArticlesByEmbedding(embeddingVec, {
        limit: fetchK,
        category: options.category,
        startDate: options.startDate,
        endDate: options.endDate,
        onlyWithImages: options.onlyWithImages,
        timeoutMs,
        signal: options.signal,
      }),
      searchArticlesForRag(question, {
        limit: fetchK,
        category: options.category ?? undefined,
        startDate: options.startDate ?? undefined,
        endDate: options.endDate ?? undefined,
        onlyWithImages: options.onlyWithImages,
        timeoutMs,
        signal: options.signal,
      }),
    ],
  );

  // Reciprocal Rank Fusion (RRF): score = sum(weight / (k + rank))
  // Standard RRF uses 1-indexed rank, so rank 1 scores weight/(k+1).
  // K=40 (vs standard 60) gives better rank differentiation for our small corpus.
  const RRF_K = 40;
  const scoreMap = new Map<string, { score: number; article: RetrievedArticle }>();

  // Score vector results (i+1 → 1-indexed rank)
  for (let i = 0; i < vectorResults.length; i++) {
    const article = vectorResults[i];
    const rrfScore = vectorWeight / (RRF_K + i + 1);
    scoreMap.set(article.id, { score: rrfScore, article });
  }

  // Score FTS results and merge (i+1 → 1-indexed rank)
  for (let i = 0; i < ftsResults.length; i++) {
    const article = ftsResults[i];
    const rrfScore = ftsWeight / (RRF_K + i + 1);
    const existing = scoreMap.get(article.id);
    if (existing) {
      existing.score += rrfScore;
      const passages = [
        ...(existing.article.matchedPassages ?? []),
        ...(article.matchedPassages ?? []),
      ].filter((passage, index, all) => all.indexOf(passage) === index);
      existing.article = {
        ...existing.article,
        source: "both",
        matchedPassages: passages,
      };
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
  options: {
    limit?: number;
    category?: string;
    startDate?: string;
    endDate?: string;
    onlyWithImages?: boolean;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<RetrievedArticle[]> {
  const limit = options.limit ?? 20;
  const category = options.category ?? null;
  const startDate = options.startDate ?? null;
  const endDate = options.endDate ?? null;
  const onlyWithImages = options.onlyWithImages ?? false;
  const timeoutMs = options.timeoutMs ?? HYBRID_SEARCH_TIMEOUT_MS;

  return runWithDbTimeout(
    "searchArticlesForRag",
    async (signal) => {
      if (shouldServeVersionedRetrieval()) {
        if (!(await hasRagV2Tables(signal))) {
          throw new Error(
            "Versioned RAG retrieval was selected, but its required tables are unavailable.",
          );
        }
        const evidenceLimit = Math.min(Math.max(limit * 5, 40), 150);
        const [rows] = await sql.transaction([
          sql`
            SELECT a.id, a.edition_date, a.category, a.headline, a.summary,
                   a.byline, a.body_plain, a.image_urls, a.image_captions,
                   CASE
                     WHEN c.search_vector @@ q THEN c.chunk_text
                     ELSE concat_ws(' ', a.headline, a.summary)
                   END AS chunk_text,
                   GREATEST(ts_rank(c.search_vector, q), ts_rank(a.search_vector, q)) AS rank
            FROM article_chunks c
            JOIN articles a ON a.id = c.article_id,
                 websearch_to_tsquery('english', ${query}) q
            WHERE (c.search_vector @@ q OR a.search_vector @@ q)
              AND (${category}::text IS NULL OR a.category = ${category})
              AND (${startDate}::text IS NULL OR a.edition_date >= ${startDate})
              AND (${endDate}::text IS NULL OR a.edition_date <= ${endDate})
              AND (${onlyWithImages}::boolean = false OR jsonb_array_length(a.image_urls) > 0)
            ORDER BY rank DESC
            LIMIT ${evidenceLimit}
          `,
        ], { readOnly: true, fetchOptions: { signal } });
        return aggregateEvidenceRows(rows, "fts", limit);
      }

      const [rows] = await sql.transaction([
        sql`
          SELECT a.id, a.edition_date, a.category, a.headline, a.summary,
                 a.byline, a.body_plain, a.image_urls, a.image_captions,
                 ts_headline(
                   'english', a.body_plain, q,
                   'MaxFragments=3, MinWords=20, MaxWords=70'
                 ) AS chunk_text,
                 ts_rank(a.search_vector, q) AS rank
          FROM articles a, websearch_to_tsquery('english', ${query}) q
          WHERE a.search_vector @@ q
            AND (${category}::text IS NULL OR a.category = ${category})
            AND (${startDate}::text IS NULL OR a.edition_date >= ${startDate})
            AND (${endDate}::text IS NULL OR a.edition_date <= ${endDate})
            AND (${onlyWithImages}::boolean = false OR jsonb_array_length(a.image_urls) > 0)
          ORDER BY rank DESC
          LIMIT ${limit}
        `,
      ], { readOnly: true, fetchOptions: { signal } });
      return rows.map((row) => retrievedFromRow(row, "fts"));
    },
    timeoutMs,
    options.signal,
  );
}

export interface SessionArticleMeta {
  id: string;
  headline: string;
  editionDate: string;
  category: string;
  summary: string;
  byline: string | null;
  bodySnippet: string;
  imageUrls: string[];
  imageCaptions: (string | null)[];
}

export async function fetchArticleForRag(
  articleId: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<RetrievedArticle | null> {
  const timeoutMs = options.timeoutMs ?? HYBRID_SEARCH_TIMEOUT_MS;
  return runWithDbTimeout(
    "fetchArticleForRag",
    async (signal) => {
      const [rows] = await sql.transaction([
        sql`
          SELECT id, edition_date, category, headline, summary, byline,
                 body_plain, image_urls, image_captions
          FROM articles WHERE id = ${articleId}
        `,
      ], { readOnly: true, fetchOptions: { signal } });
      if (rows.length === 0) return null;
      return retrievedFromRow(rows[0], "fts");
    },
    timeoutMs,
    options.signal,
  );
}

/**
 * Batch-fetch article metadata by id for the /api/ask/session hydration
 * path. Returns a Map keyed by article id so callers can reassemble
 * per-turn sourceArticles without duplicating rows. Missing ids are
 * silently dropped (the article may have been deleted since the turn
 * was recorded).
 */
export async function fetchArticlesByIds(
  ids: string[],
): Promise<Map<string, SessionArticleMeta>> {
  if (ids.length === 0) return new Map();
  const rows = (await sql`
    SELECT id, edition_date, category, headline, summary, byline, body_plain, image_urls, image_captions
    FROM articles
    WHERE id = ANY(${ids})
  `) as Array<{
    id: string;
    edition_date: string;
    category: string;
    headline: string;
    summary: string;
    byline: string | null;
    body_plain: string | null;
    image_urls: string[] | null;
    image_captions: (string | null)[] | null;
  }>;
  const map = new Map<string, SessionArticleMeta>();
  for (const r of rows) {
    const body = r.body_plain ?? "";
    map.set(r.id, {
      id: r.id,
      headline: r.headline,
      editionDate: r.edition_date,
      category: r.category,
      summary: r.summary,
      byline: r.byline ?? null,
      bodySnippet:
        body.slice(0, 300) + (body.length > 300 ? "\u2026" : ""),
      imageUrls: r.image_urls ?? [],
      imageCaptions: r.image_captions ?? [],
    });
  }
  return map;
}
