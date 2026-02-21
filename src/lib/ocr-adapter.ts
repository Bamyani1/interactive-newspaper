import { readdir, readFile } from 'fs/promises';
import path from 'path';
import type { Article, AdCategory, AdType, EditionInfo, OcrArticle, OcrEdition, OcrEnrichedAd, VintageAd } from '@/src/types';

export type { Article, EditionInfo };

const EDITIONS_DIR = path.join(process.cwd(), 'public', 'editions');

// ---------- Helpers ----------

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Rejoin words split by hyphens across line/paragraph breaks (OCR artifact). */
function dehyphenate(text: string): string {
  return text.replace(/(\w)-\n+\s*([a-z])/g, "$1$2");
}

function isValidImageFile(filename: string): boolean {
  return /\.(jpe?g|png|gif|webp|tiff?)$/i.test(filename);
}

/** Detect and strip OCR preamble: letter salutations and role-title lines. */
function cleanBodyPreamble(
  body: string,
  hasAuthor: boolean,
): { body: string; roleTitle: string | null } {
  // 1. Strip letter-to-editor salutation (runs regardless of author)
  const breakIdx1 = body.indexOf('\n\n');
  if (breakIdx1 >= 0) {
    const firstParagraph = body.slice(0, breakIdx1).trim();
    if (/^Editor,?\s+the\s+Transcript:?\s*$/i.test(firstParagraph)) {
      body = body.slice(breakIdx1 + 2);
    }
  }

  // 2. Strip role-title line (existing logic, unchanged)
  if (!hasAuthor) return { body, roleTitle: null };

  const breakIdx2 = body.indexOf('\n\n');
  if (breakIdx2 < 0) return { body, roleTitle: null };

  const firstLine = body.slice(0, breakIdx2).trim();
  const words = firstLine.split(/\s+/);

  if (
    words.length <= 3 &&
    !/[.,!?;:]/.test(firstLine) &&
    words.every((w) => /^[A-Z]/.test(w))
  ) {
    return { body: body.slice(breakIdx2 + 2), roleTitle: firstLine };
  }

  return { body, roleTitle: null };
}

/** True when a caption is just the author's name/mugshot label, not real content. */
function isAuthorHeadshot(caption: string | undefined, authorName: string): boolean {
  if (!caption || !authorName) return false;
  const cap = caption.trim();
  const capWords = cap.split(/\s+/);
  if (capWords.length > 3 || /[,!?;:()]/.test(cap)) return false;
  const nameParts = authorName.toLowerCase().split(/\s+/);
  return capWords.some((w) => nameParts.includes(w.toLowerCase()));
}

/** Strip OCR page-break markers (e.g. "\n. 7\n") and convert paragraphs to HTML. */
function bodyToHtml(body: string): string {
  const dehyphenated = dehyphenate(body);
  const cleaned = dehyphenated.replace(/\n\. \d+\n/g, '\n');
  return cleaned
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => `<p>${escapeHtml(p)}</p>`)
    .join('\n');
}

function extractSummary(body: string): string {
  const dehyphenated = dehyphenate(body);
  const cleaned = dehyphenated.replace(/\n\. \d+\n/g, '\n');
  const first = cleaned.split(/\n\n/)[0]?.trim() || '';
  if (first.length <= 300) return first;
  const lastSpace = first.lastIndexOf(' ', 300);
  const boundary = lastSpace > 200 ? lastSpace : 297;
  return first.slice(0, boundary).trim() + '...';
}

// Section keywords mapped to categories (used for byline tags + headline matching)
const SECTION_MAP: Record<string, string> = {
  sports: 'Sports',
  arts: 'Arts & Entertainment',
  entertainment: 'Arts & Entertainment',
  opinion: 'Opinion',
  editorial: 'Opinion',
  academics: 'Campus News',
  news: 'News',
};

