import type { Article, OcrArticle } from "@/src/types";

// Section keywords mapped to categories (used for byline tags + headline matching)
const SECTION_MAP: Record<string, Article["category"]> = {
  sports: "Sports",
  arts: "Arts & Entertainment",
  entertainment: "Arts & Entertainment",
  opinion: "Opinion",
  editorial: "Opinion",
  academics: "Campus News",
  news: "News",
};

const SPORTS_RE =
  /\b(basketball|football|baseball|soccer|track|tennis|swim|lacrosse|hoopster|cager|gridder|bishop[s ].*(?:slam|win|beat|fall|host)|intramural|sports? brief|v-ball|field hockey|wrestling|golf)\b/i;

const ARTS_ENTERTAINMENT_RE =
  /\b(album|film|movie|theater|theatre|concert|exhibit|gallery|sculpture|play\b.*(?:about|loyalty|love)|review|rock and roll|VCR|ceramics|photography|dance alloy|artist)\b/i;

const NEWS_RE =
  /\b(congress|senator|president(?!.*student)|pentagon|vietnam|soviet|nato|united nations|washington\s+d\.?c|national guard|federal|supreme court|AP|UPI)\b/i;

export const VALID_CATEGORIES: ReadonlySet<Article["category"]> = new Set([
  "Campus News",
  "News",
  "Sports",
  "Arts & Entertainment",
  "Opinion",
]);

/** Classify an OCR article into a frontend category using layered heuristics. */
export function classifyCategory(article: OcrArticle): Article["category"] {
  const author = article.author || "";
  const headline = article.headline || "";
  const bodyStart = (article.body || "").slice(0, 300);

  // 1. Explicit section tag in byline: "By NAME, Sports" or "By NAME Sports Editor"
  const afterComma = author.split(",").slice(1).join(",").trim().toLowerCase();
  if (afterComma) {
    const tag = afterComma.split(/\s/)[0];
    if (SECTION_MAP[tag]) return SECTION_MAP[tag];
  }

  // Also check "By NAME Sports Editor" pattern (no comma)
  const bylineWords = author.replace(/^by\s+/i, "").split(/\s+/);
  for (const word of bylineWords) {
    const section = SECTION_MAP[word.toLowerCase()];
    if (section && word[0] === word[0].toUpperCase()) {
      return section;
    }
  }

  // 2. Opinion: letters to the editor + editorials
  if (/^editor,?\s+the\s+transcript/i.test(bodyStart)) return "Opinion";
  if (/^by\s+editorial$/i.test(author.trim())) return "Opinion";
  if (/^by\s+editor/i.test(author.trim())) return "Opinion";
  if (/'\d{2}$/.test(author.trim())) return "Opinion"; // class year like '89, '90

  // 3. Headline keyword matching
  if (SPORTS_RE.test(headline)) return "Sports";
  if (ARTS_ENTERTAINMENT_RE.test(headline)) return "Arts & Entertainment";
  if (NEWS_RE.test(headline)) return "News";

  // 4. Default
  return "Campus News";
}
