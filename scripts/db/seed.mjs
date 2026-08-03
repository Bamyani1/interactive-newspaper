/**
 * Database Seed Script (data-only — never runs DDL)
 *
 * Reads edition JSON files, weather index, and music data from the filesystem,
 * transforms them using ocr-adapter functions, and inserts into Neon PostgreSQL.
 * The schema comes exclusively from `npm run db:migrate`; this script refuses
 * to run against an unmigrated database.
 *
 * Locked editions (defined in locked-editions.json) are automatically restored
 * from their gold source on every --reset, preventing accidental deletion.
 *
 * Usage:
 *   npm run db:seed              — insert data (skip existing editions)
 *   npm run db:reset             — truncate re-seedable tables and re-seed
 *   npm run db:reset -- --include-runtime — also truncate runtime tables (sessions, feedback, spend, rate limits)
 *   npm run db:reset -- --include-rag-builds — also allowed when finalized (paid) index builds exist
 *   npm run db:reset -- --unlock — reset WITHOUT restoring locked editions
 *   npm run db:seed -- --date 1960-05-11 --editions-dir public/editions --summary-path ocr/runs/1960-05-11/seed-summary.json
 */

import { neon } from "@neondatabase/serverless";
import { readdir, readFile, mkdir, copyFile } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Load .env.local (Node.js doesn't auto-load like Next.js)
const __dirnameEnv = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirnameEnv, "../../.env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

// tsx loader lets us import TypeScript source directly
// Note: without "type":"module" in package.json, tsx compiles .ts as CJS,
// so we use a default import and destructure the named exports.
import ocrAdapter from "../../src/server/ocr-adapter/index.ts";
const { transformArticles, transformAds, computePageCount } = ocrAdapter;

// .mjs importing .ts named exports needs the default-interop pattern (tsx
// compiles .ts to CJS because package.json has no "type":"module").
const migrationRunnerModule = await import("./lib/migration-runner.ts");
const { assertMigrationsCurrent, CANONICAL_TABLES, LEDGER_TABLE } =
  migrationRunnerModule.default ?? migrationRunnerModule;
const neonExecutorModule = await import("./lib/neon-executor.ts");
const { createNeonExecutor } = neonExecutorModule.default ?? neonExecutorModule;

const ROOT = path.resolve(__dirnameEnv, "../..");
const EDITIONS_DIR = path.join(ROOT, "public", "editions");
const WEATHER_INDEX = path.join(
  ROOT,
  "public/data/weather/ohio/index/delaware-by-date-1950-2000.json",
);
const MUSIC_ARCHIVE = path.join(ROOT, "public/top-10-music/chart-1950-2010.json");

const isReset = process.argv.includes("--reset");
const isUnlock = process.argv.includes("--unlock");
const includeRuntime = process.argv.includes("--include-runtime");
const includeRagBuilds = process.argv.includes("--include-rag-builds");

// ─── Locked Editions ────────────────────────────────────────────
// Locked editions are restored from their gold source on every --reset
// to prevent accidental deletion. Use --unlock to skip this protection.

const LOCKED_EDITIONS_FILE = path.join(__dirnameEnv, "locked-editions.json");
const LOCKED_EDITIONS = existsSync(LOCKED_EDITIONS_FILE)
  ? JSON.parse(readFileSync(LOCKED_EDITIONS_FILE, "utf-8"))
  : {};

function readArgValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return "";
  return process.argv[idx + 1] || "";
}

const targetDate = readArgValue("--date");
const summaryPath = readArgValue("--summary-path");
const editionsDirArg = readArgValue("--editions-dir");
if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
  console.error(`ERROR: Invalid --date value '${targetDate}'. Expected YYYY-MM-DD.`);
  process.exit(1);
}
const ACTIVE_EDITIONS_DIR = editionsDirArg
  ? (path.isAbsolute(editionsDirArg) ? editionsDirArg : path.resolve(ROOT, editionsDirArg))
  : EDITIONS_DIR;

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required.");
  console.error("Set it in .env.local or export it before running this script.");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

// ─── Helpers ─────────────────────────────────────────────────────

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

/** Strip null bytes that PostgreSQL rejects in UTF-8 text */
function sanitize(text) {
  return typeof text === "string" ? text.replace(/\0/g, "") : text;
}

