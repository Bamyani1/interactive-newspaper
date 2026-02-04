/**
 * Migrate existing articles from string category to categoryId FK.
 * 
 * This script:
 * 1. Creates Category records if they don't exist
 * 2. Looks up each article's category string 
 * 3. Updates article with the corresponding categoryId
 * 
 * Run after seed-categories.ts: npx tsx prisma/migrate-categories.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import Database from "better-sqlite3";
import "dotenv/config";

const dbUrl = process.env.DATABASE_URL || "file:./prisma/dev.db";

// Use raw better-sqlite3 for migration (can access old column)
const dbPath = dbUrl.replace("file:", "").replace("./", "prisma/");
const db = new Database(dbPath);

// Category name to ID mapping
const CATEGORY_MAP: Record<string, string> = {
    "News": "cat_news",
    "Sports": "cat_sports",
    "Features": "cat_features",
    "Opinion": "cat_opinion",
    "Arts": "cat_arts",
    "Campus Life": "cat_campus_life",
    "Ads": "cat_ads",
};

async function migrateCategories() {
    console.log("🔄 Migrating article categories...\n");

    // Check if old 'category' column exists
    const tableInfo = db.prepare("PRAGMA table_info(Article)").all() as Array<{ name: string }>;
    const hasOldColumn = tableInfo.some((col) => col.name === "category");
    const hasNewColumn = tableInfo.some((col) => col.name === "category_id");

    if (!hasOldColumn) {
        console.log("  ℹ️  Old 'category' column not found. Migration may have already run.");
        if (hasNewColumn) {
            console.log("  ✅ 'category_id' column exists. Migration complete.");
        }
        return;
    }

    if (!hasNewColumn) {
        console.log("  ⚠️  'category_id' column not found. Run prisma db push first.");
        return;
    }

    // Get articles with old category values
    const articles = db.prepare(`
        SELECT id, category FROM Article WHERE category IS NOT NULL
    `).all() as Array<{ id: string; category: string }>;

    console.log(`  Found ${articles.length} articles to migrate\n`);

    let updated = 0;
    let unknown = 0;

    const updateStmt = db.prepare(`
        UPDATE Article SET category_id = ? WHERE id = ?
    `);

    for (const article of articles) {
        const categoryId = CATEGORY_MAP[article.category] || "cat_news";

        if (!CATEGORY_MAP[article.category]) {
            console.log(`  ⚠️  Unknown category "${article.category}" → defaulting to News`);
            unknown++;
        }

        updateStmt.run(categoryId, article.id);
        updated++;
    }

    console.log(`\n✅ Migration complete!`);
    console.log(`   - Updated: ${updated} articles`);
    console.log(`   - Unknown categories defaulted to News: ${unknown}`);
}

migrateCategories()
    .catch((e) => {
        console.error("Error migrating categories:", e);
        process.exit(1);
    })
    .finally(() => {
        db.close();
    });
