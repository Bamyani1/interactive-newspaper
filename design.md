---
version: "1.0"
name: "The Transcript Archive"
description: >
  Period-correct 1960s newspaper design system for a RAG-powered student
  newspaper archive (OWU, 1950-2006). Warm newsprint paper, warm-black ink,
  brand red as display and accent. Dense, typographically rich, traditional.
  Chosen from three Phase-1 prototypes on 2026-04-22 (Direction A - Faithful).

colors:
  # Primitive scales (raw values, no semantic meaning)
  newsprint-50:    "#FBF8F1"
  newsprint-100:   "#F5F1E8"
  newsprint-200:   "#EBE4D4"
  newsprint-300:   "#D9D3C7"
  newsprint-400:   "#B8B0A0"
  ink-900:         "#1B1917"
  ink-800:         "#2B2926"
  ink-700:         "#3A3834"
  ink-600:         "#57534E"
  ink-500:         "#7A756E"
  red-800:         "#8A0A2E"
  red-700:         "#A00C36"
  red-600:         "#B80D3E"
  red-500:         "#D43256"
  red-200:         "#E8C3CD"
  red-100:         "#F4DFE5"

  # Legacy --owu-* aliases (kept so stale localStorage writes from removed
  # customizer are inert; not consumed directly by new code)
  owu-red:         "#B80D3E"
  owu-black:       "#1B1917"
  owu-charcoal:    "#3A3834"
  owu-white:       "#FBF8F1"

  # Semantic — surfaces
  bg-paper:        "#F5F1E8"
  bg-paper-soft:   "#FBF8F1"
  bg-inset:        "#EBE4D4"
  bg-inverse:      "#1B1917"

  # Semantic — text
  text-body:       "#1B1917"
  text-deck:       "#2B2926"
  text-muted:      "#57534E"
  text-faint:      "#7A756E"
  text-inverse:    "#FBF8F1"

  # Semantic — accent
  accent:          "#B80D3E"
  accent-deep:     "#A00C36"
  accent-wash:     "#F4DFE5"

  # Semantic — rules / borders
  rule-hairline:   "#D9D3C7"
  rule-ink:        "#1B1917"
  rule-accent:     "#B80D3E"

  # Semantic — focus
  focus-ring:      "#B80D3E"

  # Semantic — status (only used so far for the ask-archive caveat box)
  warning:         "#B80D3E"  # uses brand red for period-correct warning
  warning-wash:    "#F4DFE5"

typography:
  # Families
  display:
    fontFamily: "Playfair Display, EB Garamond, Georgia, serif"
  body:
    fontFamily: "Source Serif 4, Source Serif Pro, Georgia, serif"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"

  # Type scale — 1.22 ratio, bottom-anchored at 12px
  xs:
    fontSize: "0.75rem"      # 12 — fine print, metadata
    lineHeight: "1.35"
  sm:
    fontSize: "0.875rem"     # 14 — byline, caption
    lineHeight: "1.45"
  base:
    fontSize: "1rem"         # 16 — body
    lineHeight: "1.55"
    fontWeight: "400"
  md:
    fontSize: "1.125rem"     # 18 — deck / lede
    lineHeight: "1.3"
  lg:
    fontSize: "1.375rem"     # 22 — sub-headline
    lineHeight: "1.25"
  xl:
    fontSize: "1.75rem"      # 28 — article headline
    lineHeight: "1.15"
    fontWeight: "700"
  "2xl":
    fontSize: "2.25rem"      # 36 — section title
    lineHeight: "1.1"
    fontWeight: "700"
  "3xl":
    fontSize: "3rem"         # 48 — masthead
    lineHeight: "1.1"
    fontWeight: "700"

  # Tracking — locked to 4 values total (2 for labels + 2 for display)
  tracking-tight:    "-0.01em"
  tracking-normal:   "0"
  tracking-label-sm: "0.08em"
  tracking-label-md: "0.14em"

  # Weights
  weight-regular:    "400"
  weight-medium:     "500"
  weight-semibold:   "600"
  weight-bold:       "700"

