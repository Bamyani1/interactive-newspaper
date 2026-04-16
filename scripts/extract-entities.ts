/**
 * Entity Extraction Script
 *
 * Extracts named entities (Person, Organization, Place, Event) from all
 * newspaper articles using Gemini Flash and stores them in Postgres.
 *
 * Usage:
 *   node --import tsx scripts/extract-entities.ts              — extract from unprocessed articles
 *   node --import tsx scripts/extract-entities.ts --force      — reprocess all articles
 *   node --import tsx scripts/extract-entities.ts --dry-run    — show what would be processed
 *   node --import tsx scripts/extract-entities.ts --limit 50   — process only 50 articles
 */

import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { neon } from "@neondatabase/serverless";
import { GoogleGenAI } from "@google/genai";

// ─── Load .env.local ────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, "../.env.local");
if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
        const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/);
        if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
}

// ─── CLI flags ──────────────────────────────────────────────────

const isForce = process.argv.includes("--force");
const isDryRun = process.argv.includes("--dry-run");
const limitIdx = process.argv.indexOf("--limit");
const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) : null;

// ─── Validation ─────────────────────────────────────────────────

if (!process.env.DATABASE_URL) {
    console.error("ERROR: DATABASE_URL required");
    process.exit(1);
}

if (!isDryRun && !process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) {
    console.error("ERROR: GOOGLE_API_KEY required");
    process.exit(1);
}

// ─── Clients ────────────────────────────────────────────────────

const sql = neon(process.env.DATABASE_URL!);
const client = isDryRun
    ? (null as unknown as GoogleGenAI)
    : new GoogleGenAI({ apiKey: (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY)! });

// ─── Constants ──────────────────────────────────────────────────

const BATCH_SIZE = 10;
const EXTRACTION_MODEL = "gemini-3-flash-preview";
const MAX_BODY_CHARS = 3000;

// ─── Types ──────────────────────────────────────────────────────

interface ExtractedEntity {
    name: string;
    type: "Person" | "Organization" | "Place" | "Event";
    role: "subject" | "mentioned" | "author";
}

interface Article {
    id: string;
    headline: string;
    byline: string | null;
    body_plain: string;
    edition_date: string;
    category: string;
}

// ─── Helpers ────────────────────────────────────────────────────

function normalizeName(name: string): string {
    return name
        .toLowerCase()
        .replace(/^(prof\.|dr\.|mr\.|mrs\.|ms\.)\s*/i, "")
        .trim();
}

async function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