/** Strip HTML tags to get plain text for FTS indexing */
function stripHtml(html) {
  return sanitize(html).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// ─── DB-Level Lock: Export / Restore ────────────────────────────
// Saves locked edition data from the database before the reset truncation,
// then re-inserts it afterward. This protects the gold edition even on
// machines that don't have the gold source files locally.

async function exportLockedEditions() {
  const lockedDates = Object.keys(LOCKED_EDITIONS);
  if (lockedDates.length === 0 || isUnlock) return null;

  const saved = {};
  for (const date of lockedDates) {
    try {
      const [edition] = await sql`SELECT * FROM editions WHERE date = ${date}`;
      if (!edition) continue;
      const articles = await sql`SELECT id, edition_date, position, category, headline, summary, full_text, body_plain, byline, writer_position, page, is_hero, is_featured, image_urls, image_caption, image_captions, embedding, embedding_model, embedding_input_hash, embedding_input_version FROM articles WHERE edition_date = ${date} ORDER BY position`;
      const ads = await sql`SELECT edition_date, position, title, body, category, ad_type, display_text, phone, address, price, image_urls FROM ads WHERE edition_date = ${date} ORDER BY position`;
      saved[date] = { edition, articles, ads };
      console.log(`  Saved locked edition ${date} from DB (${articles.length} articles, ${ads.length} ads)`);
    } catch {
      // Tables might not exist on first run
    }
  }
  return Object.keys(saved).length > 0 ? saved : null;
}

async function restoreLockedEditions(savedData) {
  if (!savedData) return;

  for (const [date, { edition, articles, ads }] of Object.entries(savedData)) {
    await sql`INSERT INTO editions (date, publication_info, page_count, article_count)
              VALUES (${edition.date}, ${edition.publication_info}, ${edition.page_count}, ${edition.article_count})
              ON CONFLICT (date) DO NOTHING`;

    if (articles.length > 0) {
      const articleQueries = articles.map((a) =>
        sql`INSERT INTO articles (id, edition_date, position, category, headline, summary, full_text, body_plain, byline, writer_position, page, is_hero, is_featured, image_urls, image_caption, image_captions, embedding, embedding_model, embedding_input_hash, embedding_input_version)
            VALUES (${a.id}, ${a.edition_date}, ${a.position}, ${a.category}, ${a.headline}, ${a.summary}, ${a.full_text}, ${a.body_plain}, ${a.byline}, ${a.writer_position}, ${a.page}, ${a.is_hero}, ${a.is_featured}, ${JSON.stringify(a.image_urls)}, ${a.image_caption}, ${JSON.stringify(a.image_captions)}, ${a.embedding}, ${a.embedding_model}, ${a.embedding_input_hash}, ${a.embedding_input_version})
            ON CONFLICT (id) DO NOTHING`
      );
      await sql.transaction(articleQueries);
    }

    if (ads.length > 0) {
      await sql`DELETE FROM ads WHERE edition_date = ${date}`;
      const adQueries = ads.map((a) =>
        sql`INSERT INTO ads (edition_date, position, title, body, category, ad_type, display_text, phone, address, price, image_urls)
            VALUES (${a.edition_date}, ${a.position}, ${a.title}, ${a.body}, ${a.category}, ${a.ad_type}, ${a.display_text}, ${a.phone}, ${a.address}, ${a.price}, ${JSON.stringify(a.image_urls)})`
      );
      await sql.transaction(adQueries);
    }

    console.log(`  Restored locked edition ${date} (${articles.length} articles, ${ads.length} ads)`);
  }
}

// TRUNCATE-based reset — data only, never DDL. Truncates every registered
// re-seedable table (plus runtime tables with --include-runtime) in one
// statement; the migration ledger is never touched.
async function truncateSeedTables() {
  // Finalized index builds carry PAID embedding vectors (and identity/asset
  // state that takes a multi-step pipeline to rebuild). A plain --reset was
  // historically cheap — refuse to widen its blast radius silently.
  const guard = await sql.query(
    `SELECT id, status FROM rag_index_builds
     WHERE to_regclass('public.rag_index_builds') IS NOT NULL
       AND status IN ('validated', 'active')
     ORDER BY created_at DESC LIMIT 3`,
  ).catch(() => []);
  if (guard.length > 0 && !includeRagBuilds) {
    throw new Error(
      `Refusing --reset: this database holds ${guard.length}+ finalized index build(s) ` +
        `(${guard.map((b) => `${b.id}:${b.status}`).join(", ")}) whose embedding vectors cost ` +
        `real API spend to recreate. Re-run with --include-rag-builds to truncate them anyway.`,
    );
  }
  const truncated = CANONICAL_TABLES
    .filter((t) => t.kind === "reseedable" || (includeRuntime && t.kind === "runtime"))
    .map((t) => t.name);
  const preserved = CANONICAL_TABLES
    .filter((t) => !truncated.includes(t.name))
    .map((t) => t.name);

  await sql.query(`TRUNCATE ${truncated.join(", ")} RESTART IDENTITY CASCADE`);

  console.log(`Truncated ${truncated.length} table(s): ${truncated.join(", ")}`);
  console.log(`Preserved: ${[...preserved, LEDGER_TABLE].join(", ")}`);
}

// ─── Seed Editions ───────────────────────────────────────────────

async function seedEditions(scopedDate = "") {
  const [embeddingModule, chunkingModule] = await Promise.all([
    import("../../src/lib/embeddings.ts"),
    import("../../src/lib/article-chunking.ts"),
  ]);
  const {
    buildEmbeddingInput,
    embeddingInputFingerprint,
    EMBEDDING_INPUT_VERSION,
    EMBEDDING_MODEL,
  } = embeddingModule;
  const { buildArticleChunkRecords } = chunkingModule;

  const entries = await readdir(ACTIVE_EDITIONS_DIR, { withFileTypes: true });
  let dateDirs = entries
    .filter((e) => e.isDirectory() && isIsoDate(e.name))
    .map((e) => e.name)
    .sort();
  if (scopedDate) {
    dateDirs = dateDirs.filter((d) => d === scopedDate);
  }

  console.log(`Found ${dateDirs.length} edition(s) to seed.`);
  const seeded = [];

  for (const date of dateDirs) {
    const editionPath = path.join(ACTIVE_EDITIONS_DIR, date, "edition.json");
    let raw;
    try {
      raw = await readFile(editionPath, "utf-8");
    } catch {
      console.warn(`  Skipping ${date}: no edition.json`);
      continue;
    }

    const edition = JSON.parse(raw);
    const pageCount = computePageCount(edition);
    const rawArticleCount = Array.isArray(edition.articles) ? edition.articles.length : 0;
    const articles = transformArticles(edition);
    const ads = transformAds(edition);
    const articleCount = articles.length;
    const droppedInAdapter = Math.max(0, rawArticleCount - articleCount);

    // Insert edition
    await sql`
      INSERT INTO editions (date, publication_info, page_count, article_count)
      VALUES (${date}, ${edition.publication_info || ""}, ${pageCount}, ${articleCount})
      ON CONFLICT (date) DO UPDATE SET
        publication_info = EXCLUDED.publication_info,
        page_count = EXCLUDED.page_count,
        article_count = EXCLUDED.article_count
    `;

    const preparedArticles = articles.map((a, i) => {
      const prepared = {
        ...a,
        position: i,
        category: sanitize(a.category),
        headline: sanitize(a.headline),
        summary: sanitize(a.summary),
        fullText: sanitize(a.fullText),
        bodyPlain: stripHtml(a.fullText),
        byline: sanitize(a.byline) ?? null,
        writerPosition: sanitize(a.writerPosition) ?? null,
        imageCaption: sanitize(a.imageCaption) ?? null,
      };
      const embeddingInput = buildEmbeddingInput({
        headline: prepared.headline,
        byline: prepared.byline,
        body_plain: prepared.bodyPlain,
        edition_date: prepared.date,
        category: prepared.category,
        summary: prepared.summary,
        image_caption: prepared.imageCaption,
      });
      return {
        ...prepared,
        embeddingInputHash: embeddingInputFingerprint(embeddingInput),
      };
    });

    if (preparedArticles.length > 0) {
      const articleQueries = preparedArticles.map((a) =>
        sql`INSERT INTO articles (id, edition_date, position, category, headline, summary, full_text, body_plain, byline, writer_position, page, is_hero, is_featured, image_urls, image_caption, image_captions, embedding_input_hash, embedding_input_version)
            VALUES (${a.id}, ${a.date}, ${a.position}, ${a.category}, ${a.headline}, ${a.summary}, ${a.fullText}, ${a.bodyPlain}, ${a.byline}, ${a.writerPosition}, ${a.page}, ${a.isHero}, ${a.isFeatured}, ${JSON.stringify(a.imageUrls)}, ${a.imageCaption}, ${JSON.stringify(a.imageCaptions)}, ${a.embeddingInputHash}, ${EMBEDDING_INPUT_VERSION})
            ON CONFLICT (id) DO UPDATE SET
              category = EXCLUDED.category,
              headline = EXCLUDED.headline,
              summary = EXCLUDED.summary,
              full_text = EXCLUDED.full_text,
              body_plain = EXCLUDED.body_plain,
              byline = EXCLUDED.byline,
              writer_position = EXCLUDED.writer_position,
              page = EXCLUDED.page,
              is_hero = EXCLUDED.is_hero,
              is_featured = EXCLUDED.is_featured,
              image_urls = EXCLUDED.image_urls,
              image_caption = EXCLUDED.image_caption,
              image_captions = EXCLUDED.image_captions,
              embedding = CASE
                WHEN articles.embedding_input_hash = EXCLUDED.embedding_input_hash
                 AND articles.embedding_input_version = EXCLUDED.embedding_input_version
                 AND articles.embedding_model = ${EMBEDDING_MODEL}
                THEN articles.embedding ELSE NULL END,
              embedding_model = CASE
                WHEN articles.embedding_input_hash = EXCLUDED.embedding_input_hash
                 AND articles.embedding_input_version = EXCLUDED.embedding_input_version
                 AND articles.embedding_model = ${EMBEDDING_MODEL}
                THEN articles.embedding_model ELSE NULL END,
              embedding_input_hash = EXCLUDED.embedding_input_hash,
              embedding_input_version = EXCLUDED.embedding_input_version`
      );
      await sql.transaction(articleQueries);
    }

    // Remove only records that genuinely disappeared. Existing IDs are
    // updated in place so unchanged vectors remain reusable.
    const articleIds = preparedArticles.map((article) => article.id);
    if (articleIds.length > 0) {
      await sql`DELETE FROM articles
                WHERE edition_date = ${date} AND NOT (id = ANY(${articleIds}))`;
    } else {
      await sql`DELETE FROM articles WHERE edition_date = ${date}`;
    }

    const chunkRecords = preparedArticles.flatMap((article) =>
      buildArticleChunkRecords({
        id: article.id,
        headline: article.headline,
        byline: article.byline,
        body_plain: article.bodyPlain,
        edition_date: article.date,
        category: article.category,
        summary: article.summary,
      }),
    );
    if (chunkRecords.length > 0) {
      await sql.transaction(
        chunkRecords.map((chunk) =>
          sql`INSERT INTO article_chunks (id, article_id, chunk_index, chunk_text, embedding_input_hash, embedding_input_version)
              VALUES (${chunk.id}, ${chunk.articleId}, ${chunk.chunkIndex}, ${chunk.chunkText}, ${chunk.embeddingInputHash}, ${EMBEDDING_INPUT_VERSION})
              ON CONFLICT (id) DO UPDATE SET
                chunk_index = EXCLUDED.chunk_index,
                chunk_text = EXCLUDED.chunk_text,
                embedding = CASE
                  WHEN article_chunks.embedding_input_hash = EXCLUDED.embedding_input_hash
                   AND article_chunks.embedding_input_version = EXCLUDED.embedding_input_version
                   AND article_chunks.embedding_model = ${EMBEDDING_MODEL}
                  THEN article_chunks.embedding ELSE NULL END,
                embedding_model = CASE
                  WHEN article_chunks.embedding_input_hash = EXCLUDED.embedding_input_hash
                   AND article_chunks.embedding_input_version = EXCLUDED.embedding_input_version
                   AND article_chunks.embedding_model = ${EMBEDDING_MODEL}
                  THEN article_chunks.embedding_model ELSE NULL END,
                embedding_input_hash = EXCLUDED.embedding_input_hash,
                embedding_input_version = EXCLUDED.embedding_input_version`,
        ),
      );
      const chunkIds = chunkRecords.map((chunk) => chunk.id);
      await sql`DELETE FROM article_chunks
                WHERE article_id = ANY(${articleIds}) AND NOT (id = ANY(${chunkIds}))`;
    }

    const imageRecords = preparedArticles.flatMap((article) =>
      (article.imageUrls ?? []).map((imageUrl, imageIndex) => ({
        id: `${article.id}:image:${String(imageIndex).padStart(3, "0")}`,
        articleId: article.id,
        imageIndex,
        imageUrl,
        caption: article.imageCaptions?.[imageIndex] ??
          (imageIndex === 0 ? article.imageCaption : null),
      })),
    );
    if (imageRecords.length > 0) {
      await sql.transaction(
        imageRecords.map((image) =>
          sql`INSERT INTO article_images (id, article_id, image_index, image_url, caption)
              VALUES (${image.id}, ${image.articleId}, ${image.imageIndex}, ${image.imageUrl}, ${image.caption})
              ON CONFLICT (id) DO UPDATE SET
                image_index = EXCLUDED.image_index,
                image_url = EXCLUDED.image_url,
                caption = EXCLUDED.caption,
                embedding = CASE
                  WHEN article_images.image_url = EXCLUDED.image_url
                   AND article_images.caption IS NOT DISTINCT FROM EXCLUDED.caption
                  THEN article_images.embedding ELSE NULL END,
                embedding_model = CASE
                  WHEN article_images.image_url = EXCLUDED.image_url
                   AND article_images.caption IS NOT DISTINCT FROM EXCLUDED.caption
                  THEN article_images.embedding_model ELSE NULL END,
                embedding_input_version = CASE
                  WHEN article_images.image_url = EXCLUDED.image_url
                   AND article_images.caption IS NOT DISTINCT FROM EXCLUDED.caption
                  THEN article_images.embedding_input_version ELSE NULL END,
                embedding_input_hash = CASE
                  WHEN article_images.image_url = EXCLUDED.image_url
                   AND article_images.caption IS NOT DISTINCT FROM EXCLUDED.caption
                  THEN article_images.embedding_input_hash ELSE NULL END`,
        ),
      );
      const imageIds = imageRecords.map((image) => image.id);
      await sql`DELETE FROM article_images
                WHERE article_id = ANY(${articleIds}) AND NOT (id = ANY(${imageIds}))`;
    } else if (articleIds.length > 0) {
      await sql`DELETE FROM article_images WHERE article_id = ANY(${articleIds})`;
    }

    // Insert ads in a transaction
    if (ads.length > 0) {
      // Delete existing ads for this edition first (serial PK, no upsert)
      await sql`DELETE FROM ads WHERE edition_date = ${date}`;

      const adQueries = ads.map((ad, i) =>
        sql`INSERT INTO ads (edition_date, position, title, body, category, ad_type, display_text, phone, address, price, image_urls)
            VALUES (${date}, ${i}, ${sanitize(ad.title)}, ${sanitize(ad.body)}, ${sanitize(ad.category) ?? null}, ${sanitize(ad.adType) ?? null}, ${sanitize(ad.displayText) ?? null}, ${sanitize(ad.phone) ?? null}, ${sanitize(ad.address) ?? null}, ${sanitize(ad.price) ?? null}, ${JSON.stringify(ad.imageUrls ?? [])})`
      );
      await sql.transaction(adQueries);
    }

    console.log(
      `  ${date}: ${articles.length} articles (${droppedInAdapter} filtered), ${ads.length} ads, ${pageCount} pages`,
    );
    seeded.push({
      date,
      pageCount,
      rawArticleCount,
      articleCount: articles.length,
      droppedInAdapter,
      adCount: ads.length,
      editionPath,
    });
  }
  return seeded;
}

// ─── Seed Weather ────────────────────────────────────────────────

async function seedWeather() {
  let raw;
  try {
    raw = await readFile(WEATHER_INDEX, "utf-8");
  } catch {
    console.warn("Weather index file not found, skipping weather seed.");
    return;
  }

  const archive = JSON.parse(raw);
  if (!archive || !Array.isArray(archive.tmax_c) || !Array.isArray(archive.tmin_c)) {
    console.warn("Weather index file is not in expected slim format, skipping weather seed.");
    return;
  }

  const startMs = Date.UTC(
    Number(archive.start_date.slice(0, 4)),
    Number(archive.start_date.slice(5, 7)) - 1,
    Number(archive.start_date.slice(8, 10)),
  );
  const totalDays = archive.tmax_c.length;
  const isEstimated = typeof archive.is_estimated === "string" ? archive.is_estimated : "";

  const records = [];
  for (let i = 0; i < totalDays; i += 1) {
    const date = new Date(startMs + i * 86400000).toISOString().slice(0, 10);
    records.push({
      date,
      tmax_c: archive.tmax_c[i],
      tmin_c: archive.tmin_c[i],
      is_estimated: isEstimated[i] === "1",
    });
  }

  console.log(`Seeding ${records.length} weather records...`);

  // Batch insert in chunks of 500
  const BATCH_SIZE = 500;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const queries = batch.map((r) =>
      sql`INSERT INTO weather (date, scope, tmax_c, tmin_c, precip_mm, source, source_station_id, quality_flag, is_estimated)
          VALUES (${r.date}, ${"delaware"}, ${r.tmax_c ?? null}, ${r.tmin_c ?? null}, ${null}, ${"NOAA_GHCN_DAILY_ARCHIVE"}, ${null}, ${null}, ${r.is_estimated})
          ON CONFLICT (date, scope) DO UPDATE SET
            tmax_c = EXCLUDED.tmax_c,
            tmin_c = EXCLUDED.tmin_c,
            precip_mm = EXCLUDED.precip_mm,
            source = EXCLUDED.source,
            source_station_id = EXCLUDED.source_station_id,
            quality_flag = EXCLUDED.quality_flag,
            is_estimated = EXCLUDED.is_estimated`
    );
    await sql.transaction(queries);
  }

  console.log(`  Weather: ${records.length} records seeded.`);
}

