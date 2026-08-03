/**
 * RAG embedding backfill
 *
 * Text and visual evidence are intentionally stored separately:
 *   - article_chunks: sentence-aware text chunks
 *   - article_images: one vector per image
 *
 * Usage:
 *   npm run db:embed
 *   npm run db:embed -- --dry-run
 */

import { neon } from "@neondatabase/serverless";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirnameEnv = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirnameEnv, "../../.env.local");
if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
        const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/);
        if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
}

const {
    embedDocuments,
    buildEmbeddingInput,
    embeddingInputFingerprint,
    hasGoogleCredentials,
    EMBEDDING_DIMS,
    EMBEDDING_MODEL,
    EMBEDDING_INPUT_VERSION,
    IMAGE_EMBEDDING_INPUT_VERSION,
    QuotaExhaustedError,
} = await import("../../src/lib/embeddings.ts");

const isDryRun = process.argv.includes("--dry-run");
const BATCH_SIZE = 50;
const EDITIONS_DIR = path.resolve(__dirnameEnv, "../../public/editions");

if (!process.env.DATABASE_URL) {
    console.error("ERROR: DATABASE_URL environment variable is required.");
    process.exit(1);
}
if (!isDryRun && !hasGoogleCredentials()) {
    console.error("ERROR: GOOGLE_CLOUD_PROJECT is required for Vertex AI ADC.");
    process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

function loadImage(imageUrl) {
    let pathname = imageUrl;
    try {
        pathname = new URL(imageUrl, "http://local.invalid").pathname;
    } catch {
        // Continue with the raw path.
    }
    const match = pathname.match(/(\d{4}-\d{2}-\d{2})\/images\/(.+?)$/);
    if (!match) return null;

    const [, date, encodedName] = match;
    const rawName = decodeURIComponent(encodedName);
    const baseName = rawName.replace(/\.webp$/i, "");
    for (const ext of [".jpg", ".jpeg", ".png", ""]) {
        const filePath = path.join(EDITIONS_DIR, date, "images", baseName + ext);
        if (!existsSync(filePath)) continue;
        const bytes = readFileSync(filePath);
        return {
            base64: bytes.toString("base64"),
            mimeType: ext === ".png" ? "image/png" : "image/jpeg",
        };
    }
    return null;
}

function chunkInput(chunk) {
    return buildEmbeddingInput({
        headline: chunk.headline,
        byline: chunk.byline,
        body_plain: chunk.chunk_text,
        edition_date: chunk.edition_date,
        category: chunk.category,
        summary: chunk.chunk_index === 0 ? chunk.summary : null,
    });
}

function imageInput(image, loaded) {
    const caption = image.caption?.trim() || "Untitled archival newspaper image";
    return buildEmbeddingInput({
        headline: image.headline,
        byline: image.byline,
        body_plain: `Image caption: ${caption}`,
        edition_date: image.edition_date,
        category: image.category,
        summary: image.summary,
        image_caption: caption,
        imageBase64: loaded.base64,
        imageMimeType: loaded.mimeType,
    });
}

async function loadPendingRecords() {
    const chunks = await sql`SELECT c.id, c.chunk_index, c.chunk_text,
                           a.headline, a.byline, a.edition_date, a.category, a.summary
                    FROM article_chunks c JOIN articles a ON a.id = c.article_id
                    WHERE c.index_build_id IS NULL
                      AND (c.embedding IS NULL
                       OR c.embedding_model IS DISTINCT FROM ${EMBEDDING_MODEL}
                       OR c.embedding_input_version IS DISTINCT FROM ${EMBEDDING_INPUT_VERSION})
                    ORDER BY c.id`;

    const images = await sql`SELECT i.id, i.image_url, i.caption,
                           a.headline, a.byline, a.edition_date, a.category, a.summary
                    FROM article_images i JOIN articles a ON a.id = i.article_id
                    WHERE i.index_build_id IS NULL
                      AND (i.embedding IS NULL
                       OR i.embedding_model IS DISTINCT FROM ${EMBEDDING_MODEL}
                       OR i.embedding_input_version IS DISTINCT FROM ${IMAGE_EMBEDDING_INPUT_VERSION})
                    ORDER BY i.id`;
    return { chunks, images };
}

async function embedChunkBatch(batch) {
    const inputs = batch.map(chunkInput);
    const vectors = await embedDocuments(inputs, { op: "backfill.embed-chunks" });
    await sql.transaction(
        batch.map((chunk, index) => {
            const vector = `[${vectors[index].join(",")}]`;
            const inputHash = embeddingInputFingerprint(inputs[index]);
            return sql`UPDATE article_chunks
                       SET embedding = ${vector}::vector,
                           embedding_model = ${EMBEDDING_MODEL},
                           embedding_input_version = ${EMBEDDING_INPUT_VERSION},
                           embedding_input_hash = ${inputHash}
                       WHERE id = ${chunk.id} AND index_build_id IS NULL`;
        }),
    );
}

async function retryOnce(label, operation) {
    try {
        await operation();
        return;
    } catch (error) {
        if (error instanceof QuotaExhaustedError) throw error;
        console.warn(`${label} failed; retrying once in 2 seconds: ${error.message || error}`);
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        await operation();
    }
}

async function main() {
    if (!process.argv.includes("--legacy-unversioned")) {
        console.error(
            "ERROR: embed.mjs only maintains legacy unversioned rows (index_build_id IS NULL). " +
                "Re-run with --legacy-unversioned to confirm; versioned index work uses " +
                "`npm run rag:index:build`.",
        );
        process.exit(1);
    }
    const started = Date.now();
    const { chunks, images } = await loadPendingRecords();
    const preparedImages = images.map((image) => ({ image, loaded: loadImage(image.image_url) }));
    const availableImages = preparedImages.filter((record) => record.loaded);
    const missingImages = preparedImages.length - availableImages.length;

    const chunkChars = chunks.reduce((sum, chunk) => sum + chunkInput(chunk).text.length, 0);
    const imageTextChars = availableImages.reduce(
        (sum, record) => sum + imageInput(record.image, record.loaded).text.length,
        0,
    );
    const estimatedTextTokens = Math.ceil((chunkChars + imageTextChars) / 4);
    const estimatedCost =
        (estimatedTextTokens / 1_000_000) * 0.2 + availableImages.length * 0.00012;

    console.log("\nThe Transcript Archive — RAG Embedding Backfill");
    console.log(`Mode: ${isDryRun ? "dry-run" : "incremental"}`);
    console.log(`Model: ${EMBEDDING_MODEL} (${EMBEDDING_DIMS} dimensions)`);
    console.log(`Text chunks: ${chunks.length}`);
    console.log(`Images available locally: ${availableImages.length}`);
    console.log(`Images missing locally: ${missingImages}`);
    console.log(`Estimated online cost: $${estimatedCost.toFixed(4)}\n`);

    if (isDryRun) return;

    let embeddedChunks = 0;
    let embeddedImages = 0;
    const failures = [];

    for (let index = 0; index < chunks.length; index += BATCH_SIZE) {
        const batch = chunks.slice(index, index + BATCH_SIZE);
        try {
            await retryOnce(`Chunk batch ${index / BATCH_SIZE + 1}`, () => embedChunkBatch(batch));
            embeddedChunks += batch.length;
            console.log(`  Text: ${embeddedChunks}/${chunks.length}`);
        } catch (error) {
            if (error instanceof QuotaExhaustedError) throw error;
            failures.push(`chunk batch at ${index}: ${error.message || error}`);
        }
    }

    for (const { image, loaded } of availableImages) {
        const input = imageInput(image, loaded);
        try {
            await retryOnce(`Image ${image.id}`, async () => {
                const [vectorValues] = await embedDocuments([input], {
                    op: "backfill.embed-image",
                });
                const vector = `[${vectorValues.join(",")}]`;
                const inputHash = embeddingInputFingerprint(
                    input,
                    IMAGE_EMBEDDING_INPUT_VERSION,
                );
                await sql`UPDATE article_images
                          SET embedding = ${vector}::vector,
                              embedding_model = ${EMBEDDING_MODEL},
                              embedding_input_version = ${IMAGE_EMBEDDING_INPUT_VERSION},
                              embedding_input_hash = ${inputHash}
                          WHERE id = ${image.id} AND index_build_id IS NULL`;
            });
            embeddedImages += 1;
            if (embeddedImages % 25 === 0 || embeddedImages === availableImages.length) {
                console.log(`  Images: ${embeddedImages}/${availableImages.length}`);
            }
        } catch (error) {
            if (error instanceof QuotaExhaustedError) throw error;
            failures.push(`image ${image.id}: ${error.message || error}`);
        }
    }

    console.log(`\nCompleted in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
    console.log(`Embedded ${embeddedChunks} chunks and ${embeddedImages} images.`);
    if (missingImages > 0) {
        console.warn(
            `${missingImages} image vectors remain pending because their local source files were unavailable.`,
        );
    }
    if (failures.length > 0) {
        for (const failure of failures) console.error(`  ${failure}`);
        throw new Error(`${failures.length} embedding operation(s) failed.`);
    }
}

main().catch((error) => {
    console.error("Embedding failed:", error);
    process.exit(1);
});
