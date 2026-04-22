# Direction B — WCAG contrast report

All ratios computed via standard WCAG 2.1 luminance formula. Targets:
- **AA** — normal text ≥ 4.5:1, large text (18pt / 24px or 14pt bold / ~19px) ≥ 3:1
- **AAA** — normal text ≥ 7:1, large text ≥ 4.5:1
- **Non-text** (UI components, graphical objects, focus rings) — ≥ 3:1

## Palette under test

| Token | Hex | Role |
|---|---|---|
| `--paper-100` (paper) | `#FAFAF7` | Default background — cool near-white |
| `--paper-50` (soft) | `#FFFFFF` | Composer / cards — pure white |
| `--paper-200` (inset) | `#F1F0EB` | Card / quote / caveat background |
| `--paper-300` (rule) | `#E4E2DB` | Hairline borders |
| `--ink-900` (strong) | `#1F1E1C` | Headlines, inverse background |
| `--ink-800` (body) | `#2C2B28` | Primary body text — charcoal |
| `--ink-700` (deck) | `#45433F` | Deck, quote body |
| `--ink-600` (muted) | `#6B6864` | Metadata, bylines |
| `--ink-500` (faint) | `#8E8B85` | Placeholder, tertiary |
| `--red-600` (accent) | `#B80D3E` | Brand anchor, one-per-screen accent |
| `--red-700` (accent-deep) | `#A00C36` | Hover state |
| `--teal-700` (secondary) | `#1F4F4A` | Caveat indicator, search highlight text |
| `--red-100` (accent wash) | `#F4DFE5` | Reserved accent wash |
| `--teal-100` (secondary wash) | `#DCE8E6` | Search result `<mark>` background |

## Text on paper (`--paper-100 · #FAFAF7`)

| Foreground | Ratio | AA body | AA large | AAA body | AAA large | Use |
|---|---:|:---:|:---:|:---:|:---:|---|
| `--ink-900` #1F1E1C | **15.9 : 1** | yes | yes | yes | yes | Headlines, strong text |
| `--ink-800` #2C2B28 | **13.5 : 1** | yes | yes | yes | yes | Body text |
| `--ink-700` #45433F | **9.4 : 1** | yes | yes | yes | yes | Deck, quotes |
| `--ink-600` #6B6864 | **5.3 : 1** | yes | yes | no | yes | Muted metadata — AA only |
| `--ink-500` #8E8B85 | **3.3 : 1** | no | yes | no | no | Faint — **never body**, large only |
| `--red-600` #B80D3E | **6.3 : 1** | yes | yes | no | yes | Accent / tags — AA only |
| `--red-700` #A00C36 | **7.7 : 1** | yes | yes | yes | yes | Hover state — AAA |
| `--red-800` #8A0A2E | **9.3 : 1** | yes | yes | yes | yes | Dark-red on wash contexts |
| `--teal-700` #1F4F4A | **8.8 : 1** | yes | yes | yes | yes | Secondary accent — AAA |

## Text on paper-soft (`--paper-50 · #FFFFFF`)

Used for composer input background, source panel.

| Foreground | Ratio | AA body | AAA body | Use |
|---|---:|:---:|:---:|---|
| `--ink-900` #1F1E1C | **16.7 : 1** | yes | yes | Input value, source headline |
| `--ink-800` #2C2B28 | **14.2 : 1** | yes | yes | Body in soft surfaces |
| `--ink-600` #6B6864 | **5.5 : 1** | yes | no | Placeholder — AA only |
| `--red-600` #B80D3E | **6.6 : 1** | yes | no | Accent on soft — AA only |
| `--teal-700` #1F4F4A | **9.2 : 1** | yes | yes | Secondary accent — AAA |

## Text on inset (`--paper-200 · #F1F0EB`)

Used for "Today in 1960" card, markdown sample, caveat.

| Foreground | Ratio | AA body | AAA body | Use |
|---|---:|:---:|:---:|---|
| `--ink-900` #1F1E1C | **14.6 : 1** | yes | yes | Inset headlines |
| `--ink-800` #2C2B28 | **12.4 : 1** | yes | yes | Inset body |
| `--ink-600` #6B6864 | **4.9 : 1** | yes | no | Inset metadata — AA only |
| `--teal-700` #1F4F4A | **8.1 : 1** | yes | yes | Caveat label — AAA |
| `--red-700` #A00C36 | **7.1 : 1** | yes | yes | Accent label on inset — AAA |

## Text on inverse ink (`--ink-900 · #1F1E1C`)

Used for dark code-block background, mobile FAB.

