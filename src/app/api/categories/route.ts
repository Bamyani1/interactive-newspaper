import { NextResponse } from "next/server";
import { prisma } from "../../../lib/db";

/**
 * GET /api/categories
 * List all categories with article counts, ordered by displayOrder.
 */
export async function GET() {
    try {
        const categories = await prisma.category.findMany({
            orderBy: { displayOrder: "asc" },
            select: {
                id: true,
                name: true,
                slug: true,
                displayOrder: true,
                _count: {
                    select: { articles: true },
                },
            },
        });

        return NextResponse.json({
            categories: categories.map((c) => ({
                id: c.id,
                name: c.name,
                slug: c.slug,
                displayOrder: c.displayOrder,
                articleCount: c._count.articles,
            })),
        });
    } catch (error) {
        console.error("Failed to fetch categories:", error);
        return NextResponse.json(
            { error: "Failed to fetch categories" },
            { status: 500 }
        );
    }
}
