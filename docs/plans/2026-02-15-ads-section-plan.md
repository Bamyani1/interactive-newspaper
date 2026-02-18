# Ads Section Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the broken ads pipeline and create 10 authentic 1980s newspaper ad templates with deterministic assignment logic.

**Architecture:** Ads flow as a separate data type through the route response (not converted to/from Article). A pure `assignVariant()` function sorts ads into body-length tiers and cycles templates within each tier. VintageAd renders one of 10 template variants via a switch on the variant prop.

**Tech Stack:** Next.js (React), TypeScript, Tailwind CSS, Framer Motion, CSS custom properties

**Design doc:** `docs/plans/2026-02-15-ads-section-design.md`

---

### Task 1: Simplify VintageAd type

**Files:**
- Modify: `src/types/index.ts:33-41`

**Step 1: Update VintageAd interface**

Replace lines 33-41 in `src/types/index.ts`:

```typescript
export interface VintageAd {
    title: string;
    body: string;
}
```

Remove the optional fields: `subtitle`, `price`, `footer`, `tag`, `imageUrl`. Templates work with just `title` + `body`.

**Step 2: Remove "Ads" from Article category union**

In `src/types/index.ts:11`, change the category union to remove `"Ads"`:

```typescript
category: "News" | "Sports" | "Features" | "Opinion" | "Arts" | "Campus Life";
```

**Step 3: Update SectionId type**

In `src/types/index.ts:43`, SectionId still needs "Ads" since it's a navigation section. Change to:

```typescript
export type SectionId = "Top" | Article["category"] | "Ads" | "All";
```

**Step 4: Verify no TypeScript errors from type change**

Run: `npx tsc --noEmit 2>&1 | head -40`

Expected: Errors in files that reference the old VintageAd fields or "Ads" article category. These will be fixed in subsequent tasks.

**Step 5: Commit**

```bash
git add src/types/index.ts
git commit -m "refactor: simplify VintageAd type to title + body only"
```

---

### Task 2: Remove ad-to-Article conversion from ocr-adapter

**Files:**
- Modify: `src/lib/ocr-adapter.ts:159-217`

**Step 1: Remove the ads loop from transformArticles()**

In `src/lib/ocr-adapter.ts`, delete lines 182-199 (the `// Ads` loop that converts `OcrAd` to `Article`). The function should go directly from the articles loop (ending at line 180) to the hero/featured assignment (line 201).

The resulting `transformArticles()` should look like:

```typescript
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

  // ── Assign hero & featured: prioritize articles with images ──
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
```

Note: The `nonAds` filter on line 202 is no longer needed since no ads are in the articles array.

**Step 2: Add a transformAds() export**

Add this function after `transformArticles()`:

```typescript
export function transformAds(edition: OcrEdition): { title: string; body: string }[] {
  return edition.ads.map(ad => ({
    title: ad.business_name,
    body: ad.body,
  }));
}
```

**Step 3: Commit**

```bash
git add src/lib/ocr-adapter.ts
git commit -m "refactor: separate ad transformation from article pipeline"
```

---

### Task 3: Return ads separately from route handler

**Files:**
- Modify: `src/app/api/editions/[date]/route.ts`

**Step 1: Import transformAds**

Change the import on line 2:

```typescript
import { loadEdition, transformArticles, transformAds, computePageCount } from '@/src/lib/ocr-adapter';
```

**Step 2: Add ads to the response**

Change the `NextResponse.json()` call (lines 31-43) to include ads:

```typescript
const articles = transformArticles(edition);
const ads = transformAds(edition);
const pageCount = computePageCount(edition);

return NextResponse.json({
  edition: {
    id: date,
    date,
    pageCount,
    publicationInfo: edition.publication_info || '',
  },
  articles,
  ads,
  pagination: {
    nextCursor: null,
    hasMore: false,
  },
});
```

**Step 3: Commit**

```bash
git add src/app/api/editions/[date]/route.ts
git commit -m "feat: return ads as separate field in edition API response"
```

---

### Task 4: Update useEditionArticles hook to expose ads

**Files:**
- Modify: `src/features/news-feed/hooks/useEditionArticles.ts`

**Step 1: Add VintageAd import**

Add to the imports at the top:

```typescript
import type { Article, VintageAd } from "@/src/types";
```

**Step 2: Update EditionResponse interface**

Add `ads` field to the `EditionResponse` interface (after line 14):