spacing:
  # 4px base unit, 8-step scale
  "0":  "0"
  "1":  "0.25rem"    # 4
  "2":  "0.5rem"     # 8
  "3":  "0.75rem"    # 12
  "4":  "1rem"       # 16
  "5":  "1.5rem"     # 24
  "6":  "2rem"       # 32
  "7":  "3rem"       # 48
  "8":  "4rem"       # 64

rounded:
  none: "0"
  sm:   "2px"       # period-correct: newspaper doesn't do rounded corners
  md:   "3px"
  full: "9999px"    # circles only — play buttons, avatars

components:
  button:
    primary:
      bg: "#1B1917"
      color: "#FBF8F1"
      border: "1px solid #1B1917"
      padding: "0.5rem 1rem"
      borderRadius: "2px"
      fontFamily: "JetBrains Mono, ui-monospace, monospace"
      fontSize: "0.75rem"
      fontWeight: "600"
      letterSpacing: "0.14em"
      textTransform: "uppercase"
      states:
        hover:         { bg: "#B80D3E", border: "1px solid #B80D3E" }
        "focus-visible": { outline: "2px solid #B80D3E", outlineOffset: "2px" }
        disabled:      { opacity: "0.5", cursor: "not-allowed" }
    secondary:
      bg: "transparent"
      color: "#1B1917"
      border: "1px solid #1B1917"
      padding: "0.5rem 1rem"
      borderRadius: "2px"
      states:
        hover:  { bg: "#1B1917", color: "#FBF8F1" }
    accent:
      bg: "#B80D3E"
      color: "#FBF8F1"
      border: "1px solid #B80D3E"
      padding: "0.5rem 1rem"
      states:
        hover:  { bg: "#A00C36", border: "1px solid #A00C36" }
    ghost:
      bg: "transparent"
      color: "#1B1917"
      border: "1px solid #D9D3C7"
      padding: "0.5rem 1rem"
    icon:
      # No text label, square, used in toolbars
      bg: "transparent"
      color: "#57534E"
      border: "none"
      padding: "0.5rem"
      borderRadius: "2px"
      states:
        hover:  { color: "#B80D3E", bg: "#F4DFE5" }
    link:
      # Inline link style (NOT a button)
      color: "#B80D3E"
      textDecoration: "underline"
      textDecorationThickness: "0.05em"
      textUnderlineOffset: "0.12em"
      states:
        hover:  { color: "#A00C36" }

  input:
    default:
      bg: "#FBF8F1"
      color: "#1B1917"
      border: "1px solid #1B1917"
      padding: "0.75rem 1rem"
      borderRadius: "2px"
      fontFamily: "Source Serif 4, Georgia, serif"
      fontSize: "1rem"
      lineHeight: "1.55"
      states:
        "focus-visible":   { borderColor: "#B80D3E", outline: "2px solid #B80D3E", outlineOffset: "2px" }
        placeholder:       { color: "#7A756E" }
        disabled:          { opacity: "0.5", cursor: "not-allowed" }

  card:
    default:
      bg: "#FBF8F1"
      border: "1px solid #D9D3C7"
      padding: "1.5rem"
      borderRadius: "0"
    inset:
      bg: "#EBE4D4"
      border: "none"
      padding: "1.5rem"

  label:
    # Small-caps-style labels for metadata, categories
    xs:
      fontFamily: "JetBrains Mono, ui-monospace, monospace"
      fontSize: "0.6875rem"
      letterSpacing: "0.08em"
      textTransform: "uppercase"
      color: "#57534E"
    sm:
      fontFamily: "JetBrains Mono, ui-monospace, monospace"
      fontSize: "0.75rem"
      letterSpacing: "0.14em"
      textTransform: "uppercase"
      color: "#57534E"
    md:
      fontFamily: "JetBrains Mono, ui-monospace, monospace"
      fontSize: "0.75rem"
      letterSpacing: "0.14em"
      textTransform: "uppercase"
      color: "#B80D3E"

  prose:
    # RAG-answer + long-form-article Markdown-rendered typography
    # Applied via the <Prose /> primitive wrapping react-markdown output
    maxWidth: "42rem"
    fontSize: "1rem"
    lineHeight: "1.55"
    color: "#1B1917"
    paragraphSpacing: "1rem"
    headingSpacing: "2rem"

  focus-ring:
    outline: "2px solid #B80D3E"
    outlineOffset: "2px"
