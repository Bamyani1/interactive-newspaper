import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

const OCR_OUTPUT_DIR = path.join(process.cwd(), 'public', 'editions');
const GOLD_DIR = path.join(process.cwd(), 'gold');

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

  const respond = (data: Buffer) =>
    new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });

  try {
    return respond(await readFile(filePath));
  } catch (err) {
    // Only treat genuine "file missing" as a 404. Permissions errors, disk
    // issues, stale mounts, etc. should surface in logs so operators can
    // tell a configuration bug from a legitimately missing asset. We still
    // fall through to the gold-dir fallback in all cases, and still return
    // 404 if neither path works (to avoid leaking error details).
    // See docs/issues/0007.
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code && code !== 'ENOENT') {
      console.error(
        JSON.stringify({
          level: 'error',
          route: '/api/editions/[date]/images',
          msg: 'primary image read failed',
          filePath,
          code,
          err: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    try {
      const goldPath = path.join(GOLD_DIR, date, 'images', filename);
      if (goldPath.startsWith(path.join(GOLD_DIR, date, 'images'))) {
        return respond(await readFile(goldPath));
      }
    } catch (goldErr) {
      const goldCode = (goldErr as NodeJS.ErrnoException)?.code;
      if (goldCode && goldCode !== 'ENOENT') {
        console.error(
          JSON.stringify({
            level: 'error',
            route: '/api/editions/[date]/images',
            msg: 'gold fallback read failed',
            code: goldCode,
            err: goldErr instanceof Error ? goldErr.message : String(goldErr),
          }),
        );
      }
    }
    return new NextResponse('Image not found', { status: 404 });
  }
}
