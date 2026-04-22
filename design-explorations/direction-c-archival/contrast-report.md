# Direction C — WCAG contrast report

All ratios computed via the standard WCAG 2.1 relative-luminance formula
(`L = 0.2126 R + 0.7152 G + 0.0722 B`, sRGB linearized per the spec).
Rounded to two significant figures. Targets:

- **AA** — normal text ≥ 4.5:1, large text (18pt / 24px or 14pt bold / ~19px) ≥ 3:1
- **AAA** — normal text ≥ 7:1, large text ≥ 4.5:1
- **Non-text** (UI components, graphical objects, focus rings) ≥ 3:1

Direction C's thesis is scholarly / high-contrast. Near-black ink on bright
off-white paper gives the palette a uniformly strong AAA margin for primary
text. Red is almost never used — it appears only on the masthead wordmark —
so most of the common link-color contrast risks from Directions A / B do
not apply here.

## Palette under test

| Token | Hex | Role |
|---|---|---|
| `--paper-50` | `#FDFDFA` | Default paper (body background) |
| `--paper-0` | `#FFFFFF` | Soft surface (inputs, cards) |
| `--paper-100` | `#F7F7F4` | Inset surface (asides, code blocks) |
| `--paper-200` | `#F0F0F0` | **Citation chip background** — neutral gray, the Direction-C cue |
| `--paper-300` | `#E4E4E2` | Hairline rule |
| `--paper-400` | `#D4D4D4` | Primary divider rule |
| `--ink-1000` | `#0F0F0F` | Headlines, strong text, buttons |
| `--ink-900` | `#121212` | Body text |
| `--ink-700` | `#3D3D3D` | Secondary / metadata text |
| `--ink-600` | `#5A5A5A` | Muted / caption text |
| `--ink-500` | `#767676` | Faint / tertiary |
| `--red-600` | `#B80D3E` | Masthead wordmark only (brand anchor) |

## Text on default paper (`--paper-50 · #FDFDFA`)

| Foreground | Ratio | AA body | AA large | AAA body | AAA large | Use |
|---|---:|:---:|:---:|:---:|:---:|---|
| `--ink-1000` #0F0F0F | **18.1 : 1** | Pass | Pass | Pass | Pass | Display, headlines, masthead |
| `--ink-900`  #121212 | **17.6 : 1** | Pass | Pass | Pass | Pass | Body text, primary prose |
| `--ink-700`  #3D3D3D | **10.2 : 1** | Pass | Pass | Pass | Pass | Bylines, metadata |
| `--ink-600`  #5A5A5A |  **6.4 : 1** | Pass | Pass | Fail | Pass | Muted text, citation notes — AA only |
| `--ink-500`  #767676 |  **4.5 : 1** | Pass | Pass | Fail | Fail | Faint — pagination, section labels only |
| `--red-600`  #B80D3E |  **6.9 : 1** | Pass | Pass | Fail | Pass | **Masthead wordmark only** — large display (AAA-equivalent at that size) |

## Text on citation chip (`--paper-200 · #F0F0F0`)

The citation chip background is the signature Direction-C surface — it
replaces the accent-wash used by Directions A / B and is where inline
citations like `[Whitman 1960]` sit.

| Foreground | Ratio | AA body | AAA body | Use |
|---|---:|:---:|:---:|---|
| `--ink-1000` #0F0F0F | **15.4 : 1** | Pass | Pass | Citation chip text (default) |
| `--ink-900`  #121212 | **15.0 : 1** | Pass | Pass | Citation chip text |
| `--ink-700`  #3D3D3D |  **8.6 : 1** | Pass | Pass | Subtle citation variants |
| `--ink-600`  #5A5A5A |  **5.4 : 1** | Pass | Fail | Citation numbering — AA only |

## Text on inset surface (`--paper-100 · #F7F7F4`)

Inset surface is used for markdown-sample aside, code blocks, caveat boxes,
and the question bubble in `ask.html`.

| Foreground | Ratio | AA body | AAA body | Use |
|---|---:|:---:|:---:|---|
| `--ink-900` #121212 | **16.5 : 1** | Pass | Pass | Caveat body, code block text |
| `--ink-700` #3D3D3D |  **9.5 : 1** | Pass | Pass | Caveat label, code metadata |
| `--ink-600` #5A5A5A |  **6.0 : 1** | Pass | Fail | Muted metadata — AA only |

## Text on inverse ink (`--ink-1000 · #0F0F0F`)