async function extractEntities(article: Article): Promise<ExtractedEntity[]> {
    const prompt = `Extract all named entities from this newspaper article. For each entity, provide:
- name: the entity's name as it appears in the text
- type: one of "Person", "Organization", "Place", "Event"
- role: one of "subject" (article is about them), "mentioned" (referenced in passing), "author" (wrote the article)

Article headline: ${article.headline}
Article date: ${article.edition_date}
Article body: ${(article.body_plain || "").slice(0, MAX_BODY_CHARS)}`;

    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries) {
        try {
            const response = await client.models.generateContent({
                model: EXTRACTION_MODEL,
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: "array" as const,
                        items: {
                            type: "object" as const,
                            properties: {
                                name: { type: "string" as const },
                                type: {
                                    type: "string" as const,
                                    enum: ["Person", "Organization", "Place", "Event"],
                                },
                                role: {
                                    type: "string" as const,
                                    enum: ["subject", "mentioned", "author"],
                                },
                            },
                            required: ["name", "type", "role"],
                        },
                    },
                    temperature: 0.0,
                    maxOutputTokens: 2048,
                },
            });

            const text = response.text?.trim() ?? "[]";
            const parsed = JSON.parse(text) as ExtractedEntity[];
            return parsed;
        } catch (err: unknown) {
            const status =
                err instanceof Error && "status" in err
                    ? (err as { status: number }).status
                    : null;
            const message = err instanceof Error ? err.message : String(err);

            if (status === 429) {
                console.warn(`  Rate limited, waiting 30s before retry...`);
                await sleep(30_000);
                retries++;
                continue;
            }

            if (status === 503) {
                retries++;
                if (retries < maxRetries) {
                    console.warn(`  503 error, waiting 10s before retry (${retries}/${maxRetries})...`);
                    await sleep(10_000);
                    continue;
                }
            }

            // JSON parse error or other failure
            console.error(
                JSON.stringify({
                    level: "error",
                    script: "extract-entities",
                    article_id: "unknown",
                    msg: "entity extraction failed",
                    err: message,
                }),
            );
            return [];
        }
    }

    return [];
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
    const start = Date.now();

    console.log(`\nStarting entity extraction...`);
    console.log(
        `Mode: ${isForce ? "force (reprocess all)" : "incremental (use --force to reprocess all)"}`,
    );

    // Step 1: Create tables
    await sql`
        CREATE TABLE IF NOT EXISTS entities (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            normalized_name TEXT NOT NULL,
            article_count INTEGER DEFAULT 0
        )
    `;
    await sql`
        CREATE TABLE IF NOT EXISTS article_entities (
            entity_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
            article_id TEXT REFERENCES articles(id) ON DELETE CASCADE,
            role TEXT,
            mention_count INTEGER DEFAULT 1,
            PRIMARY KEY (entity_id, article_id)
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_entities_type_name ON entities(type, normalized_name)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_article_entities_entity ON article_entities(entity_id)`;
    // Unique constraint needed for ON CONFLICT upsert
    await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_type_normalized
        ON entities(type, normalized_name)
    `;

    // Step 2: Find unprocessed articles
    const articles = (isForce
        ? await sql`
            SELECT a.id, a.headline, a.byline, a.body_plain, a.edition_date, a.category
            FROM articles a
            ORDER BY a.id
          `
        : await sql`
            SELECT a.id, a.headline, a.byline, a.body_plain, a.edition_date, a.category
            FROM articles a
            WHERE a.id NOT IN (SELECT DISTINCT article_id FROM article_entities)
            ORDER BY a.id
          `) as unknown as Article[];

    const toProcess = limit ? articles.slice(0, limit) : articles;

    console.log(`Articles to process: ${toProcess.length}`);

    if (toProcess.length === 0) {
        console.log("All articles already processed. Nothing to do.");
        console.log("Use --force to reprocess all articles.");
        return;
    }

    if (isDryRun) {
        console.log("\nDry run complete. No API calls made.");
        console.log(`Would process ${toProcess.length} articles in ${Math.ceil(toProcess.length / BATCH_SIZE)} batches.`);
        return;
    }

    // Step 3: Process in batches
    let processed = 0;
    let totalExtracted = 0;
    let skipped = 0;

    for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
        const batch = toProcess.slice(i, i + BATCH_SIZE);
        let batchEntities = 0;

        for (const article of batch) {
            const entities = await extractEntities(article);

            if (entities.length === 0 && article.body_plain.length > 50) {
                // Likely a parse/API failure on a real article
                skipped++;
                continue;
            }

            // Step 4: Upsert entities and link to articles
            for (const entity of entities) {
                const normalizedName = normalizeName(entity.name);

                // Insert or find entity
                await sql`
                    INSERT INTO entities (name, type, normalized_name)
                    VALUES (${entity.name}, ${entity.type}, ${normalizedName})
                    ON CONFLICT (type, normalized_name) DO NOTHING
                `;

                const rows = await sql`
                    SELECT id FROM entities
                    WHERE type = ${entity.type} AND normalized_name = ${normalizedName}
                `;

                if (rows.length === 0) continue;
                const entityId = rows[0].id;

                // Link to article
                await sql`
                    INSERT INTO article_entities (entity_id, article_id, role)
                    VALUES (${entityId}, ${article.id}, ${entity.role})
                    ON CONFLICT DO NOTHING
                `;

                // Update article_count
                await sql`
                    UPDATE entities
                    SET article_count = (
                        SELECT COUNT(*) FROM article_entities WHERE entity_id = ${entityId}
                    )
                    WHERE id = ${entityId}
                `;

                batchEntities++;
            }
        }

        processed += batch.length;
        totalExtracted += batchEntities;
        const pct = ((processed / toProcess.length) * 100).toFixed(0);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        console.log(
            `  [${processed}/${toProcess.length}] (${pct}%) Extracted ${batchEntities} entities from batch ${batchNum}`,
        );
    }

    // Step 5: Final stats
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    const totalEntities = await sql`SELECT COUNT(*) AS count FROM entities`;
    const totalLinks = await sql`SELECT COUNT(*) AS count FROM article_entities`;
    const typeCounts = await sql`
        SELECT type, COUNT(*) AS count FROM entities GROUP BY type ORDER BY count DESC
    `;

    console.log(`\nDone in ${elapsed}s.`);
    console.log(`  Total entities: ${Number(totalEntities[0].count).toLocaleString()}`);
    console.log(`  Total article-entity links: ${Number(totalLinks[0].count).toLocaleString()}`);
    console.log(
        `  Unique entity types: ${typeCounts.map((r) => `${r.type}: ${Number(r.count).toLocaleString()}`).join(", ")}`,
    );

    if (skipped > 0) {
        console.log(`  Skipped (errors): ${skipped}`);
    }
}

main().catch((err) => {
    console.error(
        JSON.stringify({
            level: "error",
            script: "extract-entities",
            msg: "fatal error",
            err: err instanceof Error ? err.message : String(err),
        }),
    );
    process.exit(1);
});