---

# The Transcript Archive — Design System

**Format:** Google `design.md` v1 (`github.com/google-labs-code/design.md`, Apache-2.0, alpha).
This file is the source of truth for the visual language. CSS tokens and Tailwind config in the repo mirror it. Changes go through PR review.

**Sibling docs:**
- `docs/design/carve-outs.md` — live features the refresh must not break. Read before editing tokens.

---

## Overview

The Transcript Archive is a RAG-powered interactive archive of a student newspaper spanning 1950–2006. The design system reflects a 1960s editorial aesthetic — **not a pastiche**, but a genuinely period-grounded interface that would feel at home next to scans of the real editions.

**Audience:** researchers, historians, alumni, casual readers. Most users will read long-form articles and ask natural-language questions about the archive's content.

**Tone:** authoritative, typographically sophisticated, restrained. No decoration without purpose.

**Non-goals:** we are not making a reading app for TikTok-era users. We are not replicating the 1960s at the expense of accessibility. We are not building a chatbot that feels detached from the archive.

## Principles

1. **Legibility first.** Every typographic choice serves reading comfort before aesthetic effect.
2. **Typography over chrome.** The system expresses itself through type, hairlines, and restraint — not through shadows, gradients, or ornament.
3. **Brand red is scarce and meaningful.** Red carries weight precisely because it's rare. When it appears, it means something (the masthead, an accent, a citation, a warning).
4. **8px grid, always.** Every margin, padding, and gap aligns to the spacing scale. No `px-[13px]`.
5. **Custom properties over Tailwind arbitrary values.** Use the tokens or the `@theme`-exposed utilities. Arbitrary values are a signal the token set is missing something — extend the tokens first.
6. **Respect the customizer.** `--owu-red`, `--owu-black`, `--owu-charcoal`, `--owu-white` are a user-facing contract. Never rename them.

## Colors

### Semantic palette

| Token | Hex | Role |
|---|---|---|
| `bg-paper` | `#F5F1E8` | Default background — warm newsprint |
| `bg-paper-soft` | `#FBF8F1` | Card background — one step lighter |
| `bg-inset` | `#EBE4D4` | Quote / highlight background |
| `bg-inverse` | `#1B1917` | Dark surface — inverse context |
| `text-body` | `#1B1917` | Primary text |
| `text-deck` | `#2B2926` | Secondary text (deck, lede) |
| `text-muted` | `#57534E` | Metadata, bylines |
| `text-faint` | `#7A756E` | Placeholders, tertiary decor |
| `text-inverse` | `#FBF8F1` | Text on dark surfaces |
| `accent` | `#B80D3E` | Brand anchor |
| `accent-deep` | `#A00C36` | Hover state |
| `accent-wash` | `#F4DFE5` | Caveat / highlight background |
| `rule-hairline` | `#D9D3C7` | Subtle dividers |
| `rule-ink` | `#1B1917` | Section breaks, masthead |
| `focus-ring` | `#B80D3E` | Every focus-visible outline |

### Use rules

- **`accent` (brand red)**: masthead, deck, section rules, hover states, citation chips, category labels. Use sparingly — if red appears more than 5 times on a screen, it's overused.
- **`text-muted`** (AA-only, 5.4:1): ONLY for metadata, bylines, captions. Never for body text. Short text is acceptable per WCAG 1.4.6 exception for inactive / decorative / purely incidental text.
- **`text-faint`** (3.3:1 — below AA body): ONLY for large-size (24px+) decorative elements or placeholder text. Never for prose.
- **`accent-wash`** backgrounds pair only with `text-body` (13.1:1) or `accent-deep` (6.6:1 — acceptable for short uppercase labels).

### WCAG contrast reference

