/**
 * One-off migration: RAG accuracy improvements
 *
 * 1. Install/update the FTS trigger with new weights:
 *    headline(A) + summary(B) + byline(C) + body_plain(C)
 * 2. Recompute search_vector for all existing articles
 * 3. Drop the old HNSW index (ef_construction=64)
 *
 * The HNSW index is recreated with ef_construction=128 AFTER re-embedding,
 * via a separate command (see scripts/db/recreate-hnsw-index.mjs).
 *
 * Usage:
 *   node --import tsx scripts/db/migrate-rag-improvements.mjs
 */

import { neon } from "@neondatabase/serverless";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Load .env.local
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
    console.log("\nRAG Accuracy Migration");
    console.log("======================\n");

    // Step 1: Install/update the FTS trigger function
    console.log("[1/4] Installing updated FTS trigger function...");
    await sql`
        CREATE OR REPLACE FUNCTION articles_search_vector_update() RETURNS trigger AS $$
        BEGIN
          NEW.search_vector :=
            setweight(to_tsvector('english', coalesce(NEW.headline, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(NEW.summary, '')), 'B') ||
            setweight(to_tsvector('english', coalesce(NEW.byline, '')), 'C') ||
            setweight(to_tsvector('english', coalesce(NEW.body_plain, '')), 'C');
          RETURN NEW;
        END $$ LANGUAGE plpgsql;
    `;
    console.log("    Function installed.\n");

    // Step 2: Create the trigger if it doesn't exist
    console.log("[2/4] Creating trigger if missing...");
    await sql`
        DROP TRIGGER IF EXISTS articles_search_vector_trig ON articles;
    `;
    await sql`
        CREATE TRIGGER articles_search_vector_trig
        BEFORE INSERT OR UPDATE ON articles
        FOR EACH ROW EXECUTE FUNCTION articles_search_vector_update();
    `;
    console.log("    Trigger installed.\n");

    // Step 3: Recompute search_vector for all rows
    console.log("[3/4] Recomputing search_vector for all articles...");
    const updateStart = Date.now();
    const result = await sql`UPDATE articles SET headline = headline`;
    const updateTime = ((Date.now() - updateStart) / 1000).toFixed(1);
    console.log(`    Updated ${result.length || 'all'} rows in ${updateTime}s.\n`);

    // Step 4: Drop the old HNSW index (will recreate after re-embed)
    console.log("[4/4] Dropping old HNSW index (ef_construction=64)...");
    await sql`DROP INDEX IF EXISTS idx_articles_embedding`;
    console.log("    Index dropped. Vector search will use sequential scan until re-created.\n");

    // Verify
    const verify = await sql`
        SELECT COUNT(*) as total, COUNT(search_vector) as has_vector
        FROM articles
    `;
    console.log(`Verification: ${verify[0].has_vector}/${verify[0].total} articles have search_vector\n`);

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`Migration complete in ${elapsed}s.`);
    console.log("\nNext steps:");
    console.log("  1. Run: npm run db:embed -- --force   (~50 min, re-embeds with new fields)");
    console.log("  2. Run: node --import tsx scripts/db/recreate-hnsw-index.mjs   (after embed completes)");
}

main().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
});
