import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "../lib/local-env";
import { RAG_EMBEDDING_MODEL } from "../../src/lib/rag-model-config";

type Row = Record<string, unknown>;

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected a finite number, received ${value}.`);
  return parsed;
}

function asString(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asString(entry).trim())
    .filter((entry) => entry.length > 0);
}

function rowHash(row: Row, omittedKeys: string[] = []): string {
  const omitted = new Set(omittedKeys);
  return sha256(
    Object.fromEntries(Object.entries(row).filter(([key]) => !omitted.has(key))),
  );
}

function countByNullableString(rows: Row[], key: string): Record<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = asString(row[key]).trim() || "unlabeled";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

interface CorpusSnapshotInput {
  transaction: Row;
  schema: Row[];
  tableNames: string[];
  editions: Row[];
  articles: Row[];
  ads: Row[];
  weather: Row[];
  music: Row[];
  chunks: Row[];
  images: Row[];
}

export function buildCorpusSnapshot(input: CorpusSnapshotInput) {
  const articlesByEdition = new Map<string, Row[]>();
  for (const article of input.articles) {
    const date = asString(article.edition_date);
    const group = articlesByEdition.get(date) ?? [];
    group.push(article);
    articlesByEdition.set(date, group);
  }
  const adsByEdition = new Map<string, Row[]>();
  for (const ad of input.ads) {
    const date = asString(ad.edition_date);
    const group = adsByEdition.get(date) ?? [];
    group.push(ad);
    adsByEdition.set(date, group);
  }

  const editions = input.editions.map((edition) => {
    const date = asString(edition.date);
    const articleEntries = (articlesByEdition.get(date) ?? [])
      .sort((left, right) => asNumber(left.position) - asNumber(right.position))
      .map((article) => ({
        id: asString(article.id),
        position: asNumber(article.position),
        page: asNumber(article.page),
        headline: asString(article.headline),
        category: asString(article.category),
        imageUrls: asStringArray(article.image_urls),
        imageCaptions: asStringArray(article.image_captions),
        contentSha256: rowHash(article, [
          "has_embedding",
          "embedding_model",
          "embedding_input_hash",
          "embedding_input_version",
        ]),
        embedding: {
          present: Boolean(article.has_embedding),
          model: article.embedding_model ?? null,
          inputVersion: article.embedding_input_version ?? null,
          inputHash: article.embedding_input_hash ?? null,
        },
      }));
    const adEntries = (adsByEdition.get(date) ?? [])
      .sort((left, right) => asNumber(left.position) - asNumber(right.position))
      .map((ad) => ({
        position: asNumber(ad.position),
        contentSha256: rowHash(ad, ["id"]),
      }));
    const editionCore = {
      date,
      pageCount: asNumber(edition.page_count),
      declaredArticleCount: asNumber(edition.article_count),
      publicationInfo: asString(edition.publication_info),
      articles: articleEntries.map((article) => ({
        id: article.id,
        position: article.position,
        page: article.page,
        headline: article.headline,
        category: article.category,
        contentSha256: article.contentSha256,
      })),
    };
    return {
      date,
      pageCount: editionCore.pageCount,
      declaredArticleCount: editionCore.declaredArticleCount,
      publicationInfo: editionCore.publicationInfo,
      articles: articleEntries,
      ads: adEntries,
      editionSha256: sha256(editionCore),
    };
  });

  const articleEmbeddingCount = input.articles.filter((row) => row.has_embedding).length;
  const chunkEmbeddingCount = input.chunks.filter((row) => row.has_embedding).length;
  const imageEmbeddingCount = input.images.filter((row) => row.has_embedding).length;
  const articleImageReferences = editions.reduce(
    (count, edition) =>
      count + edition.articles.reduce((sum, article) => sum + article.imageUrls.length, 0),
    0,
  );
  const articlesWithImages = editions.reduce(
    (count, edition) =>
      count + edition.articles.filter((article) => article.imageUrls.length > 0).length,
    0,
  );
  const corpusSha256 = sha256(
    editions.map((edition) => ({
      date: edition.date,
      pageCount: edition.pageCount,
      declaredArticleCount: edition.declaredArticleCount,
      publicationInfo: edition.publicationInfo,
      editionSha256: edition.editionSha256,
    })),
  );
  const schemaSha256 = sha256(input.schema);
  const candidateIndex = {
    chunks: input.chunks.map((row) => ({
      id: asString(row.id),
      articleId: asString(row.article_id),
      chunkIndex: asNumber(row.chunk_index),
      contentSha256: rowHash(row, [
        "has_embedding",
        "embedding_model",
        "embedding_input_hash",
        "embedding_input_version",
      ]),
      hasEmbedding: Boolean(row.has_embedding),
      embeddingModel: row.embedding_model ?? null,
      embeddingInputVersion: row.embedding_input_version ?? null,
      embeddingInputHash: row.embedding_input_hash ?? null,
    })),
    images: input.images.map((row) => ({
      id: asString(row.id),
      articleId: asString(row.article_id),
      imageIndex: asNumber(row.image_index),
      contentSha256: rowHash(row, [
        "has_embedding",
        "embedding_model",
        "embedding_input_hash",
        "embedding_input_version",
      ]),
      hasEmbedding: Boolean(row.has_embedding),
      embeddingModel: row.embedding_model ?? null,
      embeddingInputVersion: row.embedding_input_version ?? null,
      embeddingInputHash: row.embedding_input_hash ?? null,
    })),
  };
  const auxiliary = {
    weather: input.weather[0] ?? null,
    music: input.music[0] ?? null,
  };
  const legacyArticleIndex = editions.flatMap((edition) =>
    edition.articles.map((article) => ({
      id: article.id,
      contentSha256: article.contentSha256,
      embedding: article.embedding,
    })),
  );
  const databaseSnapshotSha256 = sha256({
    corpusSha256,
    schemaSha256,
    legacyArticleIndex,
    ads: editions.map((edition) => ({ date: edition.date, ads: edition.ads })),
    candidateIndex,
    auxiliary,
  });

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    transaction: input.transaction,
    retrievalMode: "legacy",
    corpusVersion: `legacy-${corpusSha256.slice(0, 16)}`,
    corpusSha256,
    databaseSnapshotSha256,
    schemaSha256,
    schema: input.schema,
    tableNames: input.tableNames,
    counts: {
      editions: editions.length,
      articles: input.articles.length,
      ads: input.ads.length,
      articleEmbeddings: articleEmbeddingCount,
      articlesWithImages,
      articleImageReferences,
      chunks: input.chunks.length,
      chunkEmbeddings: chunkEmbeddingCount,
      images: input.images.length,
      imageEmbeddings: imageEmbeddingCount,
    },
    embeddingCoverage: {
      currentModel: RAG_EMBEDDING_MODEL,
      articleCurrentModelEmbeddings: input.articles.filter(
        (row) => row.has_embedding && row.embedding_model === RAG_EMBEDDING_MODEL,
      ).length,
      articleModels: countByNullableString(
        input.articles.filter((row) => row.has_embedding),
        "embedding_model",
      ),
      chunkModels: countByNullableString(
        input.chunks.filter((row) => row.has_embedding),
        "embedding_model",
      ),
      imageModels: countByNullableString(
        input.images.filter((row) => row.has_embedding),
        "embedding_model",
      ),
    },
    auxiliary,
    candidateIndex: {
      legacyArticleIndexSha256: sha256(legacyArticleIndex),
      chunksSha256: sha256(candidateIndex.chunks),
      imagesSha256: sha256(candidateIndex.images),
      ...candidateIndex,
    },
    editions,
  };
}

function writeJsonAtomic(outputPath: string, value: unknown): "created" | "reused" {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  if (existsSync(outputPath)) {
    const existing = JSON.parse(readFileSync(outputPath, "utf8")) as {
      corpusSha256?: string;
      databaseSnapshotSha256?: string;
      schemaVersion?: number;
    };
    const candidate = value as {
      corpusSha256?: string;
      databaseSnapshotSha256?: string;
      schemaVersion?: number;
    };
    if (
      existing.corpusSha256 === candidate.corpusSha256 &&
      existing.databaseSnapshotSha256 === candidate.databaseSnapshotSha256 &&
      existing.schemaVersion === candidate.schemaVersion
    ) {
      return "reused";
    }
    throw new Error(
      `Refusing to overwrite immutable corpus snapshot ${outputPath}. ` +
        "Move the existing artifact aside or choose a new snapshot version after review.",
    );
  }
  const partial = `${outputPath}.part`;
  writeFileSync(partial, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(partial, outputPath);
  return "created";
}

async function main(): Promise<void> {
  loadLocalEnv();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const sql = neon(process.env.DATABASE_URL);
  const tableRows = (await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `) as Row[];
  const tableNames = tableRows.map((row) => asString(row.table_name));
  const liveColumnRows = (await sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `) as Row[];
  const columnsByTable = new Map<string, Set<string>>();
  for (const row of liveColumnRows) {
    const table = asString(row.table_name);
    const columns = columnsByTable.get(table) ?? new Set<string>();
    columns.add(asString(row.column_name));
    columnsByTable.set(table, columns);
  }
  const articleColumns = columnsByTable.get("articles") ?? new Set<string>();
  const writerPosition = articleColumns.has("writer_position")
    ? sql`writer_position`
    : sql`NULL::text`;
  const articleEmbeddingModel = articleColumns.has("embedding_model")
    ? sql`embedding_model`
    : sql`NULL::text`;
  const articleEmbeddingInputHash = articleColumns.has("embedding_input_hash")
    ? sql`embedding_input_hash`
    : sql`NULL::text`;
  const articleEmbeddingInputVersion = articleColumns.has("embedding_input_version")
    ? sql`embedding_input_version`
    : sql`NULL::text`;
  const hasChunks = tableNames.includes("article_chunks");
  const hasImages = tableNames.includes("article_images");
  const hasWeather = tableNames.includes("weather");
  const hasMusic = tableNames.includes("music");

  const queries = [
    sql`SELECT now()::text AS snapshot_at, txid_current_snapshot()::text AS transaction_snapshot`,
    sql`
      SELECT table_name, ordinal_position, column_name, data_type, udt_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `,
    sql`
      SELECT date, publication_info, page_count, article_count
      FROM editions
      ORDER BY date
    `,
    sql`
      SELECT id, edition_date, position, category, headline, summary, full_text,
             body_plain, byline, ${writerPosition} AS writer_position,
             page, is_hero, is_featured, image_urls, image_caption, image_captions,
             ${articleEmbeddingModel} AS embedding_model,
             ${articleEmbeddingInputHash} AS embedding_input_hash,
             ${articleEmbeddingInputVersion} AS embedding_input_version,
             (embedding IS NOT NULL) AS has_embedding
      FROM articles
      ORDER BY edition_date, position, id
    `,
    sql`
      SELECT id, edition_date, position, title, body, category, ad_type,
             display_text, phone, address, price, image_urls
      FROM ads
      ORDER BY edition_date, position, id
    `,
    hasWeather
      ? sql`
          SELECT count(*)::int AS rows, min(date) AS min_date, max(date) AS max_date,
                 count(*) FILTER (WHERE is_estimated)::int AS estimated_rows
          FROM weather
        `
      : sql`SELECT 0::int AS rows, NULL::text AS min_date, NULL::text AS max_date, 0::int AS estimated_rows`,
    hasMusic
      ? sql`
          SELECT count(*)::int AS rows, min(year)::int AS min_year, max(year)::int AS max_year,
                 count(DISTINCT (year, month))::int AS months
          FROM music
        `
      : sql`SELECT 0::int AS rows, NULL::int AS min_year, NULL::int AS max_year, 0::int AS months`,
  ];
  if (hasChunks) {
    queries.push(sql`
      SELECT id, article_id, chunk_index, chunk_text, embedding_model,
             embedding_input_version, embedding_input_hash,
             (embedding IS NOT NULL) AS has_embedding
      FROM article_chunks
      ORDER BY article_id, chunk_index, id
    `);
  }
  if (hasImages) {
    queries.push(sql`
      SELECT id, article_id, image_index, image_url, caption, embedding_model,
             embedding_input_version, embedding_input_hash,
             (embedding IS NOT NULL) AS has_embedding
      FROM article_images
      ORDER BY article_id, image_index, id
    `);
  }

  const results = (await sql.transaction(queries, {
    isolationLevel: "RepeatableRead",
    readOnly: true,
  })) as Row[][];
  let index = 0;
  const transaction = results[index++] ?? [];
  const schema = results[index++] ?? [];
  const editions = results[index++] ?? [];
  const articles = results[index++] ?? [];
  const ads = results[index++] ?? [];
  const weather = results[index++] ?? [];
  const music = results[index++] ?? [];
  const chunks = hasChunks ? (results[index++] ?? []) : [];
  const images = hasImages ? (results[index++] ?? []) : [];

  const snapshot = buildCorpusSnapshot({
    transaction: transaction[0] ?? {},
    schema,
    tableNames,
    editions,
    articles,
    ads,
    weather,
    music,
    chunks,
    images,
  });
  const outputDir = path.resolve("evaluation/rag/corpus");
  const outputPath = path.join(outputDir, `${snapshot.corpusVersion}.json`);
  const disposition = writeJsonAtomic(outputPath, snapshot);
  console.log(
    JSON.stringify(
      {
        outputPath,
        disposition,
        corpusVersion: snapshot.corpusVersion,
        corpusSha256: snapshot.corpusSha256,
        databaseSnapshotSha256: snapshot.databaseSnapshotSha256,
        counts: snapshot.counts,
      },
      null,
      2,
    ),
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
