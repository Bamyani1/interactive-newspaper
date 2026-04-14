import "server-only";
import fs from "fs";
import path from "path";
import { transformArticles, transformAds } from "@/src/server/ocr-adapter";
import type { Article, EditionInfo, OcrEdition, VintageAd } from "@/src/types";

export const GOLD_DATE = "1960-01-13";

export const GOLD_EDITION_INFO: EditionInfo = {
  id: `gold-${GOLD_DATE}`,
  date: GOLD_DATE,
  pageCount: 12,
  articleCount: 46,
};

const GOLD_FILE_PATH = path.join(process.cwd(), "gold", GOLD_DATE, "gold-edition.json");

export const GOLD_FILE_EXISTS = (() => {
  try {
    fs.accessSync(GOLD_FILE_PATH);
    return true;
  } catch {
    return false;
  }
})();

export interface GoldEditionData {
  articles: Article[];
  ads: VintageAd[];
  publicationInfo: string;
}

export function loadGoldEdition(): GoldEditionData | null {
  try {
    const raw = fs.readFileSync(GOLD_FILE_PATH, "utf-8");
    const edition: OcrEdition = JSON.parse(raw);
    return {
      articles: transformArticles(edition),
      ads: transformAds(edition),
      publicationInfo: edition.publication_info ?? "",
    };
  } catch {
    return null;
  }
}
