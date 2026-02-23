# Phase 5 Completion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the remaining Phase 5 frontend gaps: mobile nav link, empty/welcome state, accessibility, and component tests.

**Architecture:** Incremental enhancement of existing Ask the Archive UI. Four sequential tasks: mobile nav link → empty state component → accessibility improvements → behavioral tests. All changes use existing CSS custom properties and project patterns.

**Tech Stack:** React 19, Next.js 16 App Router, TypeScript 5, lucide-react icons, Vitest + Testing Library (jsdom), CSS custom properties.

---

### Task 1: Add Ask Link to Mobile Navigation

**Files:**
- Modify: `src/features/navigation/components/MobileNav.tsx:6,17-18,48-49,130`

**Step 1: Add the `MessageCircleQuestion` import**

In `src/features/navigation/components/MobileNav.tsx`, add `MessageCircleQuestion` to the lucide-react import at line 8:

```tsx
import {
  Newspaper,
  Trophy,
  Sparkles,
  MessageSquare,
  MessageCircleQuestion,
  Palette,
  Users,
  ShoppingBag,
  Star,
  Search,
} from "lucide-react";
```

**Step 2: Add `isAskActive` state variable**

After line 49 (`const isSearchActive = ...`), add:

```tsx
const isAskActive = pathname?.startsWith("/ask") ?? false;
```

**Step 3: Add the Ask link after the Search link**

After the Search `</Link>` closing tag (line 130), insert a new Ask link block. Follow the exact same pattern as the Search link (lines 108-130):

```tsx
        {/* Ask the Archive link */}
        <Link
          href="/ask"
          className={`
            relative flex flex-col items-center justify-center gap-1 py-2 px-3 rounded-lg transition-colors min-w-[60px]
            ${isAskActive
              ? "text-[var(--color-accent)]"
              : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }
          `}
          aria-label="Ask the archive"
        >
          <MessageCircleQuestion size={20} strokeWidth={isAskActive ? 2.5 : 2} />
          <span className="text-[10px] font-medium uppercase tracking-wider">
            Ask
          </span>
          {isAskActive && (
            <motion.div
              className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-[var(--color-accent)]"
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          )}
        </Link>
```

**Step 4: Verify in browser**

Run: `npm run dev`
Check: Open the app at mobile viewport (< 1024px). The bottom nav bar should show an "Ask" icon+label between Search and More. Clicking navigates to `/ask`. The icon highlights when on the `/ask` page.

**Step 5: Lint check**

Run: `npm run lint`
Expected: No new errors.

**Step 6: Commit**

```bash
git add src/features/navigation/components/MobileNav.tsx
git commit -m "feat(nav): add Ask the Archive link to mobile navigation"
```

---

### Task 2: Add Empty/Welcome State Component

**Files:**
- Create: `src/features/ask-archive/components/AskEmptyState.tsx`
- Modify: `src/features/ask-archive/index.ts:7`
- Modify: `src/app/ask/page.tsx:7,17-26`
- Modify: `src/styles/components/ask-archive.css:268`

**Step 1: Create the AskEmptyState component**

Create `src/features/ask-archive/components/AskEmptyState.tsx`:

```tsx
import React from "react";

export const AskEmptyState: React.FC = () => {
  return (
    <div className="ask-empty-state">
      <p className="ask-empty-label">Ask the Research Desk</p>
      <p className="ask-empty-description">
        Ask questions about Ohio Wesleyan history from the 1960s. Answers are
        grounded in articles from The Transcript archive, with sources you can
        verify.
      </p>
      <p className="ask-empty-stats">278 articles &middot; 5 editions &middot; 1960</p>
    </div>
  );
};
```

**Step 2: Add barrel export**

In `src/features/ask-archive/index.ts`, add after line 6:

```ts
export { AskEmptyState } from "./components/AskEmptyState";
```

**Step 3: Add CSS styles**

In `src/styles/components/ask-archive.css`, before the `/* REDUCED MOTION */` section (before line 251), add:

```css
/* =========================================
   EMPTY / WELCOME STATE
   ========================================= */

.ask-empty-state {
    margin-bottom: 2rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px dashed var(--stroke-accent-soft);
}

.ask-empty-label {
    font-family: var(--font-mono, monospace);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: var(--color-accent);
    margin-bottom: 0.75rem;
}

.ask-empty-description {
    font-family: var(--font-body);
    font-size: 0.95rem;
    line-height: 1.7;
    color: var(--color-text-primary);
    max-width: 36rem;
}

.ask-empty-stats {
    font-family: var(--font-mono, monospace);
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    margin-top: 0.75rem;
    opacity: 0.7;
}
```