```typescript
interface EditionResponse {
    edition: {
        id: string;
        date: string;
        pageCount: number;
    };
    articles: Article[];
    ads?: { title: string; body: string }[];
    pagination?: {
        nextCursor: string | null;
        hasMore: boolean;
    };
}
```

**Step 3: Update UseEditionArticlesResult interface**

Add `ads` to the return type:

```typescript
interface UseEditionArticlesResult {
    articles: Article[];
    ads: VintageAd[];
    hasActiveEdition: boolean;
    isLoading: boolean;
    error: Error | null;
}
```

**Step 4: Add ads state and populate it**

Add state for ads alongside the articles state (after line 58):

```typescript
const [ads, setAds] = useState<VintageAd[]>([]);
```

Inside the fetch logic, after `setArticles(mappedArticles)` (around line 160), add:

```typescript
setAds(data.ads ?? []);
```

Also reset ads when there's no date (inside the `if (!date)` block, after `setArticles([])`):

```typescript
setAds([]);
```

**Step 5: Update return value**

Change the return (line 180):

```typescript
return { articles, ads, hasActiveEdition: Boolean(date), isLoading, error };
```

**Step 6: Commit**

```bash
git add src/features/news-feed/hooks/useEditionArticles.ts
git commit -m "feat: expose ads from useEditionArticles hook"
```

---

### Task 5: Update NewsFeed to receive ads from hook + update edition page

**Files:**
- Modify: `src/features/news-feed/components/NewsFeed.tsx`
- Modify: `src/app/edition/[date]/page.tsx`

**Step 1: Add ads prop to NewsFeed**

In `src/features/news-feed/components/NewsFeed.tsx`, update the `NewsFeedProps` interface (lines 48-55):

```typescript
interface NewsFeedProps {
    articles: Article[];
    ads: VintageAd[];
    editionDate: string | null;
    editions: string[];
    onDateChange: (date: string) => void;
    activeSection: SectionId;
    onSectionChange: (section: SectionId) => void;
}
```

**Step 2: Destructure ads prop**

Update the component destructuring (line 57-64) to include `ads`:

```typescript
export const NewsFeed: React.FC<NewsFeedProps> = ({
    articles,
    ads,
    editionDate,
    editions,
    onDateChange,
    activeSection,
    onSectionChange,
}) => {
```

**Step 3: Remove the old ads useMemo**

Delete lines 89-107 (the `context` useMemo and the `ads` useMemo that extracts ads from articles). Also remove the `getClosestContext` import from line 6.

**Step 4: Remove Ads filtering from heroSource and groupedArticles**

Lines 109-111 — `heroSource` no longer needs `a.category !== "Ads"` filter since articles don't contain ads anymore:

```typescript
const heroSource = useMemo(
    () => daysArticles,
    [daysArticles]
);
```

Lines 119-121 — `featuredArticles` no longer needs `a.category !== "Ads"` filter:

```typescript
const featuredArticles = useMemo(
    () => daysArticles.filter(a => a.isFeatured && a.id !== heroArticle?.id),
    [daysArticles, heroArticle]
);
```

Lines 124-130 — `groupedArticles` no longer needs to worry about "Ads" category since articles don't include them.

**Step 5: Update the edition page to pass ads**

In `src/app/edition/[date]/page.tsx`, update the hook destructuring (lines 99-103):

```typescript
const {
    articles,
    ads,
    hasActiveEdition,
    isLoading: isLoadingArticles,
} = useEditionArticles(currentDate);
```

Remove the `context` useMemo (lines 105-108) and the `getClosestContext` import from line 12.

Update the sections computation (lines 113-135) to use `ads.length` instead of counting "Ads" articles:

```typescript
const sections = useMemo(() => {
    const counts = SECTION_ORDER.map((category) => ({
        id: category as SectionId,
        label: category,
        count: articlesForDate.filter((article) => article.category === category).length,
    }));

    const filtered = counts.filter((item) => item.count > 0);

    const result = [
        { id: "Top" as SectionId, label: "Top Stories" },
        ...filtered,
    ];

    if (ads.length > 0) {
        result.push({ id: "Ads" as SectionId, label: "Ads", count: ads.length });
    }

    return result;
}, [articlesForDate, ads]);
```

Pass `ads` to NewsFeed (around line 172):

```typescript
<NewsFeed
    key={currentDate ?? "no-edition"}
    articles={articles}
    ads={ads}
    editionDate={currentDate}
    editions={editions}
    onDateChange={onDateChange}
    activeSection={activeSection}
    onSectionChange={handleSectionChange}
/>
```