// ─── Seed Music ──────────────────────────────────────────────────

async function seedMusic() {
  let raw;
  try {
    raw = await readFile(MUSIC_ARCHIVE, "utf-8");
  } catch {
    console.warn("Music archive not found, skipping music seed.");
    return;
  }

  const archive = JSON.parse(raw);
  if (!archive || !Array.isArray(archive.months) || typeof archive.start !== "string") {
    console.warn("Music archive is not in expected packed format, skipping music seed.");
    return;
  }

  const startYearMatch = /^(\d{4})-\d{2}$/.exec(archive.start);
  if (!startYearMatch) {
    console.warn(`Music archive has invalid start "${archive.start}", skipping music seed.`);
    return;
  }
  const startYear = Number(startYearMatch[1]);

  console.log(
    `Seeding music from packed archive (${archive.months.length} month buckets, starting ${archive.start})...`,
  );

  let totalTracks = 0;

  for (let i = 0; i < archive.months.length; i += 1) {
    const monthTracks = archive.months[i];
    if (!Array.isArray(monthTracks) || monthTracks.length === 0) continue;

    const year = startYear + Math.floor(i / 12);
    const month = String((i % 12) + 1).padStart(2, "0");

    const queries = monthTracks.map((tuple, rankIdx) =>
      sql`INSERT INTO music (year, month, rank, title, artist, youtube_id)
          VALUES (${year}, ${month}, ${rankIdx + 1}, ${tuple[0]}, ${tuple[1]}, ${tuple[2]})
          ON CONFLICT (year, month, rank) DO UPDATE SET
            title = EXCLUDED.title,
            artist = EXCLUDED.artist,
            youtube_id = EXCLUDED.youtube_id`
    );
    await sql.transaction(queries);
    totalTracks += monthTracks.length;
  }

  console.log(`  Music: ${totalTracks} tracks seeded.`);
}

