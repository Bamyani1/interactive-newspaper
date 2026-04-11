/**
 * Database Seed Script
 *
 * Reads edition JSON files, weather index, and music data from the filesystem,
 * transforms them using ocr-adapter functions, and inserts into Neon PostgreSQL.
 *
 * Locked editions (defined in locked-editions.json) are automatically restored
 * from their gold source on every --reset, preventing accidental deletion.
 *
 * Usage:
 *   npm run db:seed              — insert data (skip existing editions)
 *   npm run db:reset             — drop all tables, recreate, and re-seed
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

const ROOT = path.resolve(__dirnameEnv, "../..");
const EDITIONS_DIR = path.join(ROOT, "public", "editions");
const WEATHER_INDEX = path.join(
  ROOT,
  "public/data/weather/ohio/index/delaware-by-date-1950-2000.json",
);
const MUSIC_DIR = path.join(ROOT, "public/top-10-music");
const SCHEMA_FILE = path.join(__dirnameEnv, "schema.sql");

const isReset = process.argv.includes("--reset");
const isUnlock = process.argv.includes("--unlock");

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

// ─── Schema ──────────────────────────────────────────────────────

async function applySchema() {
  const schemaSql = await readFile(SCHEMA_FILE, "utf-8");

  // Strip SQL comment lines, then split by semicolon
  const cleaned = schemaSql.replace(/--.*$/gm, "");
  const statements = cleaned
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    await sql.query(stmt);
  }

  console.log("Schema applied.");
}

// ─── DB-Level Lock: Export / Restore ────────────────────────────
// Saves locked edition data from the database before DROP, then
// re-inserts after schema recreation. This protects the gold edition
// even on machines that don't have the gold source files locally.

async function exportLockedEditions() {
  const lockedDates = Object.keys(LOCKED_EDITIONS);
  if (lockedDates.length === 0 || isUnlock) return null;

  const saved = {};
  for (const date of lockedDates) {
    try {
      const [edition] = await sql`SELECT * FROM editions WHERE date = ${date}`;
      if (!edition) continue;
      const articles = await sql`SELECT id, edition_date, position, category, headline, summary, full_text, body_plain, byline, writer_position, page, is_hero, is_featured, image_urls, image_caption, image_captions, embedding, embedding_model FROM articles WHERE edition_date = ${date} ORDER BY position`;
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
        sql`INSERT INTO articles (id, edition_date, position, category, headline, summary, full_text, body_plain, byline, writer_position, page, is_hero, is_featured, image_urls, image_caption, image_captions, embedding, embedding_model)
            VALUES (${a.id}, ${a.edition_date}, ${a.position}, ${a.category}, ${a.headline}, ${a.summary}, ${a.full_text}, ${a.body_plain}, ${a.byline}, ${a.writer_position}, ${a.page}, ${a.is_hero}, ${a.is_featured}, ${JSON.stringify(a.image_urls)}, ${a.image_caption}, ${JSON.stringify(a.image_captions)}, ${a.embedding}, ${a.embedding_model})
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

async function dropAllTables() {
  await sql`DROP TABLE IF EXISTS music CASCADE`;
  await sql`DROP TABLE IF EXISTS weather CASCADE`;
  await sql`DROP TABLE IF EXISTS ads CASCADE`;
  await sql`DROP TABLE IF EXISTS articles CASCADE`;
  await sql`DROP TABLE IF EXISTS editions CASCADE`;
  console.log("All tables dropped.");
}

// ─── Seed Editions ───────────────────────────────────────────────

async function seedEditions(scopedDate = "") {
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

    // Delete existing articles for this edition, then re-insert.
    // This ensures articles removed by adapter filters are also removed from the DB.
    await sql`DELETE FROM articles WHERE edition_date = ${date}`;

    if (articles.length > 0) {
      const articleQueries = articles.map((a, i) =>
        sql`INSERT INTO articles (id, edition_date, position, category, headline, summary, full_text, body_plain, byline, writer_position, page, is_hero, is_featured, image_urls, image_caption, image_captions)
            VALUES (${a.id}, ${a.date}, ${i}, ${sanitize(a.category)}, ${sanitize(a.headline)}, ${sanitize(a.summary)}, ${sanitize(a.fullText)}, ${stripHtml(a.fullText)}, ${sanitize(a.byline) ?? null}, ${sanitize(a.writerPosition) ?? null}, ${a.page}, ${a.isHero}, ${a.isFeatured}, ${JSON.stringify(a.imageUrls)}, ${sanitize(a.imageCaption) ?? null}, ${JSON.stringify(a.imageCaptions)})
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
              image_captions = EXCLUDED.image_captions`
      );
      await sql.transaction(articleQueries);
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

  const records = JSON.parse(raw);
  console.log(`Seeding ${records.length} weather records...`);

  // Batch insert in chunks of 500
  const BATCH_SIZE = 500;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const queries = batch.map((r) =>
      sql`INSERT INTO weather (date, scope, tmax_c, tmin_c, precip_mm, source, source_station_id, quality_flag, is_estimated)
          VALUES (${r.date}, ${"delaware"}, ${r.tmax_c ?? null}, ${r.tmin_c ?? null}, ${r.precip_mm ?? null}, ${r.source}, ${r.source_station_id ?? null}, ${r.quality_flag ?? null}, ${r.is_estimated ?? false})
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
  let files;
  try {
    files = await readdir(MUSIC_DIR);
  } catch {
    console.warn("Music directory not found, skipping music seed.");
    return;
  }

  const jsonFiles = files.filter((f) => f.endsWith(".json")).sort();
  console.log(`Seeding music from ${jsonFiles.length} year file(s)...`);

  let totalTracks = 0;

  for (const file of jsonFiles) {
    const year = parseInt(path.basename(file, ".json"), 10);
    if (isNaN(year)) continue;

    const raw = await readFile(path.join(MUSIC_DIR, file), "utf-8");
    const data = JSON.parse(raw); // { "01": [...], "02": [...], ... }

    for (const [month, tracks] of Object.entries(data)) {
      if (!Array.isArray(tracks) || tracks.length === 0) continue;

      const queries = tracks.map((t) =>
        sql`INSERT INTO music (year, month, rank, title, artist, youtube_id)
            VALUES (${year}, ${month}, ${t.rank}, ${t.title}, ${t.artist}, ${t.youtube_id})
            ON CONFLICT (year, month, rank) DO UPDATE SET
              title = EXCLUDED.title,
              artist = EXCLUDED.artist,
              youtube_id = EXCLUDED.youtube_id`
      );
      await sql.transaction(queries);
      totalTracks += tracks.length;
    }
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
        setweight(to_tsvector('english', coalesce(byline, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(body_plain, '')), 'C')
      WHERE edition_date = ${scopedDate}
    `;
  } else {
    await sql`
      UPDATE articles SET search_vector =
        setweight(to_tsvector('english', coalesce(headline, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(byline, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(body_plain, '')), 'C')
    `;
  }

  console.log("  Search vectors built.");
}

// ─── Embed Articles (optional — requires GEMINI_API_KEY) ─────────

async function embedArticles(scopedDate = "") {
  // Lazy-import to avoid errors when the key is not set
  let embedDocuments, buildEmbeddingText, hasApiKey;
  try {
    const mod = await import("../../src/lib/embeddings.ts");
    embedDocuments = mod.embedDocuments;
    buildEmbeddingText = mod.buildEmbeddingText;
    hasApiKey = mod.hasApiKey;
  } catch (err) {
    console.warn("Skipping embedding: could not load embeddings module.", err.message);
    return;
  }

  if (!hasApiKey()) {
    console.warn("Skipping embedding: GEMINI_API_KEY not set.");
    return;
  }

  const unembedded = scopedDate
    ? await sql`SELECT id, headline, byline, body_plain, edition_date, category FROM articles WHERE embedding IS NULL AND edition_date = ${scopedDate} ORDER BY id`
    : await sql`SELECT id, headline, byline, body_plain, edition_date, category FROM articles WHERE embedding IS NULL ORDER BY id`;
  if (unembedded.length === 0) {
    console.log("All articles already embedded.");
    return;
  }

  console.log(`Embedding ${unembedded.length} articles...`);

  const BATCH = 50;
  let done = 0;

  for (let i = 0; i < unembedded.length; i += BATCH) {
    const batch = unembedded.slice(i, i + BATCH);
    const texts = batch.map((a) => buildEmbeddingText({ headline: a.headline, byline: a.byline, body_plain: a.body_plain, edition_date: a.edition_date, category: a.category }));

    try {
      const vectors = await embedDocuments(texts);
      const updates = batch.map((a, idx) => {
        const vecStr = `[${vectors[idx].join(",")}]`;
        return sql`UPDATE articles SET embedding = ${vecStr}::vector WHERE id = ${a.id}`;
      });
      await sql.transaction(updates);
      done += batch.length;
      console.log(`  Embedded ${done}/${unembedded.length}`);
    } catch (err) {
      console.error(`  Embedding batch error:`, err.message || err);
    }
  }

  console.log(`  Embedding complete: ${done} articles.`);
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

  console.log(`\nTranscript Archive — Database Seed`);
  console.log(`Mode: ${isReset ? "RESET (drop + recreate)" : "UPSERT"}${targetDate ? ` | DATE=${targetDate}` : ""}\n`);

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
    await dropAllTables();
  }

  await applySchema();
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
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
