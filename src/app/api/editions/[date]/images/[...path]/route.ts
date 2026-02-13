import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

const OCR_OUTPUT_DIR = path.join(process.cwd(), 'ocr', 'output');

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ date: string; path: string[] }> },
) {
  const { date, path: pathSegments } = await params;

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new NextResponse('Invalid date', { status: 400 });
  }

  // Reject path traversal attempts
  const filename = pathSegments.join('/');
  if (filename.includes('..') || filename.startsWith('/')) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const filePath = path.join(OCR_OUTPUT_DIR, date, 'images', filename);

  // Verify resolved path stays within the expected directory
  const expectedDir = path.join(OCR_OUTPUT_DIR, date, 'images');
  if (!filePath.startsWith(expectedDir)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) {
    return new NextResponse('Unsupported file type', { status: 400 });
  }

  try {
    const data = await readFile(filePath);
    return new NextResponse(data, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new NextResponse('Image not found', { status: 404 });
  }
}