// ─── Build FTS Vectors ───────────────────────────────────────────

async function buildSearchVectors(scopedDate = "") {
  console.log("Building full-text search vectors...");

  if (scopedDate) {
    await sql`
      UPDATE articles SET search_vector =
        setweight(to_tsvector('english', coalesce(headline, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(byline, '')), 'C') ||
        setweight(to_tsvector('english', coalesce(body_plain, '')), 'C')
      WHERE edition_date = ${scopedDate}
    `;
  } else {
    await sql`
      UPDATE articles SET search_vector =
        setweight(to_tsvector('english', coalesce(headline, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(byline, '')), 'C') ||
        setweight(to_tsvector('english', coalesce(body_plain, '')), 'C')
    `;
  }

  console.log("  Search vectors built.");
}

// ─── Embed article chunks (optional — uses Vertex ADC) ───────────

async function embedArticles(scopedDate = "") {
  // Lazy-import so a data-only seed can still run without local ADC.
  let embedDocuments, buildEmbeddingInput, embeddingInputFingerprint;
  let hasGoogleCredentials, QuotaExhaustedError, EMBEDDING_MODEL, EMBEDDING_INPUT_VERSION;
  try {
    const mod = await import("../../src/lib/embeddings.ts");
    embedDocuments = mod.embedDocuments;
    buildEmbeddingInput = mod.buildEmbeddingInput;
    embeddingInputFingerprint = mod.embeddingInputFingerprint;
    hasGoogleCredentials = mod.hasGoogleCredentials;
    QuotaExhaustedError = mod.QuotaExhaustedError;
    EMBEDDING_MODEL = mod.EMBEDDING_MODEL;
    EMBEDDING_INPUT_VERSION = mod.EMBEDDING_INPUT_VERSION;
  } catch (err) {
    console.warn("Skipping embedding: could not load embeddings module.", err.message);
    return;
  }

  if (!hasGoogleCredentials()) {
    console.warn("Skipping embedding: GOOGLE_CLOUD_PROJECT is not set for Vertex ADC.");
    return;
  }

  const unembedded = scopedDate
    ? await sql`SELECT c.id, c.chunk_index, c.chunk_text, a.headline, a.byline, a.edition_date, a.category, a.summary
                FROM article_chunks c JOIN articles a ON a.id = c.article_id
                WHERE a.edition_date = ${scopedDate}
                  AND (c.embedding IS NULL OR c.embedding_model IS DISTINCT FROM ${EMBEDDING_MODEL}
                       OR c.embedding_input_version IS DISTINCT FROM ${EMBEDDING_INPUT_VERSION})
                ORDER BY c.id`
    : await sql`SELECT c.id, c.chunk_index, c.chunk_text, a.headline, a.byline, a.edition_date, a.category, a.summary
                FROM article_chunks c JOIN articles a ON a.id = c.article_id
                WHERE c.embedding IS NULL OR c.embedding_model IS DISTINCT FROM ${EMBEDDING_MODEL}
                   OR c.embedding_input_version IS DISTINCT FROM ${EMBEDDING_INPUT_VERSION}
                ORDER BY c.id`;
  if (unembedded.length === 0) {
    console.log("All article chunks already embedded.");
    return;
  }

  console.log(`Embedding ${unembedded.length} article chunks...`);

  const BATCH = 50;
  let done = 0;
  let failedBatches = 0;
  let quotaExhausted = false;
  const totalBatches = Math.ceil(unembedded.length / BATCH);

  for (let i = 0; i < unembedded.length; i += BATCH) {
    const batch = unembedded.slice(i, i + BATCH);
    const inputs = batch.map((chunk) => buildEmbeddingInput({
      headline: chunk.headline,
      byline: chunk.byline,
      body_plain: chunk.chunk_text,
      edition_date: chunk.edition_date,
      category: chunk.category,
      summary: chunk.chunk_index === 0 ? chunk.summary : null,
    }));

    try {
      const vectors = await embedDocuments(inputs, { op: "seed.embed-chunks" });
      const updates = batch.map((chunk, idx) => {
        const vecStr = `[${vectors[idx].join(",")}]`;
        const inputHash = embeddingInputFingerprint(inputs[idx]);
        return sql`UPDATE article_chunks
                   SET embedding = ${vecStr}::vector,
                       embedding_model = ${EMBEDDING_MODEL},
                       embedding_input_version = ${EMBEDDING_INPUT_VERSION},
                       embedding_input_hash = ${inputHash}
                   WHERE id = ${chunk.id}`;
      });
      await sql.transaction(updates);
      done += batch.length;
      console.log(`  Embedded ${done}/${unembedded.length}`);
    } catch (err) {
      // Hard stop on quota exhaustion — every subsequent batch will 429
      // anyway, so keep going wastes API calls and prolongs the run for
      // no benefit. See docs/issues/0028.
      if (QuotaExhaustedError && err instanceof QuotaExhaustedError) {
        console.warn(
          `  Quota exhausted at batch ${Math.floor(i / BATCH) + 1}/${totalBatches}; stopping early. Retry after quota reset.`,
        );
        quotaExhausted = true;
        break;
      }
      failedBatches++;
      console.error(`  Embedding batch error:`, err.message || err);
    }
  }

  console.log(`  Embedding complete: ${done} chunks.`);
  if (quotaExhausted) {
    throw new Error(
      `Embedding stopped early due to Gemini quota exhaustion; ${done} of ${unembedded.length} article(s) embedded. Retry after the daily quota reset.`,
    );
  }
  if (failedBatches > 0) {
    throw new Error(
      `Embedding failed: ${failedBatches} of ${totalBatches} batch(es) errored; ${done} article(s) embedded.`
    );
  }
}

