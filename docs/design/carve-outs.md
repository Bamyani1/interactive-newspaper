# Design Refresh — Safety Carve-Outs

This doc inventories live features, intentional hardcodes, and external contracts that the design-system refresh MUST NOT silently break. Every subsequent phase (token edits, primitive migration, Tailwind expansion, feature cleanup) must consult this doc before modifying a listed file or token.

Produced during Phase 0 of the plan at `~/.claude/plans/here-is-an-new-declarative-wozniak.md`.

---

## 1. ColorCustomizer / FontCustomizer — live user-facing feature

**What it is:** Two floating bottom-right buttons rendered globally on every page, letting users swap the palette and fonts at runtime. Data in `font-color/data/colorPresets.ts` and `font-color/data/fontPresets.ts`.

**Where it's wired:**
- `src/app/layout.tsx:9` — imports `font-color/styles/font-color-kit.css`
- `src/app/layout.tsx:16-17` — imports `ColorCustomizer`, `FontCustomizer` components
- `src/app/layout.tsx:76-77` — renders both inside the root layout
- `src/features/theme/components/ThemeModeManager.tsx` and `ThemeModeToggle.tsx` — consume `@/font-color/data/colorPresets`

**Runtime contract (do not break):**

These four CSS custom properties must keep their exact names. Renaming them silently breaks the preset-swap mechanism because `font-color/data/colorPresets.ts` writes directly to them:

```
--owu-red
--owu-black
--owu-charcoal
--owu-white
```

Each preset in `colorPresets.ts` has keys `"--owu-red"`, `"--owu-black"`, `"--owu-charcoal"`, `"--owu-white"`, e.g.:
```ts
{ "--owu-red": "#D02B45", "--owu-black": "#1A1D22", … }
```

**Phase 3 implementation:** keep these four tokens at the top of `src/styles/tokens/colors.css`, but redefine them as aliases into the new Layer-1 primitives:
```css
--owu-red: var(--red-600);      /* customizer-anchored */
--owu-black: var(--ink-900);    /* customizer-anchored */
--owu-charcoal: var(--ink-700); /* customizer-anchored */
--owu-white: var(--newsprint-50); /* customizer-anchored */
```
This keeps the customizer working with zero schema change, while the rest of the system shifts to semantic tokens.

**Fallback hex values inside `var()` second args** in `font-color/styles/font-color-kit.css` (lines 13–15, 19, 36–38, 48–54) are defensive — if the CSS variable unloads, the UI still renders. Keep this pattern; only update the fallback hex values to match the new palette from Phase 2's `/design.md`.

**When adding presets:** extend `colorPresets.ts` schema — never rename the four keys. The `id: "owu-default"` preset in `fontPresets.ts` is also a stable identifier — keep it.

---

## 2. YouTube play-button red (`bg-red-600`) — intentional affordance

**Where:** `src/features/music-player/components/SidebarPlayer.tsx:117`

**What it is:** A red circle overlaid on a YouTube thumbnail (`https://img.youtube.com/vi/${youtubeId}/mqdefault.jpg`) as the play button. YouTube brand red is the user-recognized "click here to play" cue. Replacing it with brand OWU red weakens the affordance.

**Rule:** keep `bg-red-600`. Annotate inline when migrating the rest of `SidebarPlayer.tsx`:
```tsx
{/* Intentional YouTube brand red — affordance over yt thumbnail. Do not replace with --color-accent. */}
<div className="w-12 h-12 rounded-full bg-red-600 …">
```

The surrounding `bg-black` container (line 106) is also part of the YouTube-player visual cue — keep.

---

## 3. Print-edition period-matching hardcodes

**Where:** `src/features/news-feed/components/variants/print-edition-primitives.tsx`

**What's there:**
- `fontSize: "15px"`, `"14px"`, `"11px"`, `"10px"`, `"12px"`, `"3.5em"`
- `fontSize: "clamp(20px, 3vw, 28px)"`
- `color: "#fff"` on `HeaderBar`

**Why it's intentional:** this component reproduces a printed 1960s newspaper page on the client. Font sizes and small hardcodes are chosen to match typographic proportions of a real broadsheet — not to fit the screen design system. Blanket tokenization would flatten that effect.

**Rule:** keep these hardcodes; document each with a short inline comment:
```tsx
// Period-matching: preserved hardcode for printed-page fidelity
fontSize: "15px",
```

**Selective migration allowed** for values that don't serve the period look:
- `height: "3px"` dividers → `h-[var(--space-0.5)]` or equivalent
- Inline `fontFamily: "var(--font-header)"` blocks → className utility
- The `DropCap` / `OrnamentRow` components if they use tokens that exist in the new system