const SPORTS_RE =
  /\b(basketball|football|baseball|soccer|track|tennis|swim|lacrosse|hoopster|cager|gridder|bishop[s ].*(?:slam|win|beat|fall|host)|intramural|sports? brief|v-ball|field hockey|wrestling|golf)\b/i;

const ARTS_ENTERTAINMENT_RE =
  /\b(album|film|movie|theater|theatre|concert|exhibit|gallery|sculpture|play\b.*(?:about|loyalty|love)|review|rock and roll|VCR|ceramics|photography|dance alloy|artist)\b/i;

const NEWS_RE =
  /\b(congress|senator|president(?!.*student)|pentagon|vietnam|soviet|nato|united nations|washington\s+d\.?c|national guard|federal|supreme court|AP|UPI)\b/i;

/** Classify an OCR article into a frontend category using layered heuristics. */
function classifyCategory(article: OcrArticle): string {
  const author = article.author || '';
  const headline = article.headline || '';
  const bodyStart = (article.body || '').slice(0, 300);

  // 1. Explicit section tag in byline: "By NAME, Sports" or "By NAME Sports Editor"
  const afterComma = author.split(',').slice(1).join(',').trim().toLowerCase();
  if (afterComma) {
    const tag = afterComma.split(/\s/)[0];
    if (SECTION_MAP[tag]) return SECTION_MAP[tag];
  }
  // Also check "By NAME Sports Editor" pattern (no comma)
  const bylineWords = author.replace(/^by\s+/i, '').split(/\s+/);
  for (const word of bylineWords) {
    if (SECTION_MAP[word.toLowerCase()] && word[0] === word[0].toUpperCase()) {
      return SECTION_MAP[word.toLowerCase()];
    }
  }

  // 2. Opinion: letters to the editor + editorials
  if (/^editor,?\s+the\s+transcript/i.test(bodyStart)) return 'Opinion';
  if (/^by\s+editorial$/i.test(author.trim())) return 'Opinion';
  if (/^by\s+editor/i.test(author.trim())) return 'Opinion';
  if (/'\d{2}$/.test(author.trim())) return 'Opinion'; // class year like '89, '90

  // 3. Headline keyword matching
  if (SPORTS_RE.test(headline)) return 'Sports';
  if (ARTS_ENTERTAINMENT_RE.test(headline)) return 'Arts & Entertainment';
  if (NEWS_RE.test(headline)) return 'News';

  // 4. Default
  return 'Campus News';
}

// ---------- Module-level caches (editions are immutable, safe to cache indefinitely) ----------

let editionListCache: EditionInfo[] | null = null;
const editionCache = new Map<string, OcrEdition>();

// ---------- Public API ----------

export function computePageCount(edition: OcrEdition): number {
  if (!Array.isArray(edition.articles)) return 1;
  let max = 1;
  for (const article of edition.articles) {
    for (const p of article.source_pages ?? []) {
      const n = parseInt(p, 10);
      if (n > max) max = n;
    }
  }
  return max;
}

export async function listEditions(): Promise<EditionInfo[]> {
  if (editionListCache) return editionListCache;

  const entries = await readdir(EDITIONS_DIR, { withFileTypes: true });
  const editions: EditionInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !isIsoDate(entry.name)) continue;

    try {
      const edition = await loadEdition(entry.name); // Reuse loadEdition to also populate editionCache
      if (!edition) continue;

      editions.push({
        id: edition.edition_date,
        date: edition.edition_date,
        pageCount: computePageCount(edition),
        articleCount: edition.articles?.length ?? 0,
      });
    } catch {
      // Skip directories without valid edition.json
    }
  }

  editionListCache = editions.sort((a, b) => b.date.localeCompare(a.date));
  return editionListCache;
}

