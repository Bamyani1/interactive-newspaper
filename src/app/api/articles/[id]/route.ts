import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        const article = await prisma.article.findUnique({
            where: { id },
            include: {
                edition: {
                    select: {
                        date: true,
                        pageCount: true,
                    },
                },
                category: true,  // Include category relation
            },
        });

        if (!article) {
            return NextResponse.json(
                { error: "Article not found" },
                { status: 404 }
            );
        }

        return NextResponse.json({
            article: {
                id: article.id,
                headline: article.headline,
                summary: article.summary,
                fullText: article.fullText,
                // Return category name for backwards compatibility
                category: article.category?.name ?? "News",
                byline: article.byline,
                page: article.page,
                imageUrl: article.imageUrl,
                imageCaption: article.imageCaption,
                isHero: article.isHero,
                isFeatured: article.isFeatured,
                edition: {
                    date: article.edition.date,
                    pageCount: article.edition.pageCount,
                },
            },
        });
    } catch (error) {
        console.error("Failed to fetch article:", error);
        return NextResponse.json(
            { error: "Failed to fetch article" },
            { status: 500 }
        );
    }
}
