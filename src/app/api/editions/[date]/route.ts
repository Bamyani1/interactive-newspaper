import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import { parsePaginationParams, buildPaginationMeta } from "../../../../lib/pagination";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ date: string }> }
) {
    try {
        const { date } = await params;
        const { cursor, take, category } = parsePaginationParams(request.nextUrl.searchParams);

        // Check edition exists
        const edition = await prisma.edition.findUnique({
            where: { date },
            select: {
                id: true,
                date: true,
                pageCount: true,
            },
        });

        if (!edition) {
            return NextResponse.json(
                { error: "Edition not found" },
                { status: 404 }
            );
        }

        // Build where clause with optional category filter
        const whereClause = {
            editionDate: date,
            ...(category && {
                category: { slug: category },
            }),
        };

        // Get total count for this edition (with optional category filter)
        const total = await prisma.article.count({ where: whereClause });

        // Fetch articles with pagination
        const articles = await prisma.article.findMany({
            where: whereClause,
            take: take + 1,
            ...(cursor && {
                cursor: { id: cursor },
                skip: 1,
            }),
            orderBy: [
                { isHero: "desc" },
                { isFeatured: "desc" },
                { page: "asc" },
            ],
            include: {
                category: true,
            },
        });

        // Build pagination response
        const { data, pagination } = buildPaginationMeta(
            articles,
            take,
            (a) => a.id,
            total
        );

        return NextResponse.json({
            edition: {
                id: edition.id,
                date: edition.date,
                pageCount: edition.pageCount,
            },
            articles: data.map((a) => ({
                id: a.id,
                headline: a.headline,
                summary: a.summary,
                fullText: a.fullText,
                category: a.category?.name ?? "News",
                byline: a.byline,
                page: a.page,
                imageUrl: a.imageUrl,
                imageCaption: a.imageCaption,
                isHero: a.isHero,
                isFeatured: a.isFeatured,
            })),
            pagination,
        });
    } catch (error) {
        console.error("Failed to fetch edition:", error);
        return NextResponse.json(
            { error: "Failed to fetch edition" },
            { status: 500 }
        );
    }
}
