# EditionPicker Inline Swap Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the edition picker popup overflow by replacing absolute positioning with conditional inline rendering.

**Architecture:** Remove `position: absolute` from `.ep-popup`, conditionally render decade view OR edition view (never both), and hide the CTA button when the edition list is open via a new `onOpenChange` callback.

**Tech Stack:** React, CSS, vitest + @testing-library/react

---

### Task 1: Write tests for EditionPicker conditional rendering

**Files:**
- Create: `tests/edition-picker/edition-picker.test.tsx`

**Step 1: Write the test file**

```tsx
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EditionPicker } from "../../src/components/landing/EditionPicker";

const EDITIONS = ["1986-09-12", "1987-04-08", "1988-10-12"];

describe("EditionPicker", () => {
    it("renders decade list by default", () => {
        render(
            <EditionPicker editions={EDITIONS} selectedEdition={null} onSelect={vi.fn()} />
        );
        expect(screen.getByText("Select an Edition")).toBeInTheDocument();
        expect(screen.getByText("1980s")).toBeInTheDocument();
    });

    it("shows edition list and hides decade list when decade is clicked", () => {
        render(
            <EditionPicker editions={EDITIONS} selectedEdition={null} onSelect={vi.fn()} />
        );
        fireEvent.click(screen.getByText("1980s"));

        // Decade heading and decade card should be gone
        expect(screen.queryByText("Select an Edition")).not.toBeInTheDocument();

        // Back button with decade label should appear
        expect(screen.getByLabelText("Back to decade list")).toBeInTheDocument();

        // Edition dates should appear
        expect(screen.getByText(/Sep 12, 1986/)).toBeInTheDocument();
        expect(screen.getByText(/Oct 12, 1988/)).toBeInTheDocument();
    });

    it("returns to decade list when back button is clicked", () => {
        render(
            <EditionPicker editions={EDITIONS} selectedEdition={null} onSelect={vi.fn()} />
        );
        fireEvent.click(screen.getByText("1980s"));
        fireEvent.click(screen.getByLabelText("Back to decade list"));

        expect(screen.getByText("Select an Edition")).toBeInTheDocument();
        expect(screen.getByText("1980s")).toBeInTheDocument();
    });

    it("calls onOpenChange(true) when decade is clicked", () => {
        const onOpenChange = vi.fn();
        render(
            <EditionPicker
                editions={EDITIONS}
                selectedEdition={null}
                onSelect={vi.fn()}
                onOpenChange={onOpenChange}
            />
        );
        fireEvent.click(screen.getByText("1980s"));
        expect(onOpenChange).toHaveBeenCalledWith(true);
    });

    it("calls onOpenChange(false) when back button is clicked", () => {
        const onOpenChange = vi.fn();
        render(
            <EditionPicker
                editions={EDITIONS}
                selectedEdition={null}
                onSelect={vi.fn()}
                onOpenChange={onOpenChange}
            />
        );
        fireEvent.click(screen.getByText("1980s"));
        onOpenChange.mockClear();

        fireEvent.click(screen.getByLabelText("Back to decade list"));
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("calls onSelect when an edition is clicked", () => {
        const onSelect = vi.fn();
        render(
            <EditionPicker editions={EDITIONS} selectedEdition={null} onSelect={onSelect} />
        );
        fireEvent.click(screen.getByText("1980s"));
        fireEvent.click(screen.getByText(/Sep 12, 1986/));
        expect(onSelect).toHaveBeenCalledWith("1986-09-12");
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/edition-picker/edition-picker.test.tsx`
Expected: Some tests FAIL (the "hides decade list" test will fail because current code renders both views simultaneously)

**Step 3: Commit test file**

```bash
git add tests/edition-picker/edition-picker.test.tsx
git commit -m "test: add EditionPicker conditional rendering tests"
```

---

### Task 2: CSS — Remove absolute positioning from `.ep-popup`

**Files:**
- Modify: `src/styles/components/edition-picker.css:30-55`

**Step 1: Update `.ep-popup` to remove positioning**

Replace the current `.ep-popup` block with:

```css
.ep-popup {
    background: var(--color-bg-secondary);
    border: 1px solid color-mix(in srgb, var(--color-accent) 25%, transparent);
    border-top: 2px solid var(--color-accent);
    box-shadow:
        0 8px 32px rgba(0, 0, 0, 0.5),
        0 2px 8px rgba(0, 0, 0, 0.3),
        inset 0 1px 0 color-mix(in srgb, var(--color-text-primary) 5%, transparent);
    animation: ep-popup-in 200ms var(--ease-default) both;
    padding-top: 4px;
    margin-bottom: 18px;
}
```