**Step 6: Remove "Ads" from SECTION_ORDER**

In `src/features/news-feed/components/NewsFeed.tsx`, update `SECTION_ORDER` (lines 18-26) to remove "Ads" since ads are handled separately:

```typescript
export const SECTION_ORDER: Article["category"][] = [
    "News",
    "Sports",
    "Features",
    "Opinion",
    "Arts",
    "Campus Life",
];
```

**Step 7: Run dev server and check for compile errors**

Run: `npx next build 2>&1 | tail -30`

Fix any remaining TypeScript errors from the refactor.

**Step 8: Commit**

```bash
git add src/features/news-feed/components/NewsFeed.tsx src/app/edition/[date]/page.tsx
git commit -m "refactor: pass ads directly to NewsFeed, remove lossy conversion"
```

---

### Task 6: Clean up mockData and unused imports

**Files:**
- Modify: `src/features/news-feed/data/mockData.ts`
- Modify: `src/features/news-feed/index.ts`

**Step 1: Remove ads from mockData**

In `src/features/news-feed/data/mockData.ts`, remove the `ads` field from `getClosestContext()`:

```typescript
export const getClosestContext = (date: string) => {
    return {
        weather: "Cloudy, 55°F",
        history: [] as string[],
    };
};
```

Remove the unused VintageAd re-export from line 8:

```typescript
export type { Article } from "@/src/types";
```

**Step 2: Update barrel export**

In `src/features/news-feed/index.ts`, check if `getClosestContext` is still imported elsewhere. If no longer needed (after removing from edition page), remove it:

```typescript
// News Feed Feature - Public API
export { NewsFeed } from "./components/NewsFeed";
export { ArticleCard } from "./components/ArticleCard";
export { VintageAd } from "./components/VintageAd";
export { useEditionArticles } from "./hooks/useEditionArticles";
export { useEditions } from "./hooks/useEditions";
export { getClosestContext } from "./data/mockData";
```

Keep `getClosestContext` if it's used elsewhere for weather/history data. Remove only the ads-related parts.

**Step 3: Commit**

```bash
git add src/features/news-feed/data/mockData.ts src/features/news-feed/index.ts
git commit -m "chore: remove ads from mock data and clean up exports"
```

---

### Task 7: Implement ad variant assignment logic

**Files:**
- Modify: `src/features/news-feed/components/AdsBoard.tsx`

**Step 1: Define variant types and assignment function**

Replace the current `VARIANTS` array (lines 13-17) with the tier-based assignment logic:

```typescript
export type AdVariant =
    | 'tiny-liner' | 'boxed-notice' | 'mini-display'
    | 'retail-coupon' | 'service-card' | 'bulletin' | 'marquee'
    | 'broadsheet' | 'editorial-style' | 'showcase';

const SHORT_VARIANTS: AdVariant[] = ['tiny-liner', 'boxed-notice', 'mini-display'];
const MEDIUM_VARIANTS: AdVariant[] = ['retail-coupon', 'service-card', 'bulletin', 'marquee'];
const LONG_VARIANTS: AdVariant[] = ['broadsheet', 'editorial-style', 'showcase'];

function assignVariant(bodyLength: number, indexInTier: number): AdVariant {
    if (bodyLength < 80) {
        return SHORT_VARIANTS[indexInTier % SHORT_VARIANTS.length];
    }
    if (bodyLength <= 350) {
        return MEDIUM_VARIANTS[indexInTier % MEDIUM_VARIANTS.length];
    }
    return LONG_VARIANTS[indexInTier % LONG_VARIANTS.length];
}

function isLongVariant(variant: AdVariant): boolean {
    return LONG_VARIANTS.includes(variant);
}
```

**Step 2: Update AdsBoard grid and assignment**

Replace the render logic to use tier-based assignment with col-span for long ads:

```typescript
export const AdsBoard: React.FC<AdsBoardProps> = ({ ads }) => {
    const gridVariants = staggerContainer(0.1, 0.1);
    const cardVariants = fadeUp(14);

    // Pre-compute variants with tier indexing
    const adsWithVariants = useMemo(() => {
        const tierCounters = { short: 0, medium: 0, long: 0 };
        return ads.map(ad => {
            const len = ad.body.length;
            const tier = len < 80 ? 'short' : len <= 350 ? 'medium' : 'long';
            const variant = assignVariant(len, tierCounters[tier]);
            tierCounters[tier]++;
            return { ad, variant };
        });
    }, [ads]);

    if (!ads?.length) {
        return (
            <section className="p-10 text-center border border-dashed rounded-md opacity-70">
                <p className="font-header text-xl uppercase tracking-widest">
                    No ads available
                </p>
                <p className="font-typewriter text-sm mt-2">
                    Check back for classifieds, coupons, and campus specials.
                </p>
            </section>
        );
    }

    return (
        <section className="w-full">
            <motion.div
                className="flex items-center justify-between border-b pb-3 mb-6"
                variants={fadeUp(12)}
                initial="hidden"
                animate="show"
                transition={TRANSITIONS.base}
            >
                <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.35em] opacity-70">
                        Ads & Notices
                    </p>
                    <h3 className="font-header text-2xl md:text-3xl leading-tight">
                        Ad Board
                    </h3>
                </div>
                <span className="px-3 py-1 border border-[var(--color-text-primary)] text-xs uppercase tracking-widest font-semibold">
                    {ads.length} {ads.length === 1 ? "Listing" : "Listings"}
                </span>
            </motion.div>

            <motion.div
                className="grid gap-4 md:gap-6 grid-cols-1 sm:grid-cols-2"
                variants={gridVariants}
                initial="hidden"
                animate="show"
            >
                {adsWithVariants.map(({ ad, variant }, idx) => (
                    <motion.div
                        key={`${ad.title}-${idx}`}
                        className={`h-full ${isLongVariant(variant) ? 'sm:col-span-2' : ''}`}
                        variants={cardVariants}
                        transition={TRANSITIONS.base}
                    >
                        <VintageAd ad={ad} variant={variant} />
                    </motion.div>
                ))}
            </motion.div>
        </section>
    );
};
```

Add `useMemo` to the React import at the top of the file.

**Step 3: Update VintageAd import to use new variant type**

Update the import of VintageAd to also import the type if needed. The VintageAd component's props will be updated in the next task.

**Step 4: Commit**

```bash
git add src/features/news-feed/components/AdsBoard.tsx
git commit -m "feat: add body-length tier assignment logic for 10 ad variants"
```

---

### Task 8: Build the 10 VintageAd templates

**Files:**
- Modify: `src/features/news-feed/components/VintageAd.tsx`

This is the largest task. Replace the entire VintageAd component with 10 authentic 1980s newspaper ad templates.

**Step 1: Replace VintageAd.tsx**

Replace the entire file content with the 10 templates. Import `AdVariant` from AdsBoard.

All templates:
- Accept `{ ad: VintageAd; variant: AdVariant }` props
- Use only `ad.title` and `ad.body`
- Use CSS custom properties for colors
- Use `font-header`, `font-typewriter`, `font-serif` font tokens
- Render `ad.body` with `whitespace-pre-line` to preserve line breaks from OCR data

The component should be structured as:

```typescript
"use client";

import React from "react";
import type { VintageAd as VintageAdType } from "@/src/types";
import type { AdVariant } from "./AdsBoard";

interface VintageAdProps {
    ad: VintageAdType;
    variant: AdVariant;
}

export const VintageAd: React.FC<VintageAdProps> = ({ ad, variant }) => {
    switch (variant) {
        case 'tiny-liner':
            return <TinyLiner ad={ad} />;
        case 'boxed-notice':
            return <BoxedNotice ad={ad} />;
        case 'mini-display':
            return <MiniDisplay ad={ad} />;
        case 'retail-coupon':
            return <RetailCoupon ad={ad} />;
        case 'service-card':
            return <ServiceCard ad={ad} />;
        case 'bulletin':
            return <Bulletin ad={ad} />;
        case 'marquee':
            return <Marquee ad={ad} />;
        case 'broadsheet':
            return <Broadsheet ad={ad} />;
        case 'editorial-style':
            return <EditorialStyle ad={ad} />;
        case 'showcase':
            return <Showcase ad={ad} />;
    }
};
```

Then implement each template as a small function component. Guidelines for each:

**SHORT TIER (< 80 chars body):**

1. **TinyLiner** — Minimal classified listing:
   - Thin horizontal rule top/bottom
   - Business name in bold uppercase, inline with body
   - Body in monospace, compact
   - No padding, dense feel
   - Think: "BOB'S BASEBALL CARDS — 10 S. Sandusky St..."

2. **BoxedNotice** — Small bordered notice:
   - 3px solid border
   - Business name centered, bold
   - Body centered below
   - Minimal padding
   - Think: PSA or short announcement