**Step 4: Integrate into page.tsx**

In `src/app/ask/page.tsx`:

1. Update the import on line 7 to include `AskEmptyState`:
```tsx
import { AskInput, AnswerPanel, SourceList, AskEmptyState, useAskArchive } from "@/features/ask-archive";
```

2. Replace lines 17-26 (the existing header block with `<p>Ask</p>`, `<h1>`, and description `<p>`) with the conditional:
```tsx
          {!answer && !isLoading && !error && <AskEmptyState />}
```

The page heading (`<h1>`) and intro text move into `AskEmptyState`. After the user asks a question, the empty state disappears and the answer panel takes its place.

Note: The page still needs an `<h1>` for SEO when the empty state is hidden. Add a visually-hidden heading:
```tsx
          {(answer || isLoading || error) && (
            <h1 className="sr-only">Ask the Archive</h1>
          )}
```

Full updated page structure inside `<div className="ask-container">`:
```tsx
          {!answer && !isLoading && !error && <AskEmptyState />}
          {(answer || isLoading || error) && (
            <h1 className="sr-only">Ask the Archive</h1>
          )}

          <AskInput onSubmit={submit} isLoading={isLoading} />

          {/* ... rest unchanged */}
```

**Step 5: Verify in browser**

Run: `npm run dev`
Check:
- Navigate to `/ask` — empty state shows (label, description, stats)
- Submit a question — empty state disappears, answer appears
- Reload `/ask` — empty state is back

**Step 6: Lint + type check**

Run: `npm run lint && npx tsc --noEmit`
Expected: No errors.

**Step 7: Commit**

```bash
git add src/features/ask-archive/components/AskEmptyState.tsx src/features/ask-archive/index.ts src/app/ask/page.tsx src/styles/components/ask-archive.css
git commit -m "feat(ask): add guided empty/welcome state before first question"
```

---

### Task 3: Accessibility Improvements

**Files:**
- Modify: `src/app/ask/page.tsx`

**Step 1: Add `useRef` and `useEffect` imports**

Update the React import at line 1 of `src/app/ask/page.tsx`:

```tsx
import React, { useRef, useEffect } from "react";
```

**Step 2: Add answer focus ref**

Inside the `AskPage` component, after the `useAskArchive()` hook call, add:

```tsx
  const answerRef = useRef<HTMLDivElement>(null);
```

**Step 3: Add focus management effect**

After the ref, add:

```tsx
  useEffect(() => {
    if (answer) {
      answerRef.current?.focus();
    }
  }, [answer]);
```

**Step 4: Wrap the response region in aria-live**

Wrap the loading/error/answer block in an `aria-live` region. Replace the existing loading/error/answer section with:

```tsx
          <div aria-live="polite" aria-atomic="false">
            {isLoading && (
              <div className="ask-loading-skeleton mt-8" role="status">
                <span className="sr-only">Searching the archive...</span>
                <div className="ask-loading-bar ask-loading-bar--long" />
                <div className="ask-loading-bar ask-loading-bar--medium" />
                <div className="ask-loading-bar ask-loading-bar--short" />
                <div className="ask-loading-bar ask-loading-bar--long" />
                <div className="ask-loading-bar ask-loading-bar--medium" />
              </div>
            )}

            {error && (
              <div className="mt-8 p-4 rounded-sm" style={{
                border: "1px solid var(--color-accent)",
                background: "var(--color-bg-secondary)",
              }}>
                <p className="text-sm" style={{ color: "var(--color-accent)" }}>
                  {error}
                </p>
                <button
                  onClick={reset}
                  className="text-xs mt-2 underline opacity-70 hover:opacity-100 transition-opacity"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  Try again
                </button>
              </div>
            )}

            {answer && (
              <div ref={answerRef} tabIndex={-1} className="outline-none">
                <AnswerPanel response={answer} />
                <SourceList sources={answer.sourceArticles} />
              </div>
            )}
          </div>
```