export async function loadEdition(date: string): Promise<OcrEdition | null> {
  if (!isIsoDate(date)) return null;

  const cached = editionCache.get(date);
  if (cached) return cached;

  try {
    const raw = await readFile(
      path.join(EDITIONS_DIR, date, 'edition.json'),
      'utf-8',
    );
    const edition: OcrEdition = JSON.parse(raw);
    editionCache.set(date, edition);
    return edition;
  } catch {
    return null;
  }
}

const VALID_CATEGORIES = new Set(['Campus News', 'News', 'Sports', 'Arts & Entertainment', 'Opinion']);

export function transformArticles(edition: OcrEdition): Article[] {
  const articles: Article[] = [];
  const date = edition.edition_date;
  if (!Array.isArray(edition.articles)) return articles;

  for (let i = 0; i < edition.articles.length; i++) {
    const a = edition.articles[i];
    const authorRaw = a.author === "null" ? "" : (a.author || "");
    const hasAuthor = Boolean(authorRaw);
    let { body: cleanBody, roleTitle } = cleanBodyPreamble(a.body ?? '', hasAuthor);

    let fullText = bodyToHtml(cleanBody);

    // Build raw image arrays (valid image files only)
    const rawEntries = (a.image_files ?? [])
      .map((f, idx) => ({ f, idx }))
      .filter(({ f }) => isValidImageFile(f));

    const rawImageUrls = rawEntries.map(({ f }) => {
      const filename = f.replace(/^images\//, '');
      return `/api/editions/${date}/images/${encodeURIComponent(filename)}`;
    });
    const rawImageCaptions: (string | null)[] = rawEntries.map(
      ({ idx }) => a.images?.[idx]?.caption || null,
    );

    // Filter out author headshots
    const authorName = authorRaw.replace(/^by\s+/i, '').trim();
    const filtered = rawImageUrls.map((url, idx) => ({
      url,
      caption: rawImageCaptions[idx],
    })).filter(({ caption }) => !isAuthorHeadshot(caption ?? undefined, authorName));

    const filteredImageUrls = filtered.map(({ url }) => url);
    const filteredImageCaptions = filtered.map(({ caption }) => caption);
    const imageCaption = filteredImageCaptions[0] || null;

    // Detect body/caption duplication: if the body text is essentially
    // the same as the image caption, treat as photo-only by clearing fullText.
    // Requires >80% overlap AND body < 200 chars to avoid clearing real content.
    if (imageCaption && fullText) {
      const bodyNorm = cleanBody.replace(/\s+/g, ' ').trim().toLowerCase();
      const capNorm = imageCaption.replace(/\s+/g, ' ').trim().toLowerCase();
      if (bodyNorm.length < 200 && bodyNorm.length > 0) {
        const shorter = bodyNorm.length <= capNorm.length ? bodyNorm : capNorm;
        const longer = bodyNorm.length <= capNorm.length ? capNorm : bodyNorm;
        if (longer.includes(shorter) && shorter.length / longer.length > 0.8) {
          fullText = '';
        }
      }
    }

    // Strip trailing caption text from body (OCR often appends captions as body paragraphs)
    if (filteredImageCaptions.length > 0 && cleanBody) {
      const paragraphs = cleanBody.split(/\n\n+/);
      if (paragraphs.length > 1) {
        const lastPara = paragraphs[paragraphs.length - 1].replace(/\s+/g, ' ').trim().toLowerCase();
        const captionMatch = filteredImageCaptions.some(cap => {
          if (!cap) return false;
          const capNorm = cap.replace(/\s+/g, ' ').trim().toLowerCase();
          if (capNorm.length < 20) return false;
          const shorter = lastPara.length <= capNorm.length ? lastPara : capNorm;
          const longer = lastPara.length <= capNorm.length ? capNorm : lastPara;
          return longer.includes(shorter) && shorter.length / longer.length > 0.7;
        });
        if (captionMatch) {
          paragraphs.pop();
          cleanBody = paragraphs.join('\n\n');
          fullText = bodyToHtml(cleanBody);
        }
      }
    }

    articles.push({
      id: `${date}-${i}`,
      date,
      category: (() => {
        const rawCat = edition.categories?.[i] ?? classifyCategory(a);
        return VALID_CATEGORIES.has(rawCat) ? rawCat : 'Campus News';
      })() as Article['category'],
      headline: a.headline ?? '',
      summary: extractSummary(cleanBody),
      fullText,
      imageUrls: filteredImageUrls,
      byline: authorRaw.replace(/^by\s+/i, '').trim() || null,
      writerPosition: a.writer_position || roleTitle || null,
      page: parseInt(a.source_pages?.[0], 10) || 1,
      isHero: false,
      isFeatured: false,
      imageCaption,
      imageCaptions: filteredImageCaptions,
    });
  }

  // Reclassify photo-only items as Arts & Entertainment
  for (const article of articles) {
    const plainText = article.fullText.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const hasHeadline = article.headline.trim().length > 0;
    const hasBody = plainText.length > 0;
    const hasImages = article.imageUrls.length > 0;
    if (!hasHeadline && !hasBody && hasImages) {
      article.category = "Arts & Entertainment";
    }
  }

  // Filter out empty and very-short text-only articles
  const filtered = articles.filter((article) => {
    const plainText = article.fullText.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const hasImages = article.imageUrls.length > 0;
    const hasHeadline = article.headline.trim().length > 0;

    // Remove completely empty articles (no headline, no text, no images)
    if (!hasHeadline && !plainText && !hasImages) return false;

    // Keep articles that have images (photo features)
    if (hasImages) return true;

    // Remove text-only articles that are too short (~less than 3 lines)
    return plainText.length >= 150;
  });

  // Assign hero & featured: prioritize articles with images (excluding photo-only items)
  const isPhotoOnly = (a: Article) => a.imageUrls.length > 0 && !a.headline.trim() && !a.fullText.replace(/<[^>]+>/g, "").trim();
  const withImages = filtered.filter(a => a.imageUrls.length > 0 && !isPhotoOnly(a));
  const withoutImages = filtered.filter(a => a.imageUrls.length === 0);
  const candidates = [...withImages, ...withoutImages];

  for (let i = 0; i < Math.min(5, candidates.length); i++) {
    candidates[i].isFeatured = true;
    if (i === 0) candidates[i].isHero = true;
  }

  return filtered;
}

const VALID_AD_CATEGORIES: ReadonlySet<string> = new Set<AdCategory>([
  "Food & Drink", "Entertainment", "Services", "Retail",
  "Greek Life", "Jobs", "Housing", "Education", "Events", "Other",
]);

const VALID_AD_TYPES: ReadonlySet<string> = new Set<AdType>(["display", "classified"]);

export function transformAds(edition: OcrEdition): VintageAd[] {
  const date = edition.edition_date;
  const source = edition.enriched_ads ?? edition.ads ?? [];
  if (!Array.isArray(source)) return [];
  return source.map(ad => {
    const base: VintageAd = { title: ad.business_name, body: ad.body };

    // Build image URLs from ad.image_files (same pattern as transformArticles)
    const imageUrls = (ad.image_files ?? [])
      .filter(f => isValidImageFile(f))
      .map(f => {
        const filename = f.replace(/^images\//, '');
        return `/api/editions/${date}/images/${encodeURIComponent(filename)}`;
      });
    if (imageUrls.length > 0) base.imageUrls = imageUrls;

    if ('category' in ad) {
      const enriched = ad as OcrEnrichedAd;
      base.category = VALID_AD_CATEGORIES.has(enriched.category)
        ? enriched.category as AdCategory
        : "Other";
      base.adType = VALID_AD_TYPES.has(enriched.ad_type)
        ? enriched.ad_type as AdType
        : undefined;
      base.displayText = enriched.display_text;
      base.phone = enriched.phone || undefined;
      base.address = enriched.address || undefined;
      base.price = enriched.price || undefined;
    }
    return base;
  });
}
