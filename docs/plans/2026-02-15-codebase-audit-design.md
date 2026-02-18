# Codebase Audit — 14 Issues to Fix

**Date:** 2026-02-15
**Branch:** `chore/project-cleanup`
**Scope:** Full codebase excluding OCR pipeline

## Context

Deep audit of the Transcript Archive app identified 14 major issues across routing, architecture, performance, accessibility, and design system consistency. This document captures every finding with its fix strategy, prioritized for maximum demo-quality impact.

---

## Critical Issues

### 1. Wrong Edition on Redirect

**Files:** `src/app/edition/page.tsx:20`, `src/app/edition/[date]/page.tsx:39`, `src/features/time-controls/components/TimeControls.tsx:94`

Editions sort ascending, so `editions[0]` is the oldest (1986). Three redirect paths send users to 1986 instead of 1988. The landing page already uses `editions[editions.length - 1]` correctly.

**Fix:** Replace `editions[0]` with `editions[editions.length - 1]` in all three locations.

### 2. Duplicate Edition Fetching

**Files:** `src/features/archive/context/ArchiveContext.tsx:25-51`, `src/features/news-feed/hooks/useEditions.ts`

Both `ArchiveContext` and `useEditions` independently fetch `/api/editions`. Double network requests, duplicate state, potential inconsistency.

**Fix:** Delete `useEditions` hook. Remove its export from `src/features/news-feed/index.ts`. All consumers use `useArchive()`.

### 3. Missing Route-Level Error Boundaries

**Files:** No `error.tsx` at `/edition` or `/edition/[date]`

A single bad JSON file or network failure crashes the entire app with no recovery.

**Fix:** Add `error.tsx` at `src/app/edition/error.tsx` with retry button and link home.

### 4. ~21MB JSON Archives in Memory

**Files:** `src/lib/weather-local-archive.ts:63-80`, `src/lib/music-local-archive.ts:66-133`

Weather (17.5MB) and music (3.7MB) archives load entirely into memory on first API call. Cold start penalty of 200-500ms.

**Fix:** Split indexes by decade so only the relevant chunk loads. Each file drops from ~9MB to ~1MB. Lazy-load only the requested decade.

---

## High Issues

### 5. Race Condition in Article Fetching

**File:** `src/features/news-feed/hooks/useEditionArticles.ts:64-184`

Rapid date changes can cause late responses to overwrite newer data. The `cancelled` flag doesn't prevent stale-response writes.

**Fix:** Replace `cancelled` flag with `AbortController`. Cancel in-flight request on cleanup.

### 6. Keyboard Navigation Gaps + Stale Focus

**Files:** `src/features/news-feed/components/NewsFeed.tsx:206-209`, `src/features/time-controls/components/TimeControls.tsx`, `src/features/navigation/components/MobileNav.tsx`

`focusedIndex` doesn't reset on date change (stale index → out of bounds). TimeControls dropdown has `role="listbox"` but no arrow-key nav. MobileNav lacks Escape-to-close.

**Fix:** Add edition date to focus-reset deps. Add keyboard handlers to TimeControls and MobileNav dropdowns following the EditionPicker pattern.

### 7. No React.memo — All ArticleCards Re-render Together

**Files:** `src/features/news-feed/components/ArticleCard.tsx`, `src/features/news-feed/components/NewsFeed.tsx`

Zero `React.memo` usage. Expanding one card re-renders all 50+ cards including their `sanitizeHtml()` calls.

**Fix:** Wrap `ArticleCard` in `React.memo` comparing `article.id` + `isExpanded`. Memoize `sanitizeHtml` result with `useMemo`.

### 8. Font Size System — Three Competing Approaches

**Files:** `src/styles/tokens/typography.css`, 50+ component and CSS files

Codebase mixes CSS custom properties (`var(--text-xs)`), hardcoded rem (`2.4rem`), and Tailwind pixel overrides (`text-[10px]`). The token system exists but is rarely used.

**Fix:** Audit all font-size declarations. Add `--text-2xs: 0.625rem` for tiny labels. Replace 50+ hardcoded values with tokens.

### 9. Z-Index Tokens Defined But Unused

**Files:** `src/styles/tokens/spacing.css:64-73`, `src/features/time-controls/components/TimeControls.tsx:135,189`, `src/features/navigation/components/MobileNav.tsx:66`

Comprehensive z-index scale defined but zero components reference it. Two components both use `z-50` creating overlap risk.

**Fix:** Replace hardcoded z-index values with tokens: header → `--z-header`, dropdown → `--z-popover`, mobile nav → `--z-fixed`.

### 10. Music Player Track Index Out of Bounds

**File:** `src/features/music-player/components/SidebarPlayer.tsx:383-391`

Switching from a date with monthly data (index=5) to one without doesn't reset the index. Out-of-bounds access when legacy playlists have fewer tracks.

**Fix:** Add separate effect that resets `currentTrackIndex` to 0 whenever `currentDate` changes.

### 11. Empty Editions List → Infinite Loading

**File:** `src/app/edition/page.tsx:17-22`

When editions list is empty after load, redirect never fires. User sees skeleton placeholders forever.

**Fix:** Add else branch: when `!hasEditions && !isLoading`, redirect to `/`.

---

## Medium Issues

### 12. Dual Animation Libraries + Misaligned Tokens

**Files:** `package.json`, `src/components/motion/motionTokens.ts`, `src/styles/tokens/spacing.css:77-87`

Framer Motion (~200KB) + GSAP (~150KB) both bundled. GSAP only used in CinemaBackground and a few landing components. Framer tokens and CSS tokens define different durations for same concepts.

**Fix:** Replace GSAP with Framer Motion in the few files that use it. Align timing values between `motionTokens.ts` and CSS `--duration-*` tokens.

### 13. Color Tokens Bypassed

**Files:** `src/features/news-feed/components/ArticleCard.tsx:113,269`, `src/features/music-player/components/SidebarPlayer.tsx:252,265`

Hardcoded `rgba()`, `bg-black`, `text-green-600` bypass the semantic color system. No success/error/warning tokens exist.

**Fix:** Add `--color-success`, `--color-error`, `--color-warning` to `colors.css`. Replace ~15 hardcoded instances.

### 14. Unused Article Type Fields

**Files:** `src/types/index.ts:21-23`, `src/features/news-feed/components/ArticleCard.tsx:163`

`continuesOnPage`, `continuesFromPage`, `relatedImages` defined in `Article` type but never populated by OCR adapter. ArticleCard renders a "continues on page" notice that never appears.

**Fix:** Remove the three fields from the interface. Delete the continuation UI in ArticleCard.

---

## Implementation Priority

Ordered for maximum demo-quality impact with minimal effort first:

| Phase | Issues | Effort | Impact |
|-------|--------|--------|--------|
| **Phase 1: Quick wins** | #1, #2, #11, #14 | ~30 min | Core navigation fixed, dead code removed |
| **Phase 2: Stability** | #3, #5, #10 | ~1 hr | Error recovery, no stale data, no crashes |
| **Phase 3: Performance** | #7, #4 | ~1-2 hr | Snappy UI, faster cold starts |
| **Phase 4: Polish** | #6, #8, #9, #13 | ~2-3 hr | Accessibility, consistent design system |
| **Phase 5: Cleanup** | #12 | ~1 hr | Remove GSAP, align animation tokens |