Key additions:
- `aria-live="polite"` on the wrapper — announces content changes
- `role="status"` + `<span className="sr-only">` on the loading skeleton
- `ref={answerRef} tabIndex={-1}` on the answer wrapper — receives focus programmatically
- `className="outline-none"` — prevents focus ring on the answer container (it's not interactive)

**Step 5: Add sr-only utility class if missing**

Check if `.sr-only` is already defined in the project's CSS. If not, add to `src/styles/components/ask-archive.css`:

```css
/* Screen-reader-only utility (if not defined globally) */
.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}
```

Note: Tailwind's `sr-only` class may already handle this. Check first with `grep -r "sr-only" src/styles/`. If it exists, skip this step.

**Step 6: Verify**

Run: `npm run lint && npx tsc --noEmit`
Expected: No errors.

**Step 7: Commit**

```bash
git add src/app/ask/page.tsx src/styles/components/ask-archive.css
git commit -m "feat(ask): add aria-live, focus management, and loading status for accessibility"
```

---

### Task 4: AskInput Component Tests

**Files:**
- Create: `tests/ask-archive/ask-input.test.tsx`

**Step 1: Write the test file**

Create `tests/ask-archive/ask-input.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AskInput } from "@/features/ask-archive";

describe("AskInput", () => {
  const onSubmit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a textarea and submit button", () => {
    render(<AskInput onSubmit={onSubmit} isLoading={false} />);

    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit question" })).toBeInTheDocument();
  });

  it("calls onSubmit with trimmed text on Enter key", () => {
    render(<AskInput onSubmit={onSubmit} isLoading={false} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "  What happened?  " } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    expect(onSubmit).toHaveBeenCalledWith("What happened?");
  });

  it("calls onSubmit on submit button click", () => {
    render(<AskInput onSubmit={onSubmit} isLoading={false} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Tell me about sports" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit question" }));

    expect(onSubmit).toHaveBeenCalledWith("Tell me about sports");
  });

  it("disables submit button when isLoading is true", () => {
    render(<AskInput onSubmit={onSubmit} isLoading={true} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "A question" } });

    expect(screen.getByRole("button", { name: "Submit question" })).toBeDisabled();
  });

  it("renders example question chips", () => {
    render(<AskInput onSubmit={onSubmit} isLoading={false} />);

    expect(screen.getByText("What was campus life like in 1960?")).toBeInTheDocument();
    expect(screen.getByText("Tell me about OWU sports teams")).toBeInTheDocument();
  });

  it("submits when clicking an example chip", () => {
    render(<AskInput onSubmit={onSubmit} isLoading={false} />);

    fireEvent.click(screen.getByText("What was campus life like in 1960?"));

    expect(onSubmit).toHaveBeenCalledWith("What was campus life like in 1960?");
  });

  it("does not submit empty or whitespace-only input", () => {
    render(<AskInput onSubmit={onSubmit} isLoading={false} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "   " } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run the test**

Run: `npx vitest run tests/ask-archive/ask-input.test.tsx`
Expected: All tests pass. If the submit button `aria-label` doesn't match ("Submit question" vs "Submit"), update the test query to match the actual label in `AskInput.tsx` (which is `"Submit question"` — check line 62).

**Step 3: Commit**

```bash
git add tests/ask-archive/ask-input.test.tsx
git commit -m "test(ask): add AskInput component tests"
```

---

### Task 5: AnswerPanel Component Tests

**Files:**
- Create: `tests/ask-archive/answer-panel.test.tsx`

**Step 1: Write the test file**

Create `tests/ask-archive/answer-panel.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnswerPanel } from "@/features/ask-archive";
import type { AskResponse } from "@/src/types";

function makeResponse(overrides: Partial<AskResponse> = {}): AskResponse {
  return {
    question: "What happened?",
    answer: "Something happened [Source 1] and then more [Source 2].",
    citations: [
      { articleId: "1960-01-07-0", headline: "Article One", editionDate: "1960-01-07" },
      { articleId: "1960-01-07-1", headline: "Article Two", editionDate: "1960-01-07" },
    ],
    confidence: "high",
    sourceArticles: [
      {
        id: "1960-01-07-0",
        headline: "Article One",
        editionDate: "1960-01-07",
        category: "News",
        summary: "Summary one",
        byline: "Author",
        bodySnippet: "Body text...",
        distance: 0.25,
      },
    ],
    meta: {
      retrievalTimeMs: 150,
      generationTimeMs: 800,
      totalTimeMs: 950,
      articlesSearched: 8,
      method: "hybrid",
    },
    ...overrides,
  };
}

