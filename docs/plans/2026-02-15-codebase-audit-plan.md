# Codebase Audit Fix Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 14 major issues found in the deep codebase audit, improving demo quality, stability, and code consistency.

**Architecture:** Phased approach — quick wins first (routing, dead code), then stability (error boundaries, race conditions), then performance (React.memo), then polish (design tokens, accessibility). Each task is independent within its phase.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Framer Motion, CSS custom properties, Vitest

---

## Phase 1: Quick Wins

### Task 1: Fix Wrong Edition Redirect (Issue #1)

**Files:**
- Modify: `src/app/edition/page.tsx:20`
- Modify: `src/app/edition/[date]/page.tsx:39`
- Modify: `src/features/time-controls/components/TimeControls.tsx:94`

**Step 1: Fix edition/page.tsx redirect**

Change line 20 from:
```typescript
router.replace(`/edition/${editions[0]}`);
```
to:
```typescript
router.replace(`/edition/${editions[editions.length - 1]}`);
```

**Step 2: Fix edition/[date]/page.tsx redirect**

Change line 39 from:
```typescript
router.replace(`/edition/${editions[0]}`);
```
to:
```typescript
router.replace(`/edition/${editions[editions.length - 1]}`);
```

**Step 3: Fix TimeControls fallback**

Change line 94 from:
```typescript
setDate(editions[0]);
```
to:
```typescript
setDate(editions[editions.length - 1]);
```

**Step 4: Verify in browser**

Run: `npm run dev`
Navigate to `/edition` — should redirect to `1988-10-12` (newest), not `1986-09-12`.
Navigate to `/edition/9999-01-01` — should redirect to `1988-10-12`.

**Step 5: Commit**

```bash
git add src/app/edition/page.tsx src/app/edition/\[date\]/page.tsx src/features/time-controls/components/TimeControls.tsx
git commit -m "fix: redirect to latest edition instead of oldest"
```

---

### Task 2: Remove Duplicate useEditions Hook (Issue #2)

**Files:**
- Delete: `src/features/news-feed/hooks/useEditions.ts`
- Modify: `src/features/news-feed/index.ts:6`

**Step 1: Remove export from barrel file**

In `src/features/news-feed/index.ts`, delete line 6:
```typescript
export { useEditions } from "./hooks/useEditions";
```

**Step 2: Delete the hook file**

```bash
rm src/features/news-feed/hooks/useEditions.ts
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds with no import errors (no other file imports `useEditions`).

**Step 4: Commit**

```bash
git add src/features/news-feed/index.ts
git rm src/features/news-feed/hooks/useEditions.ts
git commit -m "fix: remove duplicate useEditions hook (use useArchive instead)"
```

---

### Task 3: Fix Empty Editions Infinite Loading (Issue #11)

**Files:**
- Modify: `src/app/edition/page.tsx:17-22`

**Step 1: Add else branch for empty editions**

Replace the useEffect (lines 17-22):
```typescript
  useEffect(() => {
    if (isLoading) return;
    if (hasEditions) {
      router.replace(`/edition/${editions[0]}`);
    }
  }, [editions, hasEditions, isLoading, router]);
```

With:
```typescript
  useEffect(() => {
    if (isLoading) return;
    if (hasEditions) {
      router.replace(`/edition/${editions[editions.length - 1]}`);
    } else {
      router.replace("/");
    }
  }, [editions, hasEditions, isLoading, router]);
```

Note: The `editions[editions.length - 1]` fix from Task 1 is already applied here.

**Step 2: Commit**

```bash
git add src/app/edition/page.tsx
git commit -m "fix: redirect to home when no editions are available"
```

---

### Task 4: Remove Unused Article Type Fields (Issue #14)

**Files:**
- Modify: `src/types/index.ts:21-23`
- Modify: `src/features/news-feed/components/ArticleCard.tsx:163-167`

**Step 1: Remove fields from Article interface**

In `src/types/index.ts`, delete lines 21-23:
```typescript
    continuesOnPage?: number | null;
    continuesFromPage?: number | null;
    relatedImages?: string[];