// ─── Ensure Locked Editions ─────────────────────────────────────
// Copies gold-standard edition files into public/editions/ if missing.
// Called before seeding so locked editions always survive a --reset.

async function ensureLockedEditions() {
  const lockedDates = Object.keys(LOCKED_EDITIONS);
  if (lockedDates.length === 0) return;

  if (isUnlock) {
    console.log(`⚠  --unlock: skipping protection for ${lockedDates.length} locked edition(s).`);
    return;
  }

  console.log(`Locked editions: ${lockedDates.join(", ")}`);

  for (const date of lockedDates) {
    const config = LOCKED_EDITIONS[date];
    const targetDir = path.join(ACTIVE_EDITIONS_DIR, date);
    const targetJson = path.join(targetDir, "edition.json");
    const sourcePath = path.resolve(ROOT, config.source);

    if (existsSync(targetJson)) {
      console.log(`  ${date}: ✓ already in place (${config.reason})`);
      continue;
    }

    if (!existsSync(sourcePath)) {
      console.error(`  ${date}: ✗ gold source missing at ${config.source} — cannot restore!`);
      continue;
    }

    // Restore edition.json
    await mkdir(targetDir, { recursive: true });
    await copyFile(sourcePath, targetJson);
    console.log(`  ${date}: restored edition.json from ${config.source}`);

    // Restore images
    if (config.images) {
      const imagesSource = path.resolve(ROOT, config.images);
      const imagesTarget = path.join(targetDir, "images");
      if (existsSync(imagesSource)) {
        await mkdir(imagesTarget, { recursive: true });
        const files = await readdir(imagesSource);
        let copied = 0;
        for (const file of files) {
          const src = path.join(imagesSource, file);
          const dest = path.join(imagesTarget, file);
          if (!existsSync(dest)) {
            await copyFile(src, dest);
            copied++;
          }
        }
        console.log(`  ${date}: restored ${copied} image(s)`);
      }
    }
  }
}

