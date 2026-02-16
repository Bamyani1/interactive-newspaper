# OWU Font + Color Customizer Kit

OWU-specific customizer kit for The Transcript Archive. This package is designed for the current project token system and route structure.

## Included files

- `components/ColorCustomizer.tsx`
- `components/FontCustomizer.tsx`
- `data/colorPresets.ts`
- `data/fontPresets.ts`
- `styles/font-color-kit.css`
- `AGENT_INSTRUCTIONS.md`

## Behavior summary

- Two floating popup buttons (color + font)
- Visible only on `/edition*` routes
- Mutual exclusion: opening one closes the other
- Theme sync writes both `transcript-mode` and `tts-theme`
- Font selection persists in `tts-font-preset`

## Token targets

Color presets update:

- `--owu-red`
- `--owu-black`
- `--owu-charcoal`
- `--owu-white`

Font presets update:

- `--font-header`
- `--font-body`
- `--font-masthead`
- `--font-mono`
- `--font-accent`

## Events

- `customizer-panel-open`
- `theme-change`

## Styling notes

`styles/font-color-kit.css` now contains only customizer UI styles.

- No global `:root` token definitions
- No global `html.light` token overrides
- Uses app semantic variables for colors/spacing/timing

## Integration note

This folder does not auto-mount components. Host app wiring (imports, placement) is handled elsewhere when needed.
