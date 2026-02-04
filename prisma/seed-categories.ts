/**
 * Seed standard categories for The Transcript Archive.
 * 
 * Run this ONCE before migrating articles to use categoryId.
 * Usage: npx tsx prisma/seed-categories.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import "dotenv/config";

const dbUrl = process.env.DATABASE_URL || "file:./prisma/dev.db";
const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

const CATEGORIES = [
    { id: "cat_news", name: "News", slug: "news", displayOrder: 1 },
    { id: "cat_sports", name: "Sports", slug: "sports", displayOrder: 2 },
    { id: "cat_features", name: "Features", slug: "features", displayOrder: 3 },
    { id: "cat_opinion", name: "Opinion", slug: "opinion", displayOrder: 4 },
    { id: "cat_arts", name: "Arts", slug: "arts", displayOrder: 5 },
    { id: "cat_campus_life", name: "Campus Life", slug: "campus-life", displayOrder: 6 },
    { id: "cat_ads", name: "Ads", slug: "ads", displayOrder: 7 },
];

async function seedCategories() {
    console.log("🏷️  Seeding categories...\n");

    for (const cat of CATEGORIES) {
        const result = await prisma.category.upsert({
            where: { name: cat.name },
            update: { displayOrder: cat.displayOrder, slug: cat.slug },
            create: cat,
        });
        console.log(`  ✓ ${result.name} (${result.id})`);
    }

    console.log("\n✅ Categories seeded successfully!");
}

seedCategories()
    .catch((e) => {
        console.error("Error seeding categories:", e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
