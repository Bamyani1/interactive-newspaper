import { neon } from "@neondatabase/serverless";
import type { Article, EditionInfo, VintageAd } from "@/src/types";
import { createHash } from "crypto";
import {
  RAG_EMBEDDING_MODEL,
  RAG_IMAGE_EMBEDDING_INPUT_VERSION,
  RAG_PIPELINE_VERSION,
  RAG_TEXT_EMBEDDING_INPUT_VERSION,
} from "@/src/lib/rag-model-config";
import {
  getRagRetrievalConfig,
  shouldServeVersionedRetrieval,
} from "@/src/lib/rag-index-config";
import { isRagEvaluationMode } from "@/src/lib/rag-evaluation";

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
    if (isRagEvaluationMode()) return null;
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
    if (isRagEvaluationMode()) return;
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
let ragIndexBuildReadyOverride: boolean | null = null;
const ragIndexBuildReadiness = new Map<
  string,
  { checkedAt: number; indexBuildId: string }
>();

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

export function _setRagIndexBuildReadyForTests(value: boolean | null): void {
  ragIndexBuildReadyOverride = value;
  ragIndexBuildReadiness.clear();
}

async function assertConfiguredIndexBuildReady(
  signal: AbortSignal,
): Promise<string> {
  const config = getRagRetrievalConfig();
  const indexBuildId = config.activeIndexBuildId;
  if (!indexBuildId || config.mode === "legacy") {
    throw new Error("Versioned retrieval requires an explicit index build.");
  }
  if (ragIndexBuildReadyOverride !== null) {
    if (!ragIndexBuildReadyOverride) {
      throw new Error(`RAG index build ${indexBuildId} is not ready.`);
    }
    return indexBuildId;
  }

  const cached = ragIndexBuildReadiness.get(config.cacheIdentity);
  if (cached && Date.now() - cached.checkedAt < RAG_SCHEMA_PROBE_TTL_MS) {
    return cached.indexBuildId;
  }

  const rows = await sql.query(
    `SELECT id, corpus_version, status, pipeline_version, embedding_model,
            text_embedding_input_version, image_embedding_input_version,
            (SELECT COUNT(*)::int FROM rag_index_builds active
             WHERE active.corpus_version = build.corpus_version
               AND active.status = 'active') AS active_count
       FROM rag_index_builds build
      WHERE id = $1`,
    [indexBuildId],
    { fetchOptions: { signal } },
  );
  const build = rows[0];
  if (!build) {
    throw new Error(`Configured RAG index build ${indexBuildId} does not exist.`);
  }
  const allowedStatuses =
    config.mode === "versioned" ? ["active"] : ["validated", "active"];
  const mismatches = [
    build.corpus_version !== config.corpusVersion && "corpus_version",
    build.pipeline_version !== config.pipelineVersion && "pipeline_version",
    build.embedding_model !== config.embeddingModel && "embedding_model",
    build.text_embedding_input_version !== config.textEmbeddingInputVersion &&
      "text_embedding_input_version",
    build.image_embedding_input_version !== config.imageEmbeddingInputVersion &&
      "image_embedding_input_version",
    !allowedStatuses.includes(String(build.status)) && "status",
    config.mode === "versioned" && Number(build.active_count) !== 1 &&
      "active_count",
  ].filter(Boolean);
  if (mismatches.length > 0) {
    throw new Error(
      `Configured RAG index build ${indexBuildId} failed readiness validation: ${mismatches.join(", ")}.`,
    );
  }

  ragIndexBuildReadiness.set(config.cacheIdentity, {
    checkedAt: Date.now(),
    indexBuildId,
  });
  return indexBuildId;
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

export interface ArchiveCoverageStats {
  editionCount: number;
  articleCount: number;
  earliestEditionDate: string | null;
  latestEditionDate: string | null;
  retrievalTarget: "legacy" | "versioned";
}

export async function queryArchiveCoverage(
  options: {
    startDate?: string;
    endDate?: string;
    category?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<ArchiveCoverageStats> {
  const startDate = options.startDate ?? null;
  const endDate = options.endDate ?? null;
  const category = options.category ?? null;
  const timeoutMs = options.timeoutMs ?? HYBRID_SEARCH_TIMEOUT_MS;

  return runWithDbTimeout(
    "queryArchiveCoverage",
    async (signal) => {
      const target: "legacy" | "versioned" = shouldServeVersionedRetrieval()
        ? "versioned"
        : "legacy";
      let rows: Record<string, unknown>[];

      if (target === "versioned") {
        if (!(await hasRagV2Tables(signal))) {
          throw new Error(
            "Versioned RAG coverage was selected, but its required tables are unavailable.",
          );
        }
        const indexBuildId = await assertConfiguredIndexBuildReady(signal);
        rows = await sql.query(
          `WITH indexed_articles AS (
             SELECT DISTINCT a.id, a.edition_date
               FROM articles a
              WHERE ($1::text IS NULL OR a.edition_date >= $1)
                AND ($2::text IS NULL OR a.edition_date <= $2)
                AND ($3::text IS NULL OR a.category = $3)
                AND (
                  EXISTS (
                    SELECT 1 FROM article_chunks c
                     WHERE c.article_id = a.id
                       AND c.index_build_id = $4
                  )
                  OR EXISTS (
                    SELECT 1 FROM article_images i
                     WHERE i.article_id = a.id
                       AND i.index_build_id = $4
                  )
                )
           )
           SELECT COUNT(DISTINCT edition_date)::int AS edition_count,
                  COUNT(*)::int AS article_count,
                  MIN(edition_date)::text AS earliest_edition_date,
                  MAX(edition_date)::text AS latest_edition_date
             FROM indexed_articles`,
          [startDate, endDate, category, indexBuildId],
          { fetchOptions: { signal } },
        ) as Record<string, unknown>[];
      } else {
        rows = await sql.query(
          `WITH scoped_editions AS (
             SELECT date
               FROM editions
              WHERE ($1::text IS NULL OR date >= $1)
                AND ($2::text IS NULL OR date <= $2)
           ), scoped_articles AS (
             SELECT id
               FROM articles
              WHERE ($1::text IS NULL OR edition_date >= $1)
                AND ($2::text IS NULL OR edition_date <= $2)
                AND ($3::text IS NULL OR category = $3)
           )
           SELECT (SELECT COUNT(*)::int FROM scoped_editions) AS edition_count,
                  (SELECT COUNT(*)::int FROM scoped_articles) AS article_count,
                  (SELECT MIN(date)::text FROM scoped_editions) AS earliest_edition_date,
                  (SELECT MAX(date)::text FROM scoped_editions) AS latest_edition_date`,
          [startDate, endDate, category],
          { fetchOptions: { signal } },
        ) as Record<string, unknown>[];
      }

      const row = rows[0] ?? {};
      return {
        editionCount: Number(row.edition_count ?? 0),
        articleCount: Number(row.article_count ?? 0),
        earliestEditionDate:
          typeof row.earliest_edition_date === "string"
            ? row.earliest_edition_date
            : null,
        latestEditionDate:
          typeof row.latest_edition_date === "string"
            ? row.latest_edition_date
            : null,
        retrievalTarget: target,
      };
    },
    timeoutMs,
    options.signal,
  );
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
  /** Immutable revision identity. Legacy rows use a deterministic content hash. */
  contentRevisionId?: string;
  /** Retrieval-local evidence, populated by chunk/image indexes when available. */
  matchedPassages?: string[];
}

export type RetrievalMethod = "hybrid" | "fts" | "vector";

type RetrievalTarget = "legacy" | "versioned";

interface VectorSearchOptions {
  limit?: number;
  category?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  onlyWithImages?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  retrievalTarget?: RetrievalTarget;
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
  content_revision_id?: string | null;
}

export function legacyContentRevisionId(
  article: Pick<
    RetrievedArticle,
    | "id"
    | "editionDate"
    | "category"
    | "headline"
    | "summary"
    | "byline"
    | "bodyPlain"
    | "imageUrls"
    | "imageCaptions"
  >,
): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        id: article.id,
        editionDate: article.editionDate,
        category: article.category,
        headline: article.headline,
        summary: article.summary,
        byline: article.byline,
        bodyPlain: article.bodyPlain,
        imageUrls: article.imageUrls,
        imageCaptions: article.imageCaptions,
      }),
    )
    .digest("hex");
  return `legacy-sha256:${digest}`;
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
  const article: RetrievedArticle = {
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
  article.contentRevisionId =
    row.content_revision_id?.trim() || legacyContentRevisionId(article);
  return article;
}