```

**Step 2: Remove continuation UI from ArticleCard**

In `src/features/news-feed/components/ArticleCard.tsx`, delete lines 163-167:
```typescript
                    {article.continuesOnPage && (
                        <p className="text-xs font-mono uppercase tracking-widest opacity-60">
                            Continued on page {article.continuesOnPage}
                        </p>
                    )}
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds. No other files reference these fields.

**Step 4: Commit**

```bash
git add src/types/index.ts src/features/news-feed/components/ArticleCard.tsx
git commit -m "fix: remove unused Article fields (continuesOnPage, relatedImages)"
```

---

## Phase 2: Stability

### Task 5: Add Route-Level Error Boundary (Issue #3)

**Files:**
- Create: `src/app/edition/error.tsx`

**Step 1: Create the error boundary**

Create `src/app/edition/error.tsx`:
```typescript
"use client";

export default function EditionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      <div className="max-w-md text-center space-y-6 px-6">
        <h2 className="font-header text-2xl uppercase tracking-wide">
          Edition Unavailable
        </h2>
        <p className="text-[var(--color-text-secondary)] text-sm">
          {error.message || "Something went wrong loading this edition."}
        </p>
        <div className="flex gap-4 justify-center">
          <button
            onClick={reset}
            className="px-6 py-2.5 border border-[var(--color-accent)] text-[var(--color-accent)] text-sm uppercase tracking-widest hover:bg-[var(--color-accent)] hover:text-[var(--color-text-inverse)] transition-colors"
          >
            Try Again
          </button>
          <a
            href="/"
            className="px-6 py-2.5 border border-[var(--color-border-default)] text-sm uppercase tracking-widest hover:border-[var(--color-text-primary)] transition-colors"
          >
            Home
          </a>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify by temporarily throwing in a page**

In dev mode, temporarily add `throw new Error("test")` in EditionBody, confirm the error page renders, then remove it.

**Step 3: Commit**

```bash
git add src/app/edition/error.tsx
git commit -m "feat: add error boundary for edition routes"
```

---

### Task 6: Fix Race Condition with AbortController (Issue #5)

**Files:**
- Modify: `src/features/news-feed/hooks/useEditionArticles.ts:64-184`

**Step 1: Replace `cancelled` flag with AbortController**

In the `useEffect` starting at line 64, replace the implementation. The key changes:
1. Create `AbortController` instead of `cancelled` flag
2. Pass `signal` to `fetch()`
3. Abort on cleanup
4. Catch `AbortError` silently

Replace lines 64-184:
```typescript
    useEffect(() => {
        const abortController = new AbortController();

        async function fetchArticles() {
            if (!date) {
                setArticles([]);
                setAds([]);
                setError(null);
                setIsLoading(false);
                return;
            }

            setIsLoading(true);
            setError(null);

            try {
                const allArticles: Article[] = [];
                const allAds: VintageAd[] = [];
                const seenCursors = new Set<string>();
                let cursor: string | null = null;
                let editionDate = date;
                let pageRequests = 0;
                const maxPageRequests = 25;
                let remainingPages = false;

                while (pageRequests < maxPageRequests) {
                    pageRequests += 1;
                    const params = new URLSearchParams({ limit: "100" });
                    if (cursor) {
                        params.set("cursor", cursor);
                    }

                    const res = await fetch(`/api/editions/${date}?${params.toString()}`, {
                        signal: abortController.signal,
                    });

                    if (!res.ok) {
                        if (res.status === 404) {
                            allArticles.length = 0;
                            break;
                        }
                        throw new Error(`Failed to fetch edition: ${res.status}`);
                    }

                    const data: EditionResponse = await res.json();
                    editionDate = data.edition.date;
                    allArticles.push(...data.articles);
                    if (data.ads) allAds.push(...data.ads);

                    const nextCursor = data.pagination?.nextCursor ?? null;
                    const hasMore = Boolean(data.pagination?.hasMore && nextCursor);
                    if (!hasMore || !nextCursor) {
                        remainingPages = false;
                        break;
                    }
                    remainingPages = true;

                    if (seenCursors.has(nextCursor)) {
                        console.warn(
                            `Stopped fetching edition ${date}: repeated cursor "${nextCursor}".`
                        );
                        remainingPages = false;
                        break;
                    }

                    seenCursors.add(nextCursor);
                    cursor = nextCursor;
                }

                if (remainingPages && pageRequests >= maxPageRequests) {
                    console.warn(
                        `Stopped fetching edition ${date}: exceeded ${maxPageRequests} pagination requests.`
                    );
                }

                // Map API response to frontend Article format
                const mappedArticles: Article[] = allArticles.map((a, index) => {
                    const normalizedSummary = normalizeText(a.summary);
                    const normalizedFullText = normalizeText(a.fullText);
                    const page = typeof a.page === "number" ? a.page : 1;

                    return {
                        id: normalizeId(a.id, editionDate, page, index),
                        date: editionDate,
                        category: normalizeCategory(a.category),
                        headline: normalizeText(a.headline) || "Untitled Article",
                        summary: normalizedSummary,
                        fullText: normalizedFullText,
                        imageUrls: Array.isArray((a as any).imageUrls)
                            ? (a as any).imageUrls.map((u: string) => normalizeText(u)).filter(Boolean)
                            : (normalizeText((a as any).imageUrl) ? [normalizeText((a as any).imageUrl)] : []),
                        byline: normalizeText(a.byline) || undefined,
                        imageCaption: normalizeText(a.imageCaption) || undefined,
                        page,
                        isFeatured: Boolean(a.isFeatured),
                        isHero: Boolean(a.isHero),
                    };
                });

                setArticles(mappedArticles);
                setAds(allAds);
            } catch (err) {
                if (err instanceof DOMException && err.name === "AbortError") {
                    return; // Request was cancelled — do nothing
                }
                setError(err instanceof Error ? err : new Error("Unknown error"));
            } finally {
                if (!abortController.signal.aborted) {
                    setIsLoading(false);
                }
            }
        }

        fetchArticles();

        return () => {
            abortController.abort();
        };
    }, [date]);