3. **MiniDisplay** — Dotted border display:
   - Dotted/stippled border
   - Business name in caps with wide letter-spacing
   - Body centered
   - Slightly more padding than TinyLiner

**MEDIUM TIER (80-350 chars body):**

4. **RetailCoupon** — Dashed coupon style:
   - Dashed border (simulating scissor cut)
   - "COUPON" or "CLIP & SAVE" label rotated in corner
   - Business name large and bold
   - Body text left-aligned
   - Dashed horizontal tear-line separator near bottom
   - Price-tag feel

5. **ServiceCard** — Professional service card:
   - Double line at top (border-top with box-shadow trick)
   - Business name in serif font
   - Body left-aligned in typewriter font
   - Bottom rule
   - Clean, professional feel

6. **Bulletin** — Campus bulletin board:
   - Slightly rotated (transform: rotate(-1deg))
   - Push-pin emoji or dot at top center
   - Rough/informal border
   - Body in typewriter
   - Paper-pinned-to-corkboard feel

7. **Marquee** — Entertainment/event style:
   - Row of stars (★) or dots as top/bottom border
   - Business name in large all-caps
   - Body centered
   - Decorative feel, like a theater or event listing

**LONG TIER (> 350 chars body):**

8. **Broadsheet** — Full display ad:
   - Heavy 4px top border
   - Drop cap on first letter of body (first-letter pseudo via span)
   - Body in two visual sections (title area + body area)
   - Newspaper editorial column feel
   - Full width (col-span-2)

9. **EditorialStyle** — Advertorial:
   - "— ADVERTISEMENT —" label at very top in small caps
   - Business name as headline
   - Body flows like editorial copy (justified text)
   - Thin border, understated
   - Full width (col-span-2)

10. **Showcase** — Feature display:
    - Ornamental corner characters (╔ ╗ ╚ ╝ or similar)
    - Business name large, centered, stacked typography
    - Body centered
    - Bold, eye-catching
    - Full width (col-span-2)

**Important rendering detail for all templates:**

The body text from OCR contains `\n` for line breaks. Use `whitespace-pre-line` on the body element so these render naturally. Do NOT split into paragraphs or HTML — keep it raw.

**Step 2: Verify all templates render**

Run: `npm run dev`

Navigate to the edition page and click the Ads section tab. All 18 ads should render with varied templates.

**Step 3: Commit**

```bash
git add src/features/news-feed/components/VintageAd.tsx
git commit -m "feat: implement 10 authentic 1980s newspaper ad templates"
```

---

### Task 9: Visual verification and edge case fixes

**Files:**
- Potentially modify: `src/features/news-feed/components/VintageAd.tsx`
- Potentially modify: `src/features/news-feed/components/AdsBoard.tsx`

**Step 1: Verify all 18 ads render**

Start dev server: `npm run dev`

Navigate to `/edition/1988-10-12` and click the "Ads" section.

Check each ad renders without:
- Overflow (text spilling outside borders)
- Missing text (empty title or body)
- Broken borders or layout
- Inconsistent spacing

**Step 2: Check tier distribution**

The 18 ads in the current edition should distribute roughly as:
- Short (< 80 chars): ~3-4 ads (PSA, Del Rx, Heads Up, Bob's Baseball Cards)
- Medium (80-350 chars): ~8-9 ads (Thunderbird, Outer Layer, Robinson's, etc.)
- Long (> 350 chars): ~5-6 ads (Kerr Eyecare, Welch Snack Shop, Carroll's Jewelers, etc.)

Verify the visual variety looks natural.

**Step 3: Check dark mode / light mode**

Toggle the theme and verify all templates work in both modes since they use CSS custom properties.

**Step 4: Check mobile responsiveness**

Resize browser to mobile width. Verify:
- Grid collapses to 1 column
- Long-tier ads no longer try to col-span-2 (grid is 1 col)
- All text remains readable

**Step 5: Fix any issues found**

Apply minimal fixes. Likely issues:
- Very long body text may need `line-clamp` or max-height
- Some templates may need padding adjustments
- Font sizes may need tweaking for readability

**Step 6: Commit**

```bash
git add -A
git commit -m "fix: address ad template edge cases and visual polish"
```

---

### Task 10: Final build verification

**Step 1: Run production build**

Run: `npx next build 2>&1 | tail -20`

Expected: Build succeeds with no errors.

**Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit`

Expected: No errors.

**Step 3: Commit any remaining fixes**

If build revealed issues, fix and commit.

```bash
git add -A
git commit -m "chore: fix build errors from ads section refactor"
```