describe("AnswerPanel", () => {
  it("renders the answer text", () => {
    render(<AnswerPanel response={makeResponse()} />);

    expect(screen.getByText(/Something happened/)).toBeInTheDocument();
  });

  it("renders citation links with correct hrefs", () => {
    render(<AnswerPanel response={makeResponse()} />);

    const citationLinks = screen.getAllByRole("link");
    const link1 = citationLinks.find((el) => el.textContent === "[1]");
    const link2 = citationLinks.find((el) => el.textContent === "[2]");

    expect(link1).toHaveAttribute("href", "#ask-source-1");
    expect(link2).toHaveAttribute("href", "#ask-source-2");
  });

  it("shows the confidence badge", () => {
    render(<AnswerPanel response={makeResponse({ confidence: "high" })} />);

    expect(screen.getByText("High confidence")).toBeInTheDocument();
  });

  it("shows meta information", () => {
    render(<AnswerPanel response={makeResponse()} />);

    expect(screen.getByText("8 articles searched")).toBeInTheDocument();
    expect(screen.getByText("1.0s")).toBeInTheDocument();
  });
});
```

**Step 2: Run the test**

Run: `npx vitest run tests/ask-archive/answer-panel.test.tsx`
Expected: All tests pass. If any text doesn't match exactly, check the `AnswerPanel.tsx` component's rendering at `src/features/ask-archive/components/AnswerPanel.tsx:49-53`.

**Step 3: Commit**

```bash
git add tests/ask-archive/answer-panel.test.tsx
git commit -m "test(ask): add AnswerPanel component tests"
```

---

### Task 6: SourceList Component Tests

**Files:**
- Create: `tests/ask-archive/source-list.test.tsx`

**Step 1: Write the test file**

Create `tests/ask-archive/source-list.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SourceList } from "@/features/ask-archive";
import type { AskResponse } from "@/src/types";

type SourceArticle = AskResponse["sourceArticles"][number];

function makeSource(overrides: Partial<SourceArticle> = {}): SourceArticle {
  return {
    id: "1960-01-07-0",
    headline: "Test Article",
    editionDate: "1960-01-07",
    category: "News",
    summary: "Test summary",
    byline: "Test Author",
    bodySnippet: "This is a snippet of the article body...",
    distance: 0.25,
    ...overrides,
  };
}

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.PropsWithChildren<{ href: string }>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("SourceList", () => {
  it("renders source cards when expanded (default)", () => {
    const sources = [makeSource(), makeSource({ id: "1960-01-07-1", headline: "Second Article" })];
    render(<SourceList sources={sources} />);

    expect(screen.getByText("Test Article", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Second Article", { exact: false })).toBeInTheDocument();
  });

  it("collapses and expands on toggle click", () => {
    const sources = [makeSource()];
    render(<SourceList sources={sources} />);

    const toggle = screen.getByRole("button", { name: /sources/i });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Test Article", { exact: false })).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Test Article", { exact: false })).toBeInTheDocument();
  });

  it("returns null when sources array is empty", () => {
    const { container } = render(<SourceList sources={[]} />);

    expect(container.innerHTML).toBe("");
  });

  it("shows headline, category, date, and snippet on source cards", () => {
    const source = makeSource({
      headline: "Phone Fraud Story",
      category: "News",
      editionDate: "1960-02-03",
      bodySnippet: "Students were fined for phone fraud...",
    });
    render(<SourceList sources={[source]} />);

    expect(screen.getByText("Phone Fraud Story", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("News")).toBeInTheDocument();
    expect(screen.getByText("1960-02-03")).toBeInTheDocument();
    expect(screen.getByText("Students were fined for phone fraud...")).toBeInTheDocument();
  });
});
```

**Step 2: Run the test**

Run: `npx vitest run tests/ask-archive/source-list.test.tsx`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add tests/ask-archive/source-list.test.tsx
git commit -m "test(ask): add SourceList component tests"
```

---

### Task 7: ConfidenceBadge Component Tests

**Files:**
- Create: `tests/ask-archive/confidence-badge.test.tsx`

**Step 1: Write the test file**

Create `tests/ask-archive/confidence-badge.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConfidenceBadge } from "@/features/ask-archive";

describe("ConfidenceBadge", () => {
  it("renders 'High confidence' for high confidence", () => {
    const { container } = render(<ConfidenceBadge confidence="high" />);

    expect(screen.getByText("High confidence")).toBeInTheDocument();
    expect(container.querySelector(".ask-confidence-dot--high")).toBeInTheDocument();
  });

  it("renders 'Medium confidence' for medium confidence", () => {
    const { container } = render(<ConfidenceBadge confidence="medium" />);

    expect(screen.getByText("Medium confidence")).toBeInTheDocument();
    expect(container.querySelector(".ask-confidence-dot--medium")).toBeInTheDocument();
  });

  it("renders 'Limited sources' for low confidence", () => {
    const { container } = render(<ConfidenceBadge confidence="low" />);

    expect(screen.getByText("Limited sources")).toBeInTheDocument();
    expect(container.querySelector(".ask-confidence-dot--low")).toBeInTheDocument();
  });
});
```

**Step 2: Run the test**

Run: `npx vitest run tests/ask-archive/confidence-badge.test.tsx`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add tests/ask-archive/confidence-badge.test.tsx
git commit -m "test(ask): add ConfidenceBadge component tests"
```

---

### Task 8: useAskArchive Hook Tests

**Files:**
- Create: `tests/ask-archive/use-ask-archive.test.ts`

**Step 1: Write the test file**

Create `tests/ask-archive/use-ask-archive.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAskArchive } from "@/features/ask-archive";
import type { AskResponse } from "@/src/types";