| Foreground | Ratio | AA body | AAA body | Use |
|---|---:|:---:|:---:|---|
| `--paper-50` #FFFFFF | **16.7 : 1** | yes | yes | Light text on dark (code block) |
| `--paper-100` #FAFAF7 | **15.9 : 1** | yes | yes | Mobile FAB text |
| `--paper-200` #F1F0EB | **14.6 : 1** | yes | yes | Secondary light-on-dark |
| `--red-500` #D43256 | **3.5 : 1** | no | no | Not used — decorative accent only |
| `--red-600` #B80D3E | **2.5 : 1** | no | no | **Do not use for text on dark.** |

## Text on teal wash (`--teal-100 · #DCE8E6`)

Used as `<mark>` highlight background in search results.

| Foreground | Ratio | AA body | AAA body | Use |
|---|---:|:---:|:---:|---|
| `--ink-900` #1F1E1C | **13.3 : 1** | yes | yes | Highlighted text in excerpts |
| `--ink-800` #2C2B28 | **11.3 : 1** | yes | yes | Highlighted body — AAA |
| `--teal-700` #1F4F4A | **7.4 : 1** | yes | yes | Teal-on-teal-wash labels |

## Text on accent wash (`--red-100 · #F4DFE5`)

Reserved — Direction B does not use accent-wash boxes by default (the one-per-screen red rule pushes accent use to tags and hover). Values documented in case a future variant re-introduces it.

| Foreground | Ratio | AA body | AAA body | Use |
|---|---:|:---:|:---:|---|
| `--ink-900` #1F1E1C | **13.1 : 1** | yes | yes | Body on accent wash |
| `--red-700` #A00C36 | **6.4 : 1** | yes | no | Label on accent wash — AA |
| `--red-800` #8A0A2E | **7.6 : 1** | yes | yes | Label on accent wash — AAA |

## Non-text contrast (focus rings, borders, icons)

| Pair | Ratio | Target | Pass |
|---|---:|:---:|:---:|
| `--color-focus-ring` `#B80D3E` on `--paper-100` | 6.3 : 1 | ≥ 3.0 | yes |
| Button border `--ink-900` on `--paper-100` | 15.9 : 1 | ≥ 3.0 | yes |
| Input border `--paper-300` on `--paper-100` | 1.2 : 1 | ≥ 3.0 | **no — decorative only; focus state supplies contrast** |
| Input border on focus `--red-600` on `--paper-50` | 6.6 : 1 | ≥ 3.0 | yes |
| Teal mark background `--teal-100` on paper `--paper-100` | 1.07 : 1 | n/a | decorative highlight; text contrast is what matters |

## Compliance summary

| Level | Status |
|---|---|
| **WCAG 2.1 AA (body text)** | Pass across all documented semantic combinations |
| **WCAG 2.1 AAA (body text)** | Pass for primary text (`--ink-900`, `--ink-800`, `--ink-700`). Muted text (`--ink-600`) passes AA only — acceptable for byline metadata per WCAG 1.4.6 exception for inactive / decorative / purely incidental text |
| **Accent as link / tag text** | `--red-600` on paper = 6.3:1, passes AA. `--red-700` hover lifts to AAA |
| **Teal secondary** | All usages pass AAA — the secondary channel is the AAA-safe choice when color differentiation is needed |
| **Focus ring** | 6.3:1 well above 3:1 non-text minimum |

## ColorCustomizer implications

The customizer lets users override `--owu-red`, `--owu-black`, `--owu-charcoal`, `--owu-white`. The default Direction-B preset passes AAA for body text; other presets **are not guaranteed** to pass. Document in `/design.md` Phase 2:

> "The ColorCustomizer presets are user choice and may drop to AA or below. The default `owu-default` preset ships at AAA for body text. Presets that fall below AA must surface a warning in the picker UI."

The Direction-B palette has a larger AAA safety margin than Direction A (15.9:1 ink-on-paper vs A's 14.8:1), so more customizer presets will pass AAA without tweaking.

## Known risks

1. **`--red-600` as one-per-screen accent**: 6.3:1 on paper passes AA. In Direction B red is used sparingly — primarily in the "Featured" / "Ask" / category tags — so any tag using `--red-600` must be ≥ 14px sans-serif semibold (which we specify via `.tag` / `.label`). The hover state uses `--red-700` (7.7:1), lifting to AAA.
2. **`--ink-500` (faint)**: 3.3:1 is below AA body. Used only for placeholder text and page-count glyphs where the primary signal is positional, not textual.
3. **`--paper-300` borders**: 1.2:1 against paper is intentionally decorative. Direction B deliberately minimizes hairline use; where borders do appear (composer, input), focus-state contrast (6.3:1+) carries the affordance.
4. **Teal `<mark>` background**: 1.07:1 against paper means the highlight is subtle — readable but low-key, intentional for the editorial tone. Text contrast (13.3:1) is what WCAG requires and that's well within AAA.
5. **Dark-mode variant not audited**: this report covers only the paper-first variant. Phase 2's `/design.md` must document the dark-mode palette separately.