Summary: body text passes AAA, muted text passes AA with exception, accent links pass AA (hover lifts to AAA).

## Typography

### Families

- **Display (`--font-display`)**: Playfair Display. Used for masthead, headlines (h1/h2), section titles. `liga + dlig + kern` features on.
- **Body (`--font-body`)**: Source Serif 4. Used for all prose, article text, inputs, captions. `onum + liga + kern` features on.
- **Mono (`--font-mono`)**: JetBrains Mono. Used for metadata, bylines, timestamps, code, button labels. `tnum + lnum` features on.

All three are loaded via `next/font/google` in `src/app/layout.tsx` with `display: swap`. See Phase 3 for the exact weight subsets needed.

### Scale

| Token | Size | Leading | Use |
|---|---|---|---|
| `xs` | 12px | 1.35 | Fine print, metadata, labels |
| `sm` | 14px | 1.45 | Byline, caption |
| `base` | 16px | 1.55 | Body (default) |
| `md` | 18px | 1.3 | Deck / lede |
| `lg` | 22px | 1.25 | Sub-headline, section title |
| `xl` | 28px | 1.15 | Article headline |
| `2xl` | 36px | 1.1 | Page / section title |
| `3xl` | 48px | 1.1 | Masthead |

**No sizes under 12px.** The `text-[8px]` through `text-[11px]` usages in the current app are a bug to be fixed in Phase 6, not a pattern to preserve.

### Tracking

Only four values. Period.

| Token | Value | Use |
|---|---|---|
| `tracking-tight` | `-0.01em` | Display (masthead, 2xl+ headlines) |
| `tracking-normal` | `0` | Body, headings |
| `tracking-label-sm` | `0.08em` | Small labels, captions |
| `tracking-label-md` | `0.14em` | Medium labels, buttons, nav |

The current app uses 8 different tracking values; that's the mess we're cleaning up.

### OpenType features

```css
body               { font-feature-settings: "onum", "liga", "kern"; }
h1, h2, h3, h4     { font-feature-settings: "liga", "dlig", "kern"; font-variant-numeric: lining-nums; }
.metadata, code    { font-feature-settings: "tnum", "lnum"; font-variant-numeric: tabular-nums lining-nums; }
```

Wrap each in `@supports (font-feature-settings: "<feature>")` so older browsers degrade gracefully.

## Spacing

Based on a 4px unit. Only these values:

| Token | Value | |
|---|---|---|
| `1` | 4px | icon-text gaps |
| `2` | 8px | compact padding |
| `3` | 12px | small padding |
| `4` | 16px | default |
| `5` | 24px | card padding, section margin |
| `6` | 32px | major sections |
| `7` | 48px | page dividers |
| `8` | 64px | hero whitespace |

Any spacing value not in this scale is a bug.

## Shape

Minimal rounding — newspaper aesthetic.

| Token | Value | Use |
|---|---|---|
| `rounded-none` | 0 | default |
| `rounded-sm` | 2px | buttons, inputs, cards |
| `rounded-md` | 3px | rare |
| `rounded-full` | 9999px | circles only (avatars, play buttons) |

No `rounded-lg` / `rounded-xl` / `rounded-2xl`. The period doesn't allow it.

## Components

Authoritative styling specs live in the YAML frontmatter above. Prose here explains intent.

### Button

Five variants. Every button uses the same padding (0.5rem × 1rem) and radius (2px) so they align on shared baselines.

- `primary` — filled ink on paper. Default CTA.
- `secondary` — outlined ink. Alternate action on same page.
- `accent` — filled red. Use only for the singular hero CTA.
- `ghost` — low-key bordered. Tertiary.
- `icon` — square, icon-only, for toolbars.
- `link` — NOT a button: inline `<a>` convention.

All have `focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2`. Never style a button without this.

### Input

One default style. Bg `paper-soft` sets it apart from the `paper` page background. Focus lifts the border to `accent` and adds a ring.

### Card

`default` for article cards. `inset` for quote boxes, caveat boxes. No card has rounded corners larger than 0 — the whole aesthetic is rectangular.