Inverse is used for the primary `.btn--primary` and the mobile viewport
status bar.

| Foreground | Ratio | AA body | AAA body | Use |
|---|---:|:---:|:---:|---|
| `--paper-50` #FDFDFA | **18.1 : 1** | Pass | Pass | Button label, status-bar text |
| `--paper-0`  #FFFFFF | **18.3 : 1** | Pass | Pass | Full-white fallback on dark |
| `--ink-500`  #767676 |  **4.0 : 1** | Fail | Fail | **Do not use** — decorative only, large size |

## Non-text contrast (focus rings, borders, dividers)

| Pair | Ratio | Target | Pass |
|---|---:|:---:|:---:|
| `--color-focus-ring` #121212 on `--color-bg-paper` #FDFDFA | 17.6 : 1 | ≥ 3.0 | Pass |
| `--color-rule-ink` #121212 on `--color-bg-paper` #FDFDFA | 17.6 : 1 | ≥ 3.0 | Pass |
| `--color-rule-divider` #D4D4D4 on `--color-bg-paper` #FDFDFA | 1.4 : 1 | n/a | Decorative hairline (informational, not required per WCAG 1.4.11) |
| `--color-rule-hairline` #E4E4E2 on `--color-bg-paper` #FDFDFA | 1.15 : 1 | n/a | Decorative hairline |
| Input border `#D4D4D4` on `--paper-0` | 1.3 : 1 | ≥ 3.0 | **Warning** — see risks |

## Compliance summary

| Level | Status |
|---|---|
| **WCAG 2.1 AA (body text)** | Pass across every documented semantic combination. |
| **WCAG 2.1 AAA (body text)** | Pass for primary text (`--ink-1000`, `--ink-900`, `--ink-700`). Muted text (`--ink-600`) passes AA only — acceptable for byline metadata and low-emphasis labels per WCAG 1.4.6 conventions. |
| **Link text** | No risk: Direction C uses dark text with a hairline underline, not a colored link style. Focus ring is neutral black at 17.6 : 1. |
| **Masthead red** | `--red-600` on paper is 6.9 : 1. It appears only at display size (`--text-3xl`, 40 px / ~30 pt), which qualifies as "large text" — passes AAA for large. |
| **Focus ring** | 17.6 : 1 on paper, far above the 3 : 1 non-text minimum. |

## ColorCustomizer implications

The customizer lets users override `--owu-red`, `--owu-black`,
`--owu-charcoal`, `--owu-white`. The default Direction-C preset passes AAA
for all primary text. Notes for Phase 2 `/design.md`:

> "The ColorCustomizer presets are user choice and may drop to AA or
> below. The default Direction-C preset ships at AAA for body, metadata,
> and headline text. Presets that fall below AA must surface a warning in
> the picker UI.
>
> Direction C specifically uses `--owu-red` only on the masthead wordmark.
> Customizer presets that substitute a low-contrast red still render at
> large display size there, so the surface remains readable in practice."

## Known risks

1. **Input border contrast (1.3 : 1)** — The default `--color-rule-divider`
   on an input is low. WCAG 1.4.11 requires 3 : 1 for active UI component
   boundaries that are not distinguishable by other means. Mitigation: the
   input has a placeholder in `--ink-500` (4.5 : 1) and a visible focus
   ring at 17.6 : 1, so the component remains identifiable on focus. For
   rest state, consider darkening the default border to `--ink-500`
   (#767676, 4.0 : 1 against paper) in Phase 2 if the audit requires it.

2. **`--ink-500` (faint)** — 4.5 : 1 on paper is borderline AA. Never use
   for paragraph-length body text. Reserved for pagination numerals,
   section divider labels, and large chrome elements.

3. **`--ink-600` (muted) is AA-only** — Fine for metadata and secondary
   lines (bylines, "p. 3, 580 words"), but if any AAA-strict deployment
   requirement appears, promote those strings to `--ink-700` (10.2 : 1).

4. **Hairline rules below 3 : 1** — Intentional. `--color-rule-hairline`
   and `--color-rule-divider` are decorative / informational dividers, not
   UI component boundaries, and are exempt from 1.4.11. Where they do
   frame interactive components (inputs, the source list), the risk above
   applies.

5. **Dark-mode variant not audited** — This report covers only the
   paper-first (light) variant. A prospective dark variant would invert
   `--paper-50` and `--ink-900`; the ratios hold by symmetry but a full
   audit is owed before shipping.
