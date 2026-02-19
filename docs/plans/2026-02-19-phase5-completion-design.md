# Phase 5 Completion: "Ask the Archive" Frontend Polish

> Finishes the remaining frontend gaps in the Ask the Archive RAG feature.
> Approach: Incremental Enhancement (mobile nav -> empty state -> a11y -> tests).
>
> **Date:** 2026-02-19

---

## Context

Phase 5 of the RAG plan is ~90% built. The core UI works: `AskInput`, `AnswerPanel`, `SourceCard`, `SourceList`, `ConfidenceBadge`, `useAskArchive` hook, `/ask` page, `ask-archive.css`, and a desktop header link in `TimeControls`.

### Gaps

1. No Ask link in mobile navigation (`MobileNav`)
2. No empty/welcome state before a question is asked
3. Accessibility: no `aria-live` for answers, no focus management, no `role="status"` on loader
4. No component tests for the ask-archive feature

---

## Step 1: Mobile Nav Link

**File:** `src/features/navigation/components/MobileNav.tsx`

Add a `Link` to `/ask` using the same pattern as the existing `/search` link (lines 108-130). Place it immediately after the Search link. Use `MessageCircleQuestion` icon from lucide-react. Track active state via `pathname?.startsWith("/ask")`.

~15-line addition. No new files.

---

## Step 2: Empty/Welcome State

**New file:** `src/features/ask-archive/components/AskEmptyState.tsx`

A stateless component shown before any question is asked. Content:

- Small-caps label: "ASK THE RESEARCH DESK"
- Paragraph: "Ask questions about Ohio Wesleyan history from the 1960s. Answers are grounded in articles from The Transcript archive, with sources you can verify."
- Archive stats line: "278 articles / 5 editions / 1960"

Does NOT include example questions (those stay in `AskInput` as chips).

**Modified files:**
- `src/app/ask/page.tsx` — show `<AskEmptyState />` when `answer === null && !isLoading && !error`
- `src/styles/components/ask-archive.css` — add `.ask-empty-state` styles
- `src/features/ask-archive/index.ts` — add barrel export

---

## Step 3: Accessibility

**File:** `src/app/ask/page.tsx`

### 3a. aria-live region

Wrap the answer/error/loading region in `<div aria-live="polite" aria-atomic="false">`. Screen readers will announce content changes without stealing focus.

### 3b. Focus management

After answer renders, programmatically move focus to the answer panel:
- Add `tabIndex={-1}` and a `ref` on the answer container
- `useEffect` watching `answer` — call `ref.current?.focus()` when answer transitions from null to a value

### 3c. Loading status

Add `role="status"` and a visually-hidden `<span className="sr-only">Loading answer...</span>` to the loading skeleton.

### 3d. Source cards (no change needed)

Source cards use `<article>` with focusable `<a>` links. The expand/collapse toggle has `aria-expanded`. Already accessible.

---

## Step 4: Component Tests

5 test files in `tests/ask-archive/`, behavioral coverage (~23 assertions total). All mock `fetch` globally (no real API calls).

### `tests/ask-archive/ask-input.test.tsx`
- Renders textarea and submit button
- Calls `onSubmit` with trimmed text on Enter key
- Calls `onSubmit` on button click
- Disables submit when loading
- Renders example chips; clicking one fires `onSubmit`
- Does not submit empty/whitespace input

### `tests/ask-archive/answer-panel.test.tsx`
- Renders answer text
- Renders citation links as `[N]` linking to `#ask-source-N`
- Shows confidence badge with correct label
- Shows meta info (articles searched, time)

### `tests/ask-archive/source-list.test.tsx`
- Renders source cards when expanded (default)
- Collapses/expands on toggle click
- Returns null when sources is empty
- Source cards show headline, category, date, snippet

### `tests/ask-archive/confidence-badge.test.tsx`
- Renders "High confidence" + green dot for `confidence="high"`
- Renders "Medium confidence" + amber dot for `confidence="medium"`
- Renders "Limited sources" + gray dot for `confidence="low"`

### `tests/ask-archive/use-ask-archive.test.ts`
- Calls `/api/ask` with question on submit
- Sets `isLoading` during fetch
- Sets answer on success
- Sets error on failure
- Aborts previous request on new submit
- `reset()` clears all state

---

## File Change Summary

| Step | Modified Files | New Files |
|------|---------------|-----------|
| 1 | `MobileNav.tsx` | — |
| 2 | `page.tsx`, `ask-archive.css`, `index.ts` | `AskEmptyState.tsx` |
| 3 | `page.tsx` | — |
| 4 | — | 5 files in `tests/ask-archive/` |

**Total:** 1 new component, 5 new test files, 4 modified files.

---

## Exit Criteria

- `/ask` link visible and functional in mobile nav
- Empty state shows before first question, disappears after
- Screen reader announces answers via aria-live
- Focus moves to answer panel after response
- All 5 test files pass (`npm run test:run`)
- No regressions in existing test suite
- Dark/light mode both work
