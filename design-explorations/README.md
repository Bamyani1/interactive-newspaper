# Design Explorations — Phase 1 Prototypes

Three standalone HTML/CSS direction prototypes to compare visual directions side-by-side before committing to one for the full Phase 2+ implementation.

## How to view

No build step. Open any HTML file directly:

```bash
open design-explorations/direction-a-faithful/index.html
open design-explorations/direction-b-refined/index.html
open design-explorations/direction-c-archival/index.html
```

Each direction has 6 screens — open them in three browser windows side-by-side and compare.

## Gold reference

Real 1960s source material lives under `gold/1960-01-13/images/` (gitignored, local only). Open `gold/1960-01-13/images/0001_Page 1_img1.jpg` in a browser tab alongside the prototypes. If a direction doesn't feel at home next to the actual scan, the direction is wrong.

## The three directions

Each direction is a distinct interpretation of "1960s newspaper editorial" — a different point on the faithful-↔-modern axis. All three keep the brand red `#B80D3E` as an anchor; everything else varies.

| | **A — Faithful** | **B — Refined** | **C — Archival** |
|---|---|---|---|
| **One-line thesis** | "Reading The New York Times in 1963" | "NYT archive meets Stripe Press" | "JSTOR meets a scholarly archive" |
| **Paper tone** | Warm newsprint cream | Cool near-white | Bright off-white |
| **Ink tone** | Deep warm-black | Charcoal | High-contrast black |
| **Accent use** | Red as display / deck / rule | Red as accent, one-per-screen | Red as masthead only; rare elsewhere |
| **Display family** | Playfair Display | Playfair Display (wider tracking) | Playfair Display (reduced weight) |
| **Body family** | Source Serif 4 | Source Serif 4 (looser leading) | Source Serif 4 + Inter for UI chrome |
| **Density** | Dense, period-correct | Airy, modern editorial | Spacious, research-focused |
| **Decoration** | Hairline rules, small caps, dropcaps | Minimal rules, generous whitespace | Near-zero decoration |
| **Ask UI tone** | Feels like a newspaper feature | Feels like a modern reading app | Feels like a research tool |
| **OpenType features** | oldstyle-nums body, tabular-nums metadata, liga+dlig display | Same, but with more generous tracking | Same, but smaller display sizes, bigger body |
| **Best for** | Users who want the most period authenticity | Users who want to read long-form comfortably | Users doing research / citation work |

## Files per direction

```
direction-x-<name>/
  tokens.css            — palette, typography, spacing, OpenType features
  index.html            — home / masthead / edition picker
  article.html          — reader view with Markdown sample (h1–h6, code, lists,
                          blockquote, table, image) to test prose treatment
  ask.html              — Composer + Transcript + SourceList mock
                          (includes RAG-answer prose styling)
  search.html           — results grid
  mobile-article.html   — 375px breakpoint sanity check
  contrast-report.md    — WCAG AA/AAA table for every semantic color pair
```

## Decision checklist

When comparing the directions, answer:

1. **Masthead feel** — does the header look like a real newspaper masthead or a tech product header?
2. **Reading comfort** — open `article.html` and read through the Markdown sample. Which leads to the least eyestrain after 2 minutes?
3. **Ask tone** — does `ask.html` feel like a newspaper feature or a chatbot? Which matches your mental model?
4. **Density vs air** — which resolves better on both desktop (1440px) and mobile (375px)?
5. **Contrast** — check `contrast-report.md`. Any direction failing AA somewhere?
6. **Gold check** — open the gold scan next to each `index.html`. Which one wouldn't embarrass a 1960s typesetter?

## Decision → Phase 2

After the user picks a direction (possibly with small tweaks — e.g. "B with Direction A's ask.html treatment"), we carry that direction into Phase 2 as `/design.md` at repo root and start building from there.

## Scope limits

- These prototypes are **visual stubs**, not functional. No JavaScript, no routing, no real data — dummy content lifted from the existing app.
- Not all interactive states are shown (hover/focus/disabled) — contrast report documents expected values per state.
- These are meant to be disposable. After the direction is chosen, `design-explorations/` can be deleted or kept as a reference archive.
