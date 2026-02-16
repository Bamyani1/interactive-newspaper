import { readdir, readFile } from 'fs/promises';
import path from 'path';
import type { Article, AdCategory, EditionInfo, OcrArticle, OcrEdition, OcrEnrichedAd, VintageAd } from '@/src/types';

export type { Article, EditionInfo };

const EDITIONS_DIR = path.join(process.cwd(), 'public', 'editions');

// ---------- Helpers ----------

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function isValidImageFile(filename: string): boolean {
  return /\.(jpe?g|png|gif|webp|tiff?)$/i.test(filename);
}

/** Strip OCR page-break markers (e.g. "\n. 7\n") and convert paragraphs to HTML. */
function bodyToHtml(body: string): string {
  const cleaned = body.replace(/\n\. \d+\n/g, '\n');
  return cleaned
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => `<p>${escapeHtml(p)}</p>`)
    .join('\n');
}

function extractSummary(body: string): string {
  const cleaned = body.replace(/\n\. \d+\n/g, '\n');
  const first = cleaned.split(/\n\n/)[0]?.trim() || '';
  return first.length > 300 ? first.slice(0, 297) + '...' : first;
}

function imageUrls(date: string, imageFiles: string[] | undefined): string[] {
  if (!imageFiles) return [];
  return imageFiles
    .filter(f => isValidImageFile(f))
    .map(f => {
      const filename = f.replace(/^images\//, '');
      return `/api/editions/${date}/images/${encodeURIComponent(filename)}`;
    });
}

// Section keywords mapped to categories (used for byline tags + headline matching)
const SECTION_MAP: Record<string, string> = {
  sports: 'Sports',
  arts: 'Arts',
  entertainment: 'Arts',
  features: 'Features',
  feature: 'Features',
  opinion: 'Opinion',
  editorial: 'Opinion',
  academics: 'News',
  news: 'News',
};

const SPORTS_RE =
  /\b(basketball|football|baseball|soccer|track|tennis|swim|lacrosse|hoopster|cager|gridder|bishop[s ].*(?:slam|win|beat|fall|host)|intramural|sports? brief|v-ball|field hockey|wrestling|golf)\b/i;

const ARTS_RE =
  /\b(album|film|movie|theater|theatre|concert|exhibit|gallery|sculpture|play\b.*(?:about|loyalty|love)|review|rock and roll|VCR|ceramics|photography|dance alloy|artist)\b/i;

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
  if (ARTS_RE.test(headline)) return 'Arts';

  // 4. Default
  return 'News';
}

// ---------- Public API ----------

export function computePageCount(edition: OcrEdition): number {
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
  const entries = await readdir(EDITIONS_DIR, { withFileTypes: true });
  const editions: EditionInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !DATE_REGEX.test(entry.name)) continue;

    try {
      const raw = await readFile(
        path.join(EDITIONS_DIR, entry.name, 'edition.json'),
        'utf-8',
      );
      const edition: OcrEdition = JSON.parse(raw);

      editions.push({
        id: edition.edition_date,
        date: edition.edition_date,
        pageCount: computePageCount(edition),
        articleCount: edition.articles.length + edition.ads.length,
      });
    } catch {
      // Skip directories without valid edition.json
    }
  }

  return editions.sort((a, b) => b.date.localeCompare(a.date));
}

export async function loadEdition(date: string): Promise<OcrEdition | null> {
  if (!DATE_REGEX.test(date)) return null;

  try {
    const raw = await readFile(
      path.join(EDITIONS_DIR, date, 'edition.json'),
      'utf-8',
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function transformArticles(edition: OcrEdition): Article[] {
  const articles: Article[] = [];
  const date = edition.edition_date;

  for (let i = 0; i < edition.articles.length; i++) {
    const a = edition.articles[i];
    articles.push({
      id: `${date}-${i}`,
      date,
      category: classifyCategory(a) as Article['category'],
      headline: a.headline,
      summary: extractSummary(a.body),
      fullText: bodyToHtml(a.body),
      imageUrls: imageUrls(date, a.image_files),
      byline: a.author || null,
      page: parseInt(a.source_pages?.[0], 10) || 1,
      isHero: false,
      isFeatured: false,
      imageCaption: a.images?.[0]?.caption || null,
    });
  }

  // Assign hero & featured: prioritize articles with images
  const withImages = articles.filter(a => a.imageUrls.length > 0);
  const withoutImages = articles.filter(a => a.imageUrls.length === 0);
  const candidates = [...withImages, ...withoutImages];

  if (candidates.length > 0) {
    candidates[0].isHero = true;
    for (let i = 1; i < Math.min(5, candidates.length); i++) {
      candidates[i].isFeatured = true;
    }
  }

  return articles;
}

export function transformAds(edition: OcrEdition): VintageAd[] {
  const source = edition.enriched_ads ?? edition.ads ?? [];
  return source.map(ad => {
    const base: VintageAd = { title: ad.business_name, body: ad.body };
    if ('category' in ad) {
      const enriched = ad as OcrEnrichedAd;
      base.category = enriched.category as AdCategory;
      base.adType = enriched.ad_type as VintageAd['adType'];
      base.displayText = enriched.display_text;
      base.phone = enriched.phone || undefined;
      base.address = enriched.address || undefined;
      base.price = enriched.price || undefined;
    }
    return base;
  });
}
