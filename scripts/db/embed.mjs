/**
 * Embedding Script
 *
 * Generates semantic embeddings for all articles in the database that don't
 * have one yet. Uses gemini-embedding-2-preview via the shared embeddings utility.
 *
 * Usage:
 *   npm run db:embed              — embed articles missing embeddings
 *   npm run db:embed -- --force   — re-embed all articles
 *   npm run db:embed -- --dry-run — estimate cost without calling the API
 */

import { neon } from "@neondatabase/serverless";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Load .env.local
const __dirnameEnv = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirnameEnv, "../../.env.local");
if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
        const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/);
        if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
}

// Dynamic import: tsx transpiles .ts → CJS at runtime; static named imports
// from .ts files don't work in .mjs because Node resolves exports before tsx runs.
const { embedDocuments, buildEmbeddingText, buildEmbeddingInput, hasApiKey, EMBEDDING_DIMS, EMBEDDING_MODEL } =
    await import("../../src/lib/embeddings.ts");

const isForce = process.argv.includes("--force");
const isDryRun = process.argv.includes("--dry-run");

if (!process.env.DATABASE_URL) {
    console.error("ERROR: DATABASE_URL environment variable is required.");
    process.exit(1);
}

if (!isDryRun && !hasApiKey()) {
    console.error("ERROR: GEMINI_API_KEY or GOOGLE_API_KEY environment variable is required.");
    console.error(
        "Set it in .env.local or export it before running this script.",
    );
    process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const BATCH_SIZE = 50; // articles per embedding API call

const EDITIONS_DIR = path.resolve(__dirnameEnv, "../../public/editions");

/**
 * Load the first image for an article as base64.
 * Returns null if no images or file not found.
 */
function loadFirstImage(article) {
    const imageUrls = article.image_urls;
    if (!imageUrls || imageUrls.length === 0) return null;

    const firstUrl = imageUrls[0];
    // Extract date and filename from URL patterns:
    //   /api/editions/DATE/images/FILE or https://cdn/DATE/images/FILE
    const match = firstUrl.match(/(\d{4}-\d{2}-\d{2})\/images\/(.+?)$/);
    if (!match) return null;

    const [, date, rawName] = match;
    // Strip .webp extension if present (CDN converts to webp, but local files are jpg)
    const baseName = rawName.replace(/\.webp$/i, "");

    // Try common extensions
    for (const ext of [".jpg", ".jpeg", ".png", ""]) {
        const filePath = path.join(EDITIONS_DIR, date, "images", baseName + ext);
        if (existsSync(filePath)) {
            try {
                const buf = readFileSync(filePath);
                const mimeType = ext === ".png" ? "image/png" : "image/jpeg";
                return { base64: buf.toString("base64"), mimeType };
            } catch {
                return null;
            }
        }
    }
    return null;
}

async function main() {
    const start = Date.now();

    console.log(`\nThe Transcript Archive — Embedding Generator`);
    console.log(
        `Mode: ${isForce ? "FORCE (re-embed all)" : isDryRun ? "DRY RUN (estimate only)" : "INCREMENTAL (skip existing)"}\n`,
    );

    // Fetch articles that need embedding (include edition_date + category + summary + image_caption for contextual embedding)
    const articles = isForce
        ? await sql`SELECT id, headline, byline, body_plain, edition_date, category, summary, image_caption, image_urls FROM articles ORDER BY id`
        : await sql`SELECT id, headline, byline, body_plain, edition_date, category, summary, image_caption, image_urls FROM articles WHERE embedding IS NULL ORDER BY id`;

    if (articles.length === 0) {
        console.log("All articles already have embeddings. Nothing to do.");
        console.log('Use --force to re-embed all articles.');
        return;
    }

    // Estimate cost
    const totalChars = articles.reduce(
        (sum, a) =>
            sum +
            buildEmbeddingText({
                headline: a.headline,
                byline: a.byline,
                body_plain: a.body_plain,
                edition_date: a.edition_date,
                category: a.category,
                summary: a.summary,
                image_caption: a.image_caption,
            }).length,
        0,
    );
    const estimatedTokens = Math.ceil(totalChars / 4);
    const estimatedCost = (estimatedTokens / 1_000_000) * 0.20; // gemini-embedding-2-preview pricing

    console.log(`Articles to embed: ${articles.length}`);
    console.log(
        `Estimated tokens: ${estimatedTokens.toLocaleString()} (~${totalChars.toLocaleString()} chars)`,
    );
    console.log(`Estimated cost: $${estimatedCost.toFixed(4)}`);
    console.log(`Embedding dimensions: ${EMBEDDING_DIMS}`);
    console.log();

    if (isDryRun) {
        console.log("Dry run complete. No API calls made.");
        return;
    }

    // Process in batches
    let embedded = 0;
    let errors = 0;
    let consecutiveFailures = 0;

    for (let i = 0; i < articles.length; i += BATCH_SIZE) {
        const batch = articles.slice(i, i + BATCH_SIZE);
        const inputs = batch.map((a) => {
            const img = loadFirstImage(a);
            return buildEmbeddingInput({
                headline: a.headline,
                byline: a.byline,
                body_plain: a.body_plain,
                edition_date: a.edition_date,
                category: a.category,
                summary: a.summary,
                image_caption: a.image_caption,
                imageBase64: img?.base64,
                imageMimeType: img?.mimeType,
            });
        });
        const imagesInBatch = inputs.filter((i) => i.imageBase64).length;

        try {
            const vectors = await embedDocuments(inputs);

            // Update each article with its embedding
            const updateQueries = batch.map((article, idx) => {
                const vecStr = `[${vectors[idx].join(",")}]`;
                return sql`UPDATE articles SET embedding = ${vecStr}::vector, embedding_model = ${EMBEDDING_MODEL} WHERE id = ${article.id}`;
            });
            await sql.transaction(updateQueries);

            embedded += batch.length;
            consecutiveFailures = 0;
            const pct = ((embedded / articles.length) * 100).toFixed(0);
            console.log(
                `  Embedded ${embedded}/${articles.length} articles (${pct}%) [${imagesInBatch} with images]`,
            );
        } catch (err) {
            errors += batch.length;
            console.error(
                `  ERROR embedding batch starting at index ${i}:`,
                err.message || err,
            );

            // Retry with exponential backoff
            consecutiveFailures++;
            const retryDelay = Math.min(2000 * Math.pow(2, consecutiveFailures - 1), 30000);
            console.log(`  Retrying in ${retryDelay / 1000}s...`);
            await new Promise((r) => setTimeout(r, retryDelay));

            try {
                const vectors = await embedDocuments(inputs);
                const updateQueries = batch.map((article, idx) => {
                    const vecStr = `[${vectors[idx].join(",")}]`;
                    return sql`UPDATE articles SET embedding = ${vecStr}::vector, embedding_model = ${EMBEDDING_MODEL} WHERE id = ${article.id}`;
                });
                await sql.transaction(updateQueries);

                embedded += batch.length;
                errors -= batch.length;
                consecutiveFailures = 0;
                console.log(`  Retry succeeded: ${embedded}/${articles.length}`);
            } catch (retryErr) {
                console.error(`  Retry also failed:`, retryErr.message || retryErr);
            }
        }
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\nDone in ${elapsed}s.`);
    console.log(`  Embedded: ${embedded}`);
    if (errors > 0) console.log(`  Errors: ${errors}`);
}

main().catch((err) => {
    console.error("Embedding failed:", err);
    process.exit(1);
});