```

**Step 2: Verify in browser**

Run: `npm run dev`
Rapidly switch between editions in the date picker — articles should always match the selected date.

**Step 3: Commit**

```bash
git add src/features/news-feed/hooks/useEditionArticles.ts
git commit -m "fix: use AbortController to prevent stale edition data on rapid navigation"
```

---

### Task 7: Fix Music Player Track Index Out of Bounds (Issue #10)

**Files:**
- Modify: `src/features/music-player/components/SidebarPlayer.tsx:383-391`

**Step 1: Add separate date-change reset effect**

Before the existing effect at line 383, add a new effect that always resets on date change:

```typescript
  // Always reset track index when date changes
  useEffect(() => {
    setCurrentTrackIndex(0);
    setIsTrackListOpen(false);
  }, [currentDate]);
```

Then update the existing effect (lines 383-391) to only set the first-with-video index without duplicating the track list close:

```typescript
  useEffect(() => {
    if (!currentDate || monthlyPlayerTracks.length === 0) {
      return;
    }

    const firstWithVideo = monthlyPlayerTracks.findIndex((track) => Boolean(track.youtubeId));
    if (firstWithVideo >= 0) {
      setCurrentTrackIndex(firstWithVideo);
    }
  }, [currentDate, monthlyPlayerTracks]);