async function main() {
  const start = Date.now();

  console.log(`\nThe Transcript Archive — Database Seed`);
  console.log(`Mode: ${isReset ? "RESET (truncate + re-seed)" : "UPSERT"}${targetDate ? ` | DATE=${targetDate}` : ""}\n`);

  // Data-only preflight: both modes require a fully migrated database.
  await assertMigrationsCurrent(createNeonExecutor(process.env.DATABASE_URL));

  const summary = {
    mode: isReset ? "reset" : "upsert",
    targetDate: targetDate || null,
    editionsDir: ACTIVE_EDITIONS_DIR,
    startedAt: new Date().toISOString(),
    reset: isReset,
    editions: [],
    weatherSeeded: false,
    musicSeeded: false,
    searchVectorsScoped: Boolean(targetDate),
    embeddingsScoped: Boolean(targetDate),
  };

  let savedLockedData = null;
  if (isReset) {
    savedLockedData = await exportLockedEditions();
    await truncateSeedTables();
  }

  await restoreLockedEditions(savedLockedData);
  await ensureLockedEditions();
  summary.editions = await seedEditions(targetDate);
  if (!targetDate) {
    await seedWeather();
    await seedMusic();
    summary.weatherSeeded = true;
    summary.musicSeeded = true;
  } else {
    console.log(`Skipping weather/music seed in date-scoped mode (${targetDate}).`);
  }
  await buildSearchVectors(targetDate);
  await embedArticles(targetDate);

  // Run ANALYZE for query planner optimization
  await sql`ANALYZE editions`;
  await sql`ANALYZE articles`;
  await sql`ANALYZE article_chunks`;
  await sql`ANALYZE article_images`;
  await sql`ANALYZE ads`;
  await sql`ANALYZE weather`;
  await sql`ANALYZE music`;

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  summary.elapsedSeconds = Number(elapsed);
  summary.completedAt = new Date().toISOString();

  if (summaryPath) {
    const { writeFile } = await import("fs/promises");
    await mkdir(path.dirname(summaryPath), { recursive: true });
    await writeFile(summaryPath, JSON.stringify(summary, null, 2) + "\n", "utf-8");
    console.log(`Seed summary written to ${summaryPath}`);
  }
  console.log(`\nDone in ${elapsed}s.`);
  console.log(
    "\nNote: the running Next.js server caches the editions list (tag \"editions\")\n" +
      "      for up to 1h. To drop the cache immediately:\n" +
      "\n" +
      "        curl -X POST <host>/api/admin/revalidate \\\n" +
      "          -H \"X-Admin-Token: $ADMIN_REVALIDATE_TOKEN\"\n" +
      "\n" +
      "      Or redeploy. See CLAUDE.md → Environment Variables for the token setup."
  );
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
