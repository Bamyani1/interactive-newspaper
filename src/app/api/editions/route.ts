import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../lib/db";
import { parsePaginationParams, buildPaginationMeta } from "../../../lib/pagination";

export async function GET(request: NextRequest) {
    try {
        const { cursor, take } = parsePaginationParams(request.nextUrl.searchParams);

        // Get total count for metadata
        const total = await prisma.edition.count();

        // Fetch one extra to check if there are more
        const editions = await prisma.edition.findMany({
            take: take + 1,
            ...(cursor && {
                cursor: { id: cursor },
                skip: 1,  // Skip the cursor item
            }),
            orderBy: { date: "desc" },
            select: {
                id: true,
                date: true,
                pageCount: true,
                _count: {
                    select: { articles: true },
                },
            },
        });

        // Build pagination response
        const { data, pagination } = buildPaginationMeta(
            editions,
            take,
            (e) => e.id,
            total
        );

        return NextResponse.json({
            editions: data.map((e) => ({
                id: e.id,
                date: e.date,
                pageCount: e.pageCount,
                articleCount: e._count.articles,
            })),
            pagination,
        });
    } catch (error) {
        console.error("Failed to fetch editions:", error);
        return NextResponse.json(
            { error: "Failed to fetch editions" },
            { status: 500 }
        );
    }
}