### Label

Three sizes (`xs`, `sm`, `md`). The `md` variant is accent red, used for top-of-section tags ("Ask the archive", "Today in 1960"). `xs` and `sm` are muted.

### Prose

The `<Prose />` primitive wraps `react-markdown` output for RAG answers and static articles. Handles h1–h6, p, ul/ol, blockquote, code inline + fenced, table, img + InlineAnswerImage, a + ask-citation-link. The styling lives in `src/styles/components/ask-archive/markdown-prose.css` (Phase 6) and mirrors the `prose` component spec above.

Key Markdown treatments:
- Citations: `[Source N]` becomes a red-chip superscript anchor, hover reveals source panel.
- Code blocks: dark ink background, paper-soft text, JetBrains Mono, tabular-nums.
- Blockquote: left border in `accent`, italic deck text.
- Table: hairlines between rows, bold uppercase labels in the header.

### Focus-ring

The canonical focus treatment:
```css
.focus-ring, *:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
}
```

Never a custom focus style. If a component can't accept the default, fix the component.

## Do's and Don'ts

### Do
- ✓ Use `bg-paper` (not `bg-white`) as the page background. The warmth matters.
- ✓ Keep red scarce — one accent per page is better than three.
- ✓ Pair every heading with generous vertical space above (32px+).
- ✓ Use old-style numerals in prose, tabular in metadata. The contrast feels right.
- ✓ Let hairline rules do the dividing work; avoid boxes and shadows.
- ✓ Respect the 8px grid. Every time.

### Don't
- ✗ Don't use `bg-white` or `bg-gray-100`. Use semantic tokens.
- ✗ Don't invent tracking values. Use `tracking-tight | normal | label-sm | label-md`.
- ✗ Don't put body text on a colored background — `text-body` on `bg-paper` is the only combo that passes AAA.
- ✗ Don't use `text-[Npx]` arbitrary values. Extend the scale if needed.
- ✗ Don't apply `rounded-lg` or higher. Period aesthetic allows only `sm`.
- ✗ Don't use red for body text, even for emphasis. Bold or italic carries emphasis; red carries category.
- ✗ Don't stack multiple CTAs on a single page. One `accent` button per view, maximum.
- ✗ Don't animate on scroll. Respect `prefers-reduced-motion`.

## Responsive behavior

Breakpoints (applied via Tailwind v4 utilities):

| Breakpoint | Width | Notes |
|---|---|---|
| mobile | < 768px | 375px target. Body steps down to 15px. Headlines shrink by one step. Tables scroll horizontally. Sticky bottom "Ask" fab on article pages. |
| tablet | 768–1023px | Body 16px, single-column prose, 2-column lists. |
| desktop | 1024–1439px | Body 16px, 2-column grids, 672px reading measure. |
| wide | 1440px+ | Same as desktop — no ultra-wide treatment. Content stays centered at `max-w-page` (76rem). |

## Agent prompt guide

When a coding agent (Claude Code, Cursor, Copilot) is asked to build or modify UI in this project, it should:

1. Read `/design.md` and `docs/design/carve-outs.md`.
2. Use tokens from the YAML frontmatter exclusively. Never invent color hex values.
3. Use the primitive components at `src/components/ui/primitives/` (Phase 5+) — `Button`, `Input`, `Card`, `Label`, `Prose`. Don't re-style a button.
4. For Markdown-rendered content, wrap in `<Prose />`. Don't style individual h1/h2/p tags ad-hoc.
5. For focus states, let the primitive handle it OR add `.focus-ring` class. Don't write `focus:ring-1 ring-red-400/30` etc.
6. Prefer Tailwind utilities from `@theme`-mapped tokens. Arbitrary values (`text-[Npx]`, `tracking-[Nem]`) are a code smell.
7. When in doubt, leave red out. The principle is "red is scarce."

Example prompt that lands well:
> "Build an article card using design.md: headline (display xl), category label (label md), excerpt (body muted 3 lines max), metadata footer (label sm). Use the Card primitive, variant default. 24px padding."

