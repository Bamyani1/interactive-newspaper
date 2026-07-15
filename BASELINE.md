# Canonical Front-End Baseline

`design.md` is the source of truth. This document turns it into an operational
review checklist for the existing application; `docs/design/carve-outs.md`
always wins where a deliberate exception is documented.

## Direction

**Visual thesis:** a restrained 1960s newsprint archive—warm paper, warm ink,
scarce institutional red, period-aware typography, and photographic/scan
material doing the narrative work.

**Content plan:** the landing page establishes the archive and offers two
equal tasks (Ask or Read); utility routes begin with the working surface;
edition pages lead with publication identity, then reporting, then contextual
weather/music and source tools.

**Interaction thesis:** every first frame is complete; navigation preserves
spatial context; motion is fast and local to state/affordance. Ambient landing
motion, edition swaps, and overlays may move, but content is never hidden until
hydration and scroll-triggered reveals are not used.

## Tokens

- Use the exact primitive values in `design.md`, never approximations derived
  from legacy `--owu-*` aliases. Preserve those aliases as inert compatibility
  names and do not reuse the reserved customizer storage keys.
- Components consume semantic `--color-*` variables. Brand red is scarce;
  dark-mode link/focus semantics may use a lighter documented red token when
  needed for WCAG contrast.
- Allowed spacing values are 0, 4, 8, 12, 16, 24, 32, 48, and 64px. Radius is
  0, 2, or 3px; `9999px` is reserved for circles.
- Shadows are reserved for media, overlays, and the intentional landing art;
  routine application regions use hierarchy, whitespace, and hairlines.
- Type uses Playfair Display, Source Serif 4, and JetBrains Mono only. Body
  text is 16px; no user-facing text is below 12px. Tracking uses the four
  documented values and each type token carries its intended line height.

## Components and states

- Standard actions use `Button`; text entry uses `Input`; long-form Markdown
  uses `Prose`. Specialized listbox options, disclosure rows, and navigation
  remain semantic native controls but share the same tokenized states.
- Every control has default, hover (hover-capable devices only), active,
  focus-visible, disabled, loading/pending where relevant, and reduced-motion
  behavior. Minimum pointer target is 44×44px.
- Focus is a visible 2px semantic ring with a 2px offset. Disabling the native
  outline without an equivalent focus-visible treatment is forbidden.
- Cards are used only where the region is itself an interaction or bounded
  document. Application structure defaults to sections, columns, rules, and
  plain layout.

## Layout and responsive behavior

- Final evidence viewports are 1440×900 and 390×844. Boundary probes cover
  both sides of 640, 768, and 1024px.
- The landing is a full-canvas composition and must fit the first viewport.
  Ask is a stable workspace. Edition pages use three columns at desktop and a
  readable feed plus bottom navigation below 1024px.
- No route may create unintended horizontal scroll. Fixed headers, bottom
  navigation, drawers, and modals must reserve their geometry and safe-area
  offsets.

## Motion and first paint

- Server-rendered core content remains visible with JavaScript disabled.
- No route root or critical heading starts at opacity zero. Current or target
  content remains coherent for the entire navigation.
- Base motion uses the shared duration/easing tokens, normally 150–300ms.
  Reduced motion removes nonessential animation and stops continuous motion.
- Theme, fonts, and route data must not cause post-paint identity, color, or
  landmark shifts. Per-transition CLS target is at most 0.01.

## Preserved carve-outs

- YouTube thumbnail/play affordance keeps its intentional red/black treatment.
- Period-matching print-edition and print/export hardcodes remain intact.
- `gold/**` is read-only. No RAG, OCR, database, or API behavior changes.
