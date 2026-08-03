/**
 * Deterministic DML backfill of chunk/image records.
 *
 * Rebuilds article_chunks and article_images rows from the articles table
 * without calling Google APIs. The schema comes from `npm run db:migrate`;
 * this script never runs DDL and refuses to run against an unmigrated
 * database. Run `npm run db:embed` afterward to generate stable
 * gemini-embedding-2 vectors.
 */

import { neon } from "@neondatabase/serverless";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(scriptDir, "../../.env.local");
if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
        const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/);
        if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
}
if (!process.env.DATABASE_URL) {
    console.error("ERROR: DATABASE_URL is required.");
    process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const { buildArticleChunkRecords } = await import("../../src/lib/article-chunking.ts");
const { EMBEDDING_INPUT_VERSION } = await import("../../src/lib/embeddings.ts");

// .mjs importing .ts named exports needs the default-interop pattern (tsx
// compiles .ts to CJS because package.json has no "type":"module").
const migrationRunnerModule = await import("./lib/migration-runner.ts");
const { assertMigrationsCurrent } = migrationRunnerModule.default ?? migrationRunnerModule;
const neonExecutorModule = await import("./lib/neon-executor.ts");
const { createNeonExecutor } = neonExecutorModule.default ?? neonExecutorModule;

async function backfillRecords() {
    const articles = await sql`
        SELECT id, headline, byline, body_plain, edition_date, category, summary,
               image_urls, image_caption, image_captions
        FROM articles ORDER BY id
    `;
    const batchSize = 100;
    let chunkCount = 0;
    let imageCount = 0;

    for (let offset = 0; offset < articles.length; offset += batchSize) {
        const batch = articles.slice(offset, offset + batchSize);
        const articleIds = batch.map((article) => article.id);
        const chunkRecords = batch.flatMap((article) =>
            buildArticleChunkRecords({
                id: article.id,
                headline: article.headline,
                byline: article.byline,
                body_plain: article.body_plain,
                edition_date: article.edition_date,
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
                            THEN article_chunks.embedding ELSE NULL END,
                          embedding_model = CASE
                            WHEN article_chunks.embedding_input_hash = EXCLUDED.embedding_input_hash
                             AND article_chunks.embedding_input_version = EXCLUDED.embedding_input_version
                            THEN article_chunks.embedding_model ELSE NULL END,
                          embedding_input_version = EXCLUDED.embedding_input_version,
                          embedding_input_hash = EXCLUDED.embedding_input_hash`,
                ),
            );
            chunkCount += chunkRecords.length;
        }
        const chunkIds = chunkRecords.map((chunk) => chunk.id);
        if (chunkIds.length > 0) {
            await sql`DELETE FROM article_chunks
                      WHERE article_id = ANY(${articleIds})
                        AND NOT (id = ANY(${chunkIds}))`;
        } else {
            await sql`DELETE FROM article_chunks WHERE article_id = ANY(${articleIds})`;
        }

        const imageRecords = batch.flatMap((article) =>
            (article.image_urls ?? []).map((imageUrl, imageIndex) => ({
                id: `${article.id}:image:${String(imageIndex).padStart(3, "0")}`,
                articleId: article.id,
                imageIndex,
                imageUrl,
                caption:
                    article.image_captions?.[imageIndex] ??
                    (imageIndex === 0 ? article.image_caption : null),
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
            imageCount += imageRecords.length;
        }
        const imageIds = imageRecords.map((image) => image.id);
        if (imageIds.length > 0) {
            await sql`DELETE FROM article_images
                      WHERE article_id = ANY(${articleIds})
                        AND NOT (id = ANY(${imageIds}))`;
        } else {
            await sql`DELETE FROM article_images WHERE article_id = ANY(${articleIds})`;
        }
        console.log(`  ${Math.min(offset + batch.length, articles.length)}/${articles.length} articles indexed`);
    }
    return { articles: articles.length, chunks: chunkCount, images: imageCount };
}

async function main() {
    console.log("RAG chunk/image record backfill (no model calls, no DDL)\n");
    await assertMigrationsCurrent(createNeonExecutor(process.env.DATABASE_URL));
    const counts = await backfillRecords();
    await sql`ANALYZE articles`;
    await sql`ANALYZE article_chunks`;
    await sql`ANALYZE article_images`;
    console.log(`\nBackfilled ${counts.articles} articles, ${counts.chunks} chunks, and ${counts.images} images.`);
    console.log("Next: run `npm run db:embed` to create stable text/image vectors.");
}

main().catch((error) => {
    console.error("RAG record backfill failed:", error);
    process.exit(1);
});
