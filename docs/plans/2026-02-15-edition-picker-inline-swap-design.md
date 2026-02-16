# EditionPicker: Inline Swap Design

## Problem

The edition picker popup uses `position: absolute` inside `.ep-container`, but:
1. `.ep-container` height is set by the decade list (short), so the popup overflows
2. `.cinema-btn` (CTA) is a sibling below `.ep-container`, landing in the middle of overflow
3. `.cinema-paper` SVG mask clips overflowing content at torn edges

## Solution: Inline Swap

Remove absolute positioning. Conditionally render either the decade view OR the edition view — never both. Visual "popup" effects (red border-top, shadow, animation) decorate an in-flow element.

## Files to Modify

### `src/styles/components/edition-picker.css`
- `.ep-popup`: Remove `position`, `inset`, `top`, `z-index`. Keep background, border, shadow, animation, padding.
- Light mode override stays as-is.

### `src/components/landing/EditionPicker.tsx`
- Wrap decade view (heading + listbox) in `{!activeGroup && ...}`
- Edition view already wrapped in `{activeGroup && ...}` — no change needed
- Add `onOpenChange?: (isOpen: boolean) => void` prop
- Fire callback in `useEffect` watching `activeDecade`

### `src/app/page.tsx`
- Add `isPickerOpen` state
- Pass `onOpenChange={setIsPickerOpen}` to EditionPicker
- Conditionally render CTA: `{!isPickerOpen && <button ...>}`

## Verification
- `npx tsc --noEmit` clean
- `npx vitest run` no new failures
- Visual: decade click swaps to edition list in-flow, no overflow
- Visual: CTA hidden when edition list open, visible when closed
- Keyboard: arrows, Enter, Escape all work
- Light mode: appropriate styling