Removed: `position`, `inset`, `top`, `z-index`.
Added: `margin-bottom: 18px` to maintain spacing before CTA when it reappears.

**Step 2: Verify no build errors**

Run: `npx tsc --noEmit`
Expected: Clean (CSS-only change, no TS impact)

**Step 3: Commit**

```bash
git add src/styles/components/edition-picker.css
git commit -m "style: remove absolute positioning from edition picker popup"
```

---

### Task 3: TSX — Conditional rendering (decade OR edition view)

**Files:**
- Modify: `src/components/landing/EditionPicker.tsx:7-12` (interface)
- Modify: `src/components/landing/EditionPicker.tsx:58-63` (props)
- Modify: `src/components/landing/EditionPicker.tsx:67` (useEffect for callback)
- Modify: `src/components/landing/EditionPicker.tsx:148-228` (JSX)

**Step 1: Add `onOpenChange` prop to interface and destructuring**

In the `EditionPickerProps` interface, add:

```tsx
interface EditionPickerProps {
    editions: string[];
    selectedEdition: string | null;
    onSelect: (date: string) => void;
    isLoading?: boolean;
    onOpenChange?: (isOpen: boolean) => void;
}
```

Destructure it:

```tsx
export function EditionPicker({
    editions,
    selectedEdition,
    onSelect,
    isLoading = false,
    onOpenChange,
}: EditionPickerProps) {
```

**Step 2: Fire `onOpenChange` when `activeDecade` changes**

Add a `useEffect` after the existing `activeDecade` state declaration (after line 67):

```tsx
useEffect(() => {
    onOpenChange?.(activeDecade !== null);
}, [activeDecade, onOpenChange]);
```

**Step 3: Wrap decade view in conditional**

Change the JSX so the decade view only renders when `activeGroup` is null:

```tsx
return (
    <div className="ep-container">
        {/* Decade view (hidden when edition list is open) */}
        {!activeGroup && (
            <>
                <p className="ep-heading">Select an Edition</p>
                <div
                    role="listbox"
                    aria-label={`${groups.length} decade${groups.length !== 1 ? "s" : ""} available`}
                    className="ep-edition-list"
                >
                    {groups.map((group, i) => {
                        /* ... existing decade card code unchanged ... */
                    })}
                </div>
            </>
        )}

        {/* Edition view (replaces decade view) */}
        {activeGroup && (
            <div className="ep-popup">
                {/* ... existing back button + edition list code unchanged ... */}
            </div>
        )}
    </div>
);
```

**Step 4: Run tests**

Run: `npx vitest run tests/edition-picker/edition-picker.test.tsx`
Expected: All 6 tests PASS

**Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 6: Commit**

```bash
git add src/components/landing/EditionPicker.tsx
git commit -m "feat: conditional inline rendering for edition picker"
```

---

### Task 4: Parent integration — Hide CTA when picker is open

**Files:**
- Modify: `src/app/page.tsx:16` (add state)
- Modify: `src/app/page.tsx:88-93` (pass callback)
- Modify: `src/app/page.tsx:95-117` (conditional CTA)

**Step 1: Add `isPickerOpen` state**

After the existing `selectedEdition` state (around line 21):

```tsx
const [isPickerOpen, setIsPickerOpen] = useState(false);
```

**Step 2: Pass `onOpenChange` to EditionPicker**

```tsx
<EditionPicker
    editions={editions}
    selectedEdition={selectedEdition}
    onSelect={setSelectedEdition}
    isLoading={isLoading}
    onOpenChange={setIsPickerOpen}
/>
```

**Step 3: Conditionally render CTA**

Wrap the button in a conditional:

```tsx
{!isPickerOpen && (
    <button
        type="button"
        className="cinema-btn"
        onClick={handleEnter}
        disabled={isLoading || isEntering || !selectedEdition}
    >
        {/* ... existing button content unchanged ... */}
    </button>
)}
```

**Step 4: Type check and run all tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: Clean types, no new test failures

**Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: hide CTA button when edition picker is expanded"
```

---

### Task 5: Visual verification and final commit

**Step 1: Run dev server and verify**

Run: `npx next dev`

Check:
- [ ] Click decade -> edition list appears in-flow, no overflow
- [ ] CTA button hidden when edition list is open
- [ ] Click back -> decade list returns, CTA reappears
- [ ] Click edition -> selection made
- [ ] Keyboard: arrows, Enter, Escape all work
- [ ] No content clipped by torn paper edges
- [ ] Red accent border-top visible on edition view
- [ ] Shadow creates visual elevation
- [ ] Slide-up animation on open
- [ ] Light mode: appropriate styling

**Step 2: Run full test suite**

Run: `npx vitest run`
Expected: No new failures
