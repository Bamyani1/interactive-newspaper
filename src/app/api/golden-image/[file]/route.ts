import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ file: string }> }
) {
    const params = await context.params;
    const { file } = params;

    if (!file || typeof file !== "string") {
        return new NextResponse("File parameter is required", { status: 400 });
    }

    // Prevent directory traversal
    const safeFile = path.basename(file);
    const imagePath = path.join(process.cwd(), "tests/ocr/gold_data/1980-04-17/images", safeFile);

    try {
        const imageBuffer = await fs.readFile(imagePath);

        // Determine content type
        let contentType = "image/jpeg";
        if (safeFile.endsWith(".png")) contentType = "image/png";

        return new NextResponse(imageBuffer, {
            headers: {
                "Content-Type": contentType,
                "Cache-Control": "public, max-age=3600",
            },
        });
    } catch {
        return new NextResponse("Image not found", { status: 404 });
    }
}