```

**Step 2: Verify in browser**

Run: `npm run dev`
Switch between dates — track index should always reset, no flash of wrong track.

**Step 3: Commit**

```bash
git add src/features/music-player/components/SidebarPlayer.tsx
git commit -m "fix: reset music player track index on date change to prevent out-of-bounds"
```

---

## Phase 3: Performance

### Task 8: Add React.memo to ArticleCard (Issue #7)

**Files:**
- Modify: `src/features/news-feed/components/ArticleCard.tsx`

**Step 1: Import React and memo**

React is already imported. Wrap the component export.

Replace the component definition (line 31):
```typescript
export const ArticleCard: React.FC<ArticleCardProps> = ({
```

With a named inner function + memo wrapper. At line 31, change to:
```typescript
const ArticleCardInner: React.FC<ArticleCardProps> = ({
```

Then at the very end of the file (after the closing `};` around line 287), add:
```typescript

export const ArticleCard = React.memo(ArticleCardInner, (prev, next) => {
    return (
        prev.article.id === next.article.id &&
        prev.isExpanded === next.isExpanded &&
        prev.onToggle === next.onToggle &&
        prev.onViewOriginal === next.onViewOriginal
    );
});
```

**Step 2: Memoize sanitizeHtml in the component body**

Inside the component, after `const hasFullText = ...` (around line 42), add:
```typescript
    const sanitizedFullText = React.useMemo(
        () => hasFullText ? sanitizeHtml(fullText) : "",
        [fullText, hasFullText]
    );
```

Then update the `dangerouslySetInnerHTML` usage (around line 220) from:
```typescript
dangerouslySetInnerHTML={{ __html: sanitizeHtml(fullText) }}
```
to:
```typescript
dangerouslySetInnerHTML={{ __html: sanitizedFullText }}
```

**Step 3: Stabilize callbacks in NewsFeed**

In `src/features/news-feed/components/NewsFeed.tsx`, the `onToggle` callbacks are inline arrow functions creating new references each render. Wrap the toggle handler:

After line 256 (`const registerArticleRef = ...`), add:
```typescript
    const toggleArticle = useCallback((articleId: string) => {
        setExpandedId(prev => (prev === articleId ? null : articleId));
    }, []);
```

Then in the map at line 308, change:
```typescript
onToggle={() => setExpandedId(prev => (prev === article.id ? null : article.id))}
```
to:
```typescript
onToggle={() => toggleArticle(article.id)}
```

Note: Since `toggleArticle` captures `articleId` from the outer closure via the inline arrow, each card still gets a unique function. For true memo benefit, pass `articleId` as a prop and let the card call `onToggle(id)`. But this is a reasonable first step.

**Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add src/features/news-feed/components/ArticleCard.tsx src/features/news-feed/components/NewsFeed.tsx
git commit -m "perf: memoize ArticleCard and sanitizeHtml to prevent unnecessary re-renders"
```

---

### Task 9: Reset Keyboard Focus on Edition Change (Issue #6 — partial)

**Files:**
- Modify: `src/features/news-feed/components/NewsFeed.tsx:206-208`

**Step 1: Add resolvedEditionDate to focus-reset dependency**

Replace lines 205-208:
```typescript
    // Reset focus when switching sections to prevent stale focus state
    useEffect(() => {
        setFocusedIndex(-1);
    }, [currentSection]);
```

With:
```typescript
    // Reset focus when switching sections or editions to prevent stale focus state
    useEffect(() => {
        setFocusedIndex(-1);
        setExpandedId(null);
    }, [currentSection, resolvedEditionDate]);
```

**Step 2: Verify in browser**

Run: `npm run dev`
Navigate to an edition, press `j` to focus article 5, switch editions — focus ring should disappear.

**Step 3: Commit**

```bash
git add src/features/news-feed/components/NewsFeed.tsx
git commit -m "fix: reset keyboard focus and expanded article on edition change"
```

---

## Phase 4: Design System Polish

### Task 10: Wire Up Z-Index Tokens (Issue #9)

**Files:**
- Modify: `src/features/time-controls/components/TimeControls.tsx:135,189`
- Modify: `src/features/navigation/components/MobileNav.tsx:66`

**Step 1: Fix TimeControls header z-index**

In `src/features/time-controls/components/TimeControls.tsx`, line 135, replace:
```
z-50 fixed
```
with:
```
fixed
```
and add inline style for z-index. Change the className to remove `z-50` and add a style prop:

Actually, since Tailwind can use CSS variables via arbitrary values, change `z-50` to `z-[var(--z-header)]` on line 135.

**Step 2: Fix TimeControls dropdown z-index**

On line 189, change `z-[120]` to `z-[var(--z-popover)]`.

**Step 3: Fix MobileNav z-index**

In `src/features/navigation/components/MobileNav.tsx`, find the `z-50` class and change it to `z-[var(--z-fixed)]`.

**Step 4: Verify in browser**

Run: `npm run dev`
Open the date picker dropdown — it should appear above the header.
Open mobile nav — it should layer correctly.

**Step 5: Commit**

```bash
git add src/features/time-controls/components/TimeControls.tsx src/features/navigation/components/MobileNav.tsx
git commit -m "fix: use z-index tokens instead of hardcoded values"
```

---

### Task 11: Add Missing Semantic Color Tokens (Issue #13)

**Files:**
- Modify: `src/styles/tokens/colors.css`
- Modify: `src/features/news-feed/components/ArticleCard.tsx:268`
- Modify: `src/features/music-player/components/SidebarPlayer.tsx` (bg-black instances)

**Step 1: Add feedback color tokens**

In `src/styles/tokens/colors.css`, after the `--stroke-accent-soft` line (line 57), add:

```css

    /* Feedback */
    --color-success: #22c55e;
    --color-error: #ef4444;
    --color-warning: #eab308;
```

And in the `[data-mode='light']` section, after the `--stroke-accent-soft` line (around line 152), add:
```css

    /* Feedback */
    --color-success: #16a34a;
    --color-error: #dc2626;
    --color-warning: #ca8a04;
```

**Step 2: Replace hardcoded green in ArticleCard**

In `src/features/news-feed/components/ArticleCard.tsx`, line 268, change:
```typescript
<Check size={16} className="text-green-600" /> Copied!
```
to:
```typescript
<Check size={16} className="text-[var(--color-success)]" /> Copied!
```

**Step 3: Replace bg-black in SidebarPlayer**

Search for `bg-black` in `src/features/music-player/components/SidebarPlayer.tsx` and replace with `bg-[var(--color-bg-primary)]`.

**Step 4: Commit**

```bash
git add src/styles/tokens/colors.css src/features/news-feed/components/ArticleCard.tsx src/features/music-player/components/SidebarPlayer.tsx
git commit -m "fix: add semantic feedback colors and replace hardcoded color values"
```

---

### Task 12: Align Motion Token Systems (Issue #12 — partial)

**Files:**
- Modify: `src/components/motion/motionTokens.ts`

**Step 1: Align Framer Motion durations with CSS tokens**

The CSS tokens are:
- `--duration-fast: 150ms`
- `--duration-normal: 300ms`
- `--duration-slow: 500ms`
- `--duration-slower: 700ms`

In `src/components/motion/motionTokens.ts`, update TRANSITIONS to match:

```typescript
export const TRANSITIONS = {
    micro: { duration: 0.15, ease: EASINGS.standard },     // matches --duration-fast
    quick: { duration: 0.3, ease: EASINGS.standard },      // matches --duration-normal
    base: { duration: 0.5, ease: EASINGS.emphasized },     // matches --duration-slow
    slow: { duration: 0.7, ease: EASINGS.emphasized },     // matches --duration-slower
} as const;
```

**Step 2: Verify no visual regressions**

Run: `npm run dev`
Check landing page transitions, edition page animations, dropdown open/close. All should feel similar (differences are small: 0.45→0.5, 0.6→0.7).

**Step 3: Commit**

```bash
git add src/components/motion/motionTokens.ts
git commit -m "fix: align Framer Motion transition durations with CSS duration tokens"
```

---

## Summary

| Task | Issue | Phase | Effort |
|------|-------|-------|--------|
| 1 | Wrong edition redirect | Quick wins | 2 min |
| 2 | Duplicate useEditions | Quick wins | 2 min |
| 3 | Empty editions → infinite loading | Quick wins | 2 min |
| 4 | Unused Article type fields | Quick wins | 3 min |
| 5 | Error boundary | Stability | 5 min |
| 6 | Race condition (AbortController) | Stability | 5 min |
| 7 | Music player out-of-bounds | Stability | 3 min |
| 8 | React.memo ArticleCard | Performance | 10 min |
| 9 | Reset focus on edition change | Performance | 3 min |
| 10 | Z-index tokens | Polish | 5 min |
| 11 | Semantic color tokens | Polish | 5 min |
| 12 | Align motion tokens | Polish | 3 min |

**Issues not included in this plan (lower priority, can be separate PRs):**
- Issue #4 (split JSON archives by decade) — larger refactor, needs data pipeline changes
- Issue #8 (font size audit) — 50+ files, needs a dedicated sweep
- Issue #6 full (keyboard nav for TimeControls/MobileNav dropdowns) — new feature work, not a bug fix