The HTML template string in `src/features/news-feed/components/ArticleCard.tsx:110` (the `window.print()` newspaper HTML) also contains hardcoded `font-size`, `color: #666`, etc. — keep it; it's an independent printable document.

---

## 4. Dead theme-variant plumbing

**Where:** `src/styles/tokens/colors.css:115-123` defines `[data-theme='jazz']`, `[data-theme='midcentury']`, `[data-theme='digital']` — all three branches redefine the same four CSS variables to the same `--owu-*` values, i.e. all three are identical. Only `data-theme="jazz"` is ever set, in `src/app/layout.tsx:66`.

**Verdict:** dead code. Three-way theme branching is not wired anywhere else.

**Phase 3 action:**
- Delete the entire `[data-theme='jazz'], [data-theme='midcentury'], [data-theme='digital'] { … }` block from `colors.css`.
- Remove the `data-theme="jazz"` attribute from the `<body>` tag in `layout.tsx:66`.
- The dark/light split is handled cleanly by `[data-mode]` (separate mechanism, keep intact).
- Any future theme variation should go through the ColorCustomizer preset system, not new `[data-theme]` branches.

---

## 5. Gold edition — visual ground truth

**Where:** `gold/1960-01-13/` contains the actual regression-baseline edition — real scan images under `gold/1960-01-13/images/` (symlinked into `public/editions/1960-01-13/images`), plus `gold-edition.json` and `gold-edition-audit-log.md`.

**Use during Phase 1:** pick one representative image from `gold/1960-01-13/images/` as `design-explorations/gold-reference.png` so each HTML prototype can be visually compared against the actual 1960 source. If Direction A (faithful) doesn't feel at home next to the real thing, the direction is wrong.

**Don't modify anything in `gold/`.** It's the baseline.

---

## 6. `.env*` files — hard-blocked

Per `.claude/settings.json`, Claude Code is hard-blocked from editing/writing any `.env*` file. The refresh touches none of these. If a new environment variable becomes necessary (it should not for a UI-only refresh), the user must add it manually.

---

## 7. Pipeline / RAG / OCR changes — require explicit approval

Per project CLAUDE.md: "Pipeline changes: bug fixes are fine; new behavior needs explicit approval."

This refresh is UI/design only. It does NOT touch:
- `src/app/api/ask/` (RAG endpoint)
- `src/lib/` RAG services (agent-loop, agent-tools, query-reformulator, embeddings, reranker, answer-generator, etc.)
- `src/server/ocr-adapter/`
- `scripts/db/` seed/embed/migration scripts
- `scripts/ocr/` OCR shell wrappers
- `ocr/` Python pipeline

If a design change incidentally requires changing a pipeline file, stop and ask.

---

## 8. OpenType & accessibility considerations

**Font-feature-settings** (adding in Phase 3) can affect numeral width and ligatures. Guard each group with `@supports` so older browsers don't break:

```css
@supports (font-variant-numeric: tabular-nums) {
  .date-column { font-variant-numeric: tabular-nums lining-nums; }
}
```

**Color contrast:** every semantic color pair in `/design.md` must pass WCAG AA minimum. Body text targets AAA. The ColorCustomizer allows users to swap in palettes that may drop below AA — that's user choice, but the default preset (`owu-default`) must ship at AAA.

---

## 9. Summary — files to touch carefully

| File | Why it's in this doc |
|---|---|
| `src/app/layout.tsx` | ColorCustomizer/FontCustomizer wiring; dead `data-theme` |
| `src/styles/tokens/colors.css` | Hosts `--owu-*` customizer anchors + dead theme branches |
| `src/features/music-player/components/SidebarPlayer.tsx` | YouTube affordance |
| `src/features/news-feed/components/variants/print-edition-primitives.tsx` | Period-matching hardcodes |
| `src/features/news-feed/components/ArticleCard.tsx` | Print HTML template |
| `font-color/data/colorPresets.ts` | Preset schema — keep four keys |
| `font-color/data/fontPresets.ts` | Preset schema — keep `"owu-default"` id |
| `font-color/styles/font-color-kit.css` | Defensive `var()` fallbacks |
| `src/features/theme/components/ThemeModeManager.tsx` | Reads `colorPresets.ts` |
| `src/features/theme/components/ThemeModeToggle.tsx` | Reads `colorPresets.ts` |
| `gold/**` | Regression baseline — read-only |

Any PR modifying these files should link back to this doc and describe how the carve-out is preserved.
