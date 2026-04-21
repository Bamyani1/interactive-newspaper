import type { AskResponse } from "@/src/types";

export interface TurnImage {
  src: string;
  caption: string | null;
  sourceIndex: number;
  sourceId: string;
}

/**
 * Collapse `sourceArticles[].imageUrls` into a single ordered list with
 * no duplicate URLs. The first time a URL appears wins — we keep its
 * caption (if any) and the 1-based source index of the article that
 * surfaced it. Later duplicates are discarded even if they carry a
 * caption, because the first source that cites a photo is the one the
 * reader's eye anchors on.
 *
 * The key is the URL's normalized form (spaces as %20) so minor
 * encoding drift between the pipeline and the model doesn't create
 * phantom duplicates.
 */
export function dedupSourceImages(
  sources: AskResponse["sourceArticles"],
): TurnImage[] {
  const seen = new Set<string>();
  const out: TurnImage[] = [];
  sources.forEach((s, i) => {
    s.imageUrls.forEach((url, j) => {
      const key = url.replace(/ /g, "%20");
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        src: url,
        caption: s.imageCaptions[j] ?? null,
        sourceIndex: i + 1,
        sourceId: s.id,
      });
    });
  });
  return out;
}

/**
 * Build a URL → metadata map so a consumer that received the URL in
 * any plausible shape — raw, %20-encoded, or fully decoded — can
 * resolve it in O(1). The LLM is told to emit URLs verbatim but its
 * parser or our mdSafeUrl helper may flip space↔%20, so we pre-seed
 * the map with every form that we can derive locally without
 * guessing at arbitrary characters.
 */
export function indexImagesByUrl(
  images: TurnImage[],
): Map<string, TurnImage & { index: number }> {
  const map = new Map<string, TurnImage & { index: number }>();
  images.forEach((img, index) => {
    const entry = { ...img, index };
    const variants = new Set<string>([img.src]);
    variants.add(img.src.replace(/ /g, "%20"));
    try {
      variants.add(decodeURI(img.src));
    } catch {
      // Malformed percent escape — the raw key above is still present.
    }
    variants.forEach((v) => map.set(v, entry));
  });
  return map;
}
