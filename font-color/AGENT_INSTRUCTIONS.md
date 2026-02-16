# Agent Instructions: OWU-Specific Font/Color Customizer Kit

This kit is now purpose-built for the OWU Transcript Archive and should be treated as project-specific logic.

## 1) Scope

This package contains two floating popup customizers for edition-reading pages:

- `font-color/components/ColorCustomizer.tsx`
- `font-color/components/FontCustomizer.tsx`
- `font-color/data/colorPresets.ts`
- `font-color/data/fontPresets.ts`
- `font-color/styles/font-color-kit.css`

## 2) Component contract (must preserve)

- `ColorCustomizer`: no props
- `FontCustomizer`: no props

## 3) Export contract (must preserve)

- Color module exports:
  - `ColorPreset`
  - `PRESET_CATEGORIES`
  - `PRESETS`
- Font module exports:
  - `FontPreset`
  - `DEFAULT_FONTS`
  - `FONT_PRESETS`

## 4) Storage and event contract (must preserve)

- LocalStorage keys:
  - `tts-theme`
  - `transcript-mode`
  - `tts-font-preset`
- Window events:
  - `customizer-panel-open`
  - `theme-change`

## 5) Route behavior

Both popup toggles are edition-scoped and render only on routes that start with `/edition`.

## 6) Token contract used by this kit

Color customizer writes OWU brand variables only:

- `--owu-red`
- `--owu-black`
- `--owu-charcoal`
- `--owu-white`

Font customizer writes OWU semantic typography variables:

- `--font-header`
- `--font-body`
- `--font-masthead`
- `--font-mono`
- `--font-accent`

## 7) Theme-mode sync behavior

When a color preset is applied or reset:

1. `document.body.dataset.mode` is updated (`light` or `dark`)
2. `html.light` class is mirrored for compatibility
3. both `transcript-mode` and `tts-theme` are written
4. `theme-change` is dispatched

## 8) Styling integration notes

- `font-color/styles/font-color-kit.css` now styles UI only.
- It intentionally does **not** define global `:root` or `html.light` token blocks.
- It relies on app tokens such as:
  - `--color-bg-primary`
  - `--color-bg-secondary`
  - `--color-text-primary`
  - `--color-text-secondary`
  - `--color-accent`
  - `--stroke-accent-soft`

## 9) Placement and stacking

- Controls and panels use `z-index: 55`.
- Mobile placement is offset above bottom navigation.
- Desktop placement is bottom-left stacked controls.

## 10) Integration reminder

This folder is kit-only. Mount/import wiring is expected to be handled by the host app when desired.
