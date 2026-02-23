import type {
  AdCategory,
  AdType,
  OcrEdition,
  OcrEnrichedAd,
  VintageAd,
} from "@/src/types";
import { isValidImageFile } from "./image-rules";

const VALID_AD_CATEGORIES: ReadonlySet<AdCategory> = new Set([
  "Food & Drink",
  "Entertainment",
  "Services",
  "Retail",
  "Greek Life",
  "Jobs",
  "Housing",
  "Education",
  "Events",
  "Other",
]);

const VALID_AD_TYPES: ReadonlySet<AdType> = new Set(["display", "classified"]);

export function transformAds(edition: OcrEdition): VintageAd[] {
  const date = edition.edition_date;
  const source = edition.enriched_ads ?? edition.ads ?? [];
  if (!Array.isArray(source)) return [];

  return source.map((ad) => {
    const base: VintageAd = { title: ad.business_name, body: ad.body };

    // Build image URLs from ad.image_files (same pattern as transformArticles)
    const imageUrls = (ad.image_files ?? [])
      .filter((f) => isValidImageFile(f))
      .map((f) => {
        const filename = f.replace(/^images\//, "");
        return `/api/editions/${date}/images/${encodeURIComponent(filename)}`;
      });

    if (imageUrls.length > 0) base.imageUrls = imageUrls;

    if ("category" in ad) {
      const enriched = ad as OcrEnrichedAd;
      base.category = VALID_AD_CATEGORIES.has(enriched.category as AdCategory)
        ? (enriched.category as AdCategory)
        : "Other";
      base.adType = VALID_AD_TYPES.has(enriched.ad_type as AdType)
        ? (enriched.ad_type as AdType)
        : undefined;
      base.displayText = enriched.display_text;
      base.phone = enriched.phone || undefined;
      base.address = enriched.address || undefined;
      base.price = enriched.price || undefined;
    }

    return base;
  });
}
