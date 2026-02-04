import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";

// Initialize SQLite with adapter for Prisma 7
const dbUrl = process.env.DATABASE_URL || "file:./prisma/dev.db";
const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

// Category name to ID mapping (must match seed-categories.ts)
const CATEGORY_MAP: Record<string, string> = {
    "News": "cat_news",
    "Sports": "cat_sports",
    "Features": "cat_features",
    "Opinion": "cat_opinion",
    "Arts": "cat_arts",
    "Campus Life": "cat_campus_life",
    "Ads": "cat_ads",
};

interface EditionJson {
    edition: string;
    pageCount: number;
    articleCount: number;
    articles: Array<{
        id: string;
        date: string;
        category: string;
        headline: string;
        summary: string;
        fullText: string;
        imageUrl: string | null;
        byline: string | null;
        page: number;
        isHero: boolean;
        isFeatured: boolean;
        imageCaption: string | null;
        continuesOnPage?: string | null;
    }>;
}

/**
 * Get categoryId from category name.
 * Falls back to News if category is unknown.
 */
function getCategoryId(categoryName: string): string {
    return CATEGORY_MAP[categoryName] || CATEGORY_MAP["News"];
}

async function seedEdition(editionPath: string) {
    const jsonPath = path.join(editionPath, "edition.json");

    if (!fs.existsSync(jsonPath)) {
        console.log(`  Skipping ${editionPath} - no edition.json found`);
        return;
    }

    const data: EditionJson = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

    console.log(`  Processing ${data.edition}: ${data.articleCount} articles`);

    // Upsert the edition
    await prisma.edition.upsert({
        where: { date: data.edition },
        update: { pageCount: data.pageCount },
        create: {
            date: data.edition,
            pageCount: data.pageCount,
        },
    });

    // Insert articles
    for (const article of data.articles) {
        const categoryId = getCategoryId(article.category);

        await prisma.article.upsert({
            where: { id: article.id },
            update: {
                headline: article.headline,
                summary: article.summary || null,
                fullText: article.fullText,
                categoryId,  // Use FK instead of string
                byline: article.byline || null,
                page: article.page,
                imageUrl: article.imageUrl || null,
                imageCaption: article.imageCaption || null,
                isHero: article.isHero || false,
                isFeatured: article.isFeatured || false,
            },
            create: {
                id: article.id,
                editionDate: data.edition,
                headline: article.headline,
                summary: article.summary || null,
                fullText: article.fullText,
                categoryId,  // Use FK instead of string
                byline: article.byline || null,
                page: article.page,
                imageUrl: article.imageUrl || null,
                imageCaption: article.imageCaption || null,
                isHero: article.isHero || false,
                isFeatured: article.isFeatured || false,
            },
        });
    }

    console.log(`  ✓ Imported ${data.articleCount} articles for ${data.edition}`);
}

async function main() {
    console.log("🌱 Seeding database...\n");

    const dataDir = path.join(process.cwd(), "data", "ocr-output");

    if (!fs.existsSync(dataDir)) {
        console.error("Error: data/ocr-output directory not found");
        process.exit(1);
    }

    // Find all edition directories
    const editions = fs
        .readdirSync(dataDir)
        .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
        .map((name) => path.join(dataDir, name));

    console.log(`Found ${editions.length} edition(s)\n`);

    for (const editionPath of editions) {
        await seedEdition(editionPath);
    }

    // Print summary
    const editionCount = await prisma.edition.count();
    const articleCount = await prisma.article.count();
    const categoryCount = await prisma.category.count();

    console.log(`\n✅ Seed complete!`);
    console.log(`   Categories: ${categoryCount}`);
    console.log(`   Editions: ${editionCount}`);
    console.log(`   Articles: ${articleCount}`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