function cleanEvidencePassage(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.replace(/<\/?b>/gi, "").replace(/\s+/g, " ").trim();
}

function promoteMatchedImage(
  article: RetrievedArticle,
  row: RagResultRow,
): void {
  if (!row.matched_image_url) return;
  const matchedIndex = article.imageUrls.indexOf(row.matched_image_url);
  if (matchedIndex < 0) return;

  const matchedUrl = article.imageUrls[matchedIndex];
  const matchedCaption =
    article.imageCaptions[matchedIndex] ?? row.matched_caption ?? null;
  article.imageUrls = [
    matchedUrl,
    ...article.imageUrls.filter((_, index) => index !== matchedIndex),
  ];
  article.imageCaptions = [
    matchedCaption,
    ...article.imageCaptions.filter((_, index) => index !== matchedIndex),
  ];
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
      promoteMatchedImage(existing, row);
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
  indexBuildId: string,
): Promise<RetrievedArticle[]> {
  const limit = options.limit ?? 10;
  const category = options.category ?? null;
  const startDate = options.startDate ?? null;
  const endDate = options.endDate ?? null;
  const onlyWithImages = options.onlyWithImages ?? false;
  const timeoutMs = options.timeoutMs ?? HYBRID_SEARCH_TIMEOUT_MS;
  const vecStr = `[${embeddingVec.join(",")}]`;
  const evidencePerArticle = onlyWithImages ? 2 : 3;

  return runWithDbTimeout(
    "queryArticlesByEmbedding.v2",
    async (signal) => {
      if (onlyWithImages) {
        const [, , rows] = await sql.transaction([
          sql`SET LOCAL hnsw.ef_search = 100`,
          sql`SET LOCAL hnsw.iterative_scan = 'relaxed_order'`,
          sql`
            WITH image_evidence AS (
              SELECT a.id, a.edition_date, a.category, a.headline, a.summary,
                     a.byline, a.body_plain, a.image_urls, a.image_captions,
                     i.image_url AS matched_image_url,
                     i.caption AS matched_caption,
                     (i.embedding <=> ${vecStr}::vector) AS evidence_distance,
                     MIN(i.embedding <=> ${vecStr}::vector)
                       OVER (PARTITION BY i.article_id) AS article_distance,
                     ROW_NUMBER() OVER (
                       PARTITION BY i.article_id
                       ORDER BY i.embedding <=> ${vecStr}::vector, i.image_index
                     ) AS evidence_rank
              FROM article_images i
              JOIN articles a ON a.id = i.article_id
              WHERE i.embedding IS NOT NULL
                AND i.index_build_id = ${indexBuildId}
                AND i.embedding_model = ${RAG_EMBEDDING_MODEL}
                AND i.embedding_input_version = ${RAG_IMAGE_EMBEDDING_INPUT_VERSION}
                AND (${category}::text IS NULL OR a.category = ${category})
                AND (${startDate}::text IS NULL OR a.edition_date >= ${startDate})
                AND (${endDate}::text IS NULL OR a.edition_date <= ${endDate})
            ), ranked_articles AS (
              SELECT id, MIN(article_distance) AS article_distance
              FROM image_evidence
              GROUP BY id
              ORDER BY article_distance
              LIMIT ${limit}
            )
            SELECT e.id, e.edition_date, e.category, e.headline, e.summary,
                   e.byline, e.body_plain, e.image_urls, e.image_captions,
                   e.matched_image_url, e.matched_caption,
                   r.article_distance AS distance
            FROM ranked_articles r
            JOIN image_evidence e ON e.id = r.id
            WHERE e.evidence_rank <= ${evidencePerArticle}
            ORDER BY r.article_distance, e.evidence_rank
          `,
        ], { readOnly: true, fetchOptions: { signal } });
        return aggregateEvidenceRows(rows, "vector", limit);
      }

      const [, , rows] = await sql.transaction([
        sql`SET LOCAL hnsw.ef_search = 100`,
        sql`SET LOCAL hnsw.iterative_scan = 'relaxed_order'`,
        sql`
          WITH chunk_evidence AS (
            SELECT a.id, a.edition_date, a.category, a.headline, a.summary,
                   a.byline, a.body_plain, a.image_urls, a.image_captions,
                   c.chunk_text,
                   (c.embedding <=> ${vecStr}::vector) AS evidence_distance,
                   MIN(c.embedding <=> ${vecStr}::vector)
                     OVER (PARTITION BY c.article_id) AS article_distance,
                   ROW_NUMBER() OVER (
                     PARTITION BY c.article_id
                     ORDER BY c.embedding <=> ${vecStr}::vector, c.chunk_index
                   ) AS evidence_rank
            FROM article_chunks c
            JOIN articles a ON a.id = c.article_id
            WHERE c.embedding IS NOT NULL
              AND c.index_build_id = ${indexBuildId}
              AND c.embedding_model = ${RAG_EMBEDDING_MODEL}
              AND c.embedding_input_version = ${RAG_TEXT_EMBEDDING_INPUT_VERSION}
              AND (${category}::text IS NULL OR a.category = ${category})
              AND (${startDate}::text IS NULL OR a.edition_date >= ${startDate})
              AND (${endDate}::text IS NULL OR a.edition_date <= ${endDate})
          ), ranked_articles AS (
            SELECT id, MIN(article_distance) AS article_distance
            FROM chunk_evidence
            GROUP BY id
            ORDER BY article_distance
            LIMIT ${limit}
          )
          SELECT e.id, e.edition_date, e.category, e.headline, e.summary,
                 e.byline, e.body_plain, e.image_urls, e.image_captions,
                 e.chunk_text, r.article_distance AS distance
          FROM ranked_articles r
          JOIN chunk_evidence e ON e.id = r.id
          WHERE e.evidence_rank <= ${evidencePerArticle}
          ORDER BY r.article_distance, e.evidence_rank
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
  const serveVersioned =
    options.retrievalTarget === "versioned" ||
    (options.retrievalTarget === undefined && shouldServeVersionedRetrieval());
  if (!serveVersioned) {
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
  const indexBuildId = await runWithDbTimeout(
    "validateRagIndexBuild",
    (signal) => assertConfiguredIndexBuildReady(signal),
    timeoutMs,
    options.signal,
  );
  return queryRagV2ByEmbedding(embeddingVec, options, indexBuildId);
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
  const [vectorOutcome, ftsOutcome] = await Promise.allSettled([
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
  ]);

  if (vectorOutcome.status === "rejected" && ftsOutcome.status === "rejected") {
    const timeoutError = [vectorOutcome.reason, ftsOutcome.reason].find(
      (reason): reason is DbTimeoutError => reason instanceof DbTimeoutError,
    );
    if (timeoutError) {
      throw timeoutError;
    }
    throw new AggregateError(
      [vectorOutcome.reason, ftsOutcome.reason],
      "Both vector and full-text retrieval failed.",
    );
  }
  const vectorResults =
    vectorOutcome.status === "fulfilled" ? vectorOutcome.value : [];
  const ftsResults = ftsOutcome.status === "fulfilled" ? ftsOutcome.value : [];

  const fused = fuseArticleResults(vectorResults, ftsResults, {
    limit,
    vectorWeight,
  });

  setCachedHybridSearch(cacheKey, fused);
  return fused;
}

/**
 * Deterministic article-level Reciprocal Rank Fusion. Kept pure so the
 * retrieval service and evaluation harness can inspect each raw signal before
 * fusion without issuing duplicate database queries.
 */
export function fuseArticleResults(
  vectorResults: RetrievedArticle[],
  ftsResults: RetrievedArticle[],
  options: { limit: number; vectorWeight: number },
): RetrievedArticle[] {
  const vectorWeight = options.vectorWeight;
  const ftsWeight = 1 - vectorWeight;

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
  return Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit)
    .map((entry) => entry.article);
}

/**
 * FTS search that returns retrieval-local passages with article metadata.
 */
export interface SearchArticlesForRagOptions {
  limit?: number;
  category?: string;
  startDate?: string;
  endDate?: string;
  onlyWithImages?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  retrievalTarget?: RetrievalTarget;
}

export async function searchArticlesForRag(
  query: string,
  options: SearchArticlesForRagOptions = {},
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
      const serveVersioned =
        options.retrievalTarget === "versioned" ||
        (options.retrievalTarget === undefined && shouldServeVersionedRetrieval());
      if (serveVersioned) {
        if (!(await hasRagV2Tables(signal))) {
          throw new Error(
            "Versioned RAG retrieval was selected, but its required tables are unavailable.",
          );
        }
        const indexBuildId = await assertConfiguredIndexBuildReady(signal);
        const evidencePerArticle = 3;
        const [rows] = await sql.transaction([
          sql`
            WITH query AS (
              SELECT websearch_to_tsquery('english', ${query}) AS value
            ), article_matches AS (
              SELECT a.id, a.edition_date, a.category, a.headline, a.summary,
                     a.byline, a.body_plain, a.image_urls, a.image_captions,
                     ts_headline(
                       'english', a.body_plain, q.value,
                       'MaxFragments=2, MinWords=15, MaxWords=55'
                     ) AS chunk_text,
                     NULL::text AS matched_caption,
                     NULL::text AS matched_image_url,
                     ts_rank(a.search_vector, q.value) AS evidence_score,
                     0 AS evidence_position,
                     1 AS evidence_type
              FROM articles a
              CROSS JOIN query q
              WHERE a.search_vector @@ q.value
                AND EXISTS (
                  SELECT 1 FROM article_chunks indexed
                  WHERE indexed.article_id = a.id
                    AND indexed.index_build_id = ${indexBuildId}
                )
                AND (${category}::text IS NULL OR a.category = ${category})
                AND (${startDate}::text IS NULL OR a.edition_date >= ${startDate})
                AND (${endDate}::text IS NULL OR a.edition_date <= ${endDate})
                AND (${onlyWithImages}::boolean = false OR jsonb_array_length(a.image_urls) > 0)
            ), chunk_matches AS (
              SELECT a.id, a.edition_date, a.category, a.headline, a.summary,
                     a.byline, a.body_plain, a.image_urls, a.image_captions,
                     c.chunk_text,
                     NULL::text AS matched_caption,
                     NULL::text AS matched_image_url,
                     ts_rank(c.search_vector, q.value) AS evidence_score,
                     c.chunk_index AS evidence_position,
                     2 AS evidence_type
              FROM article_chunks c
              JOIN articles a ON a.id = c.article_id
              CROSS JOIN query q
              WHERE c.search_vector @@ q.value
                AND c.index_build_id = ${indexBuildId}
                AND (${category}::text IS NULL OR a.category = ${category})
                AND (${startDate}::text IS NULL OR a.edition_date >= ${startDate})
                AND (${endDate}::text IS NULL OR a.edition_date <= ${endDate})
                AND (${onlyWithImages}::boolean = false OR jsonb_array_length(a.image_urls) > 0)
            ), caption_matches AS (
              SELECT a.id, a.edition_date, a.category, a.headline, a.summary,
                     a.byline, a.body_plain, a.image_urls, a.image_captions,
                     NULL::text AS chunk_text,
                     i.caption AS matched_caption,
                     i.image_url AS matched_image_url,
                     ts_rank(
                       to_tsvector('english', coalesce(i.caption, '')),
                       q.value
                     ) AS evidence_score,
                     i.image_index AS evidence_position,
                     3 AS evidence_type
              FROM article_images i
              JOIN articles a ON a.id = i.article_id
              CROSS JOIN query q
              WHERE to_tsvector('english', coalesce(i.caption, '')) @@ q.value
                AND i.index_build_id = ${indexBuildId}
                AND (${category}::text IS NULL OR a.category = ${category})
                AND (${startDate}::text IS NULL OR a.edition_date >= ${startDate})
                AND (${endDate}::text IS NULL OR a.edition_date <= ${endDate})
                AND (${onlyWithImages}::boolean = false OR jsonb_array_length(a.image_urls) > 0)
            ), all_evidence AS (
              SELECT * FROM article_matches
              UNION ALL
              SELECT * FROM chunk_matches
              UNION ALL
              SELECT * FROM caption_matches
            ), ranked_evidence AS (
              SELECT e.*,
                     MAX(e.evidence_score) OVER (PARTITION BY e.id) AS article_rank,
                     ROW_NUMBER() OVER (
                       PARTITION BY e.id
                       ORDER BY e.evidence_score DESC,
                                e.evidence_type,
                                e.evidence_position
                     ) AS evidence_rank
              FROM all_evidence e
            ), ranked_articles AS (
              SELECT id, MAX(article_rank) AS article_rank
              FROM ranked_evidence
              GROUP BY id
              ORDER BY article_rank DESC, id
              LIMIT ${limit}
            )
            SELECT e.id, e.edition_date, e.category, e.headline, e.summary,
                   e.byline, e.body_plain, e.image_urls, e.image_captions,
                   e.chunk_text, e.matched_caption, e.matched_image_url,
                   r.article_rank AS rank
            FROM ranked_articles r
            JOIN ranked_evidence e ON e.id = r.id
            WHERE e.evidence_rank <= ${evidencePerArticle}
            ORDER BY r.article_rank DESC, r.id, e.evidence_rank
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