Example prompt that leads agents astray:
> "Build a beautiful article card with colorful styling"

Be specific. Reference tokens. Reference primitives. Reference this doc.

## Legacy `--owu-*` aliases

The floating ColorCustomizer and FontCustomizer were removed. Four brand-anchor tokens remain in `src/styles/tokens/colors.css`:

| Token | Default (Direction A) |
|---|---|
| `--owu-red` | `#B80D3E` |
| `--owu-black` | `#1B1917` |
| `--owu-charcoal` | `#3A3834` |
| `--owu-white` | `#FBF8F1` |

They are aliases into the primitive palette (e.g. `--newsprint-50`, `--ink-900`, `--red-600`). Kept as ballast so any stale `localStorage["tts-color-preset"]` entry in a returning user's browser can still call `document.documentElement.style.setProperty("--owu-red", …)` without error. Do not rename. Do not rely on them from new code — use the semantic layer.

## Review checklist

The operational form of everything above — what to actually check when reviewing a
change to the front end. Where [`docs/design/carve-outs.md`](docs/design/carve-outs.md)
documents a deliberate exception, the carve-out wins.

**Direction.** A restrained 1960s newsprint archive: warm paper, warm ink, scarce
institutional red, period-aware typography, with photographic and scan material doing
the narrative work. The landing page establishes the archive and offers two equal tasks
(Ask or Read); utility routes begin with the working surface; edition pages lead with
publication identity, then reporting, then contextual weather/music and source tools.
Every first frame is complete, navigation preserves spatial context, and motion is fast
and local to state or affordance. Ambient landing motion, edition swaps, and overlays
may move — but content is never hidden until hydration, and scroll-triggered reveals are
not used.

**Tokens.** Exact primitive values only, never approximations derived from the legacy
`--owu-*` aliases. Components consume semantic `--color-*` variables. Brand red is
scarce; dark-mode link and focus semantics may use a lighter documented red token where
WCAG contrast requires it. Spacing is 0, 4, 8, 12, 16, 24, 32, 48, 64px. Radius is 0, 2,
or 3px — `9999px` is reserved for circles. Shadows are for media, overlays, and the
intentional landing art; routine regions use hierarchy, whitespace, and hairlines. Type
is Playfair Display, Source Serif 4, and JetBrains Mono only; body text is 16px, nothing
user-facing is below 12px, and each type token carries its intended line height.

**Components and states.** Standard actions use `Button`, text entry uses `Input`,
long-form Markdown uses `Prose`. Specialized listbox options, disclosure rows, and
navigation stay semantic native controls but share the same tokenized states. Every
control needs default, hover (hover-capable devices only), active, focus-visible,
disabled, loading/pending where relevant, and reduced-motion behavior. Minimum pointer
target 44×44px. Focus is a visible 2px semantic ring at 2px offset — removing the native
outline without an equivalent focus-visible treatment is forbidden. Cards appear only
where the region is itself an interaction or a bounded document.

**Layout.** Final evidence viewports are 1440×900 and 390×844, with boundary probes on
both sides of 640, 768, and 1024px. The landing is a full-canvas composition that must
fit the first viewport; Ask is a stable workspace; edition pages are three columns at
desktop and a readable feed plus bottom navigation below 1024px. No route may create
unintended horizontal scroll, and fixed headers, bottom navigation, drawers, and modals
must reserve their geometry and safe-area offsets.

**Motion and first paint.** Server-rendered core content stays visible with JavaScript
disabled. No route root or critical heading starts at opacity zero, and current or target
content stays coherent for the whole navigation. Base motion uses the shared
duration/easing tokens, normally 150–300ms; reduced motion removes nonessential animation
and stops continuous motion. Theme, fonts, and route data must not cause post-paint
identity, color, or landmark shifts — per-transition CLS target is at most 0.01.

## Versioning

This document is versioned via Git. Major breaking changes (e.g., palette overhaul) bump the `version` in the frontmatter. Minor additions (new token, new component variant) don't bump.

Current version: **1.0** — initial Direction A codification, 2026-04-22.
