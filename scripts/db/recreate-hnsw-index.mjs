/**
 * Recreate the HNSW index with improved parameters.
 *
 * Run this AFTER `npm run db:embed -- --force` completes.
 *
 * Changes:
 * - ef_construction: 64 → 128 (better index quality, one-time build cost)
 * - m: 16 (unchanged)
 *
 * Usage:
 *   node --import tsx scripts/db/recreate-hnsw-index.mjs
 */

import { neon } from "@neondatabase/serverless";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../../.env.local");
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

async function main() {
    const start = Date.now();
    console.log("\nHNSW Index Rebuild");
    console.log("==================\n");

    // Verify embeddings exist
    const counts = await sql`
        SELECT COUNT(*) as total, COUNT(embedding) as embedded
        FROM articles
    `;
    console.log(`Articles: ${counts[0].embedded}/${counts[0].total} have embeddings`);

    if (counts[0].embedded === '0') {
        console.error("ERROR: No embeddings found. Run db:embed --force first.");
        process.exit(1);
    }

    // Drop existing index if any
    console.log("\n[1/2] Dropping existing HNSW index (if present)...");
    await sql`DROP INDEX IF EXISTS idx_articles_embedding`;
    console.log("    Done.\n");

    // Create new index with ef_construction=128
    console.log("[2/2] Creating HNSW index with ef_construction=128...");
    console.log("    (This may take a few minutes for ~9,600 vectors)");
    const buildStart = Date.now();
    await sql`
        CREATE INDEX idx_articles_embedding ON articles
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 128)
    `;
    const buildTime = ((Date.now() - buildStart) / 1000).toFixed(1);
    console.log(`    Index built in ${buildTime}s.\n`);

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`Done in ${elapsed}s.`);
}

main().catch((err) => {
    console.error("Index rebuild failed:", err);
    process.exit(1);
});
