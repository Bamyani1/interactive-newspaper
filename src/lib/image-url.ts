/**
 * Resolves an edition image filename to a full URL.
 *
 * With IMAGE_BASE_URL set (production): returns an R2 CDN URL with .webp extension.
 * Without IMAGE_BASE_URL (local dev): returns the existing API proxy path.
 */
export function resolveImageUrl(date: string, filename: string): string {
  const base = process.env.IMAGE_BASE_URL?.replace(/\/$/, "");
  const bare = filename.replace(/^images\//, "");

  if (base) {
    const webpName = bare.replace(/\.(jpe?g|png|gif|tiff?)$/i, ".webp");
    return `${base}/${date}/images/${webpName}`;
  }

  return `/api/editions/${date}/images/${encodeURIComponent(bare)}`;
}