const mockResponse: AskResponse = {
  question: "What happened?",
  answer: "Things happened [Source 1].",
  citations: [{ articleId: "1960-01-07-0", headline: "Test", editionDate: "1960-01-07" }],
  confidence: "high",
  sourceArticles: [
    {
      id: "1960-01-07-0",
      headline: "Test",
      editionDate: "1960-01-07",
      category: "News",
      summary: "Summary",
      byline: null,
      bodySnippet: "Body...",
      distance: 0.25,
    },
  ],
  meta: {
    retrievalTimeMs: 100,
    generationTimeMs: 500,
    totalTimeMs: 600,
    articlesSearched: 8,
    method: "hybrid",
  },
};

describe("useAskArchive", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls /api/ask with the question on submit", async () => {
    const { result } = renderHook(() => useAskArchive());

    act(() => {
      result.current.submit("What happened?");
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/ask",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ question: "What happened?" }),
      })
    );
  });

  it("sets isLoading to true during fetch", async () => {
    // Use a never-resolving fetch to keep loading state
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(new Promise(() => {}))
    );

    const { result } = renderHook(() => useAskArchive());

    act(() => {
      result.current.submit("What happened?");
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.answer).toBeNull();
  });

  it("sets answer on successful response", async () => {
    const { result } = renderHook(() => useAskArchive());

    act(() => {
      result.current.submit("What happened?");
    });

    await waitFor(() => {
      expect(result.current.answer).not.toBeNull();
    });

    expect(result.current.answer!.question).toBe("What happened?");
    expect(result.current.answer!.answer).toBe("Things happened [Source 1].");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("sets error on failed response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "Server error" }),
      })
    );

    const { result } = renderHook(() => useAskArchive());

    act(() => {
      result.current.submit("What happened?");
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.error).toBe("Server error");
    expect(result.current.answer).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("resets all state on reset()", async () => {
    const { result } = renderHook(() => useAskArchive());

    act(() => {
      result.current.submit("What happened?");
    });

    await waitFor(() => {
      expect(result.current.answer).not.toBeNull();
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.answer).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });
});
```

**Step 2: Run the test**

Run: `npx vitest run tests/ask-archive/use-ask-archive.test.ts`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add tests/ask-archive/use-ask-archive.test.ts
git commit -m "test(ask): add useAskArchive hook tests"
```

---

### Task 9: Run Full Test Suite and Final Verification

**Files:** None (verification only)

**Step 1: Run the full test suite**

Run: `npm run test:run`
Expected: All tests pass, including the 5 new test files and all existing tests. Zero regressions.

**Step 2: Lint + type check**

Run: `npm run lint && npx tsc --noEmit`
Expected: No errors.

**Step 3: Verify exit criteria**

Checklist:
- [ ] `/ask` link visible and functional in mobile nav
- [ ] Empty state shows before first question, disappears after
- [ ] Screen reader announces answers via aria-live
- [ ] Focus moves to answer panel after response
- [ ] All 5 test files pass
- [ ] No regressions in existing test suite
- [ ] Dark/light mode both work (manual check)
