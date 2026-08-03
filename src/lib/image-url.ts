/**
 * Resolves an edition image filename to a full URL.
 *
 * Content-addressed assets (`<sha256>.webp`, lowercase 64-hex, optionally
 * prefixed with `images/`): with IMAGE_BASE_URL set they resolve to the shared
 * `ocr-assets/` R2 namespace (no date segment); without it they fall through
 * to the dev proxy path, which serves the local copy at
 * public/editions/<date>/images/<hash>.webp unchanged.
 *
 * All other filenames:
 * With IMAGE_BASE_URL set (production): returns an R2 CDN URL with .webp extension.
 * Without IMAGE_BASE_URL (local dev): returns the existing API proxy path.
 */
export function resolveImageUrl(date: string, filename: string): string {
  const base = process.env.IMAGE_BASE_URL?.replace(/\/$/, "");
  const bare = filename.replace(/^images\//, "");

  if (base && /^[a-f0-9]{64}\.webp$/.test(bare)) {
    return `${base}/ocr-assets/${bare}`;
  }

  if (base) {
    const webpName = bare.replace(/\.(jpe?g|png|gif|tiff?)$/i, ".webp");
    return `${base}/${date}/images/${webpName}`;
  }

  return `/api/editions/${date}/images/${encodeURIComponent(bare)}`;
}
