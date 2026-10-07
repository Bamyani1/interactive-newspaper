# Design Refresh — Safety Carve-Outs

This doc inventories live features, intentional hardcodes, and external contracts that the design-system refresh MUST NOT silently break. Every subsequent phase (token edits, primitive migration, Tailwind expansion, feature cleanup) must consult this doc before modifying a listed file or token.

Produced during Phase 0 of the design refresh. Line numbers are deliberately left out
below — they drift with every edit. Where a carve-out has an inline comment at the site
itself, the comment cites this doc by section title and is the authoritative marker.

---

## 1. YouTube play-button red (`bg-red-600`) — intentional affordance

**Where:** `src/features/music-player/components/SidebarPlayer.tsx` — the `bg-red-600` play circle

**What it is:** A red circle overlaid on a YouTube thumbnail (`https://img.youtube.com/vi/${youtubeId}/mqdefault.jpg`) as the play button. YouTube brand red is the user-recognized "click here to play" cue. Replacing it with brand OWU red weakens the affordance.

**Rule:** keep `bg-red-600`. It is annotated inline at the play circle:
```tsx
{/* Intentional YouTube brand red — affordance over yt thumbnail. Do not replace with --color-accent. */}
<div className="w-12 h-12 rounded-full bg-red-600 …">
```

The surrounding `bg-black` container is also part of the YouTube-player visual cue — keep. It already carries its own inline comment.

---

## 2. Print-edition period-matching hardcodes

**Where:** `src/features/news-feed/components/variants/print-edition-primitives.tsx`,
`TopStoriesPrintEdition.tsx`, and `SectionPrintEdition.tsx`

**What's there:**
- `fontSize: "15px"`, `"14px"`, `"11px"`, `"10px"`, `"12px"`, `"3.5em"`
- `fontSize: "clamp(20px, 3vw, 28px)"`, `"clamp(18px, 3vw, 26px)"`, `"clamp(22px, 3.5vw, 30px)"`
- `lineHeight` `1.15` / `1.2` on headlines
- `color: "#fff"` on `HeaderBar`

**Why it's intentional:** this component reproduces a printed 1960s newspaper page on the client. Font sizes and small hardcodes are chosen to match typographic proportions of a real broadsheet — not to fit the screen design system. Blanket tokenization would flatten that effect.

**Rule:** keep these hardcodes. The primitives file header documents them as period-matching; the two composition files carry no inline marker, so check this section before editing them.

The former standalone article card also contained an independent `window.print()`
newspaper document with hardcoded `font-size`, `color: #666`, and related print
values. That unreachable component and template were removed after the dead-UI
audit. The carve-out remains in force: if a standalone printable article document
is restored, keep its print-only hardcodes isolated from screen tokens rather than
blanket-tokenizing them.

---

## 3. Gold edition — visual ground truth

**Where:** `gold/1960-01-13/` (local only — `gold/` is gitignored, so it is absent from the public repo) holds the regression-baseline edition: `gold-edition.json`, `gold-edition-audit-log.md`, and the real scan images under `images/`. `images_link` points at the public copy in `public/editions/1960-01-13/images`.

**Don't modify anything in `gold/`.** It's the baseline.

---

## 4. `.env*` files — hard-blocked

Automated tooling is hard-blocked from editing or writing any `.env*` file (enforced by
local agent settings, which are not tracked in this repo). The refresh touches none of
them. If a new environment variable becomes necessary, the maintainer adds it by hand and
documents it in `.env.example` and the README env table.

---

## 5. Pipeline / RAG / OCR changes — require explicit approval

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

## 6. Legacy `--owu-*` token aliases

The floating ColorCustomizer + FontCustomizer were removed. Their four brand tokens (`--owu-red`, `--owu-black`, `--owu-charcoal`, `--owu-white`) stay in `src/styles/tokens/colors.css` as aliases into the primitive palette. Nothing reads the old preset keys any more; the names stay defined and inert so a stale reference can never break. Do not rename or consume them — components use the semantic `--color-*` layer or the primitive palette.

**Reserved localStorage keys** (do not reuse): `tts-color-preset`, `tts-font-preset`.

---

## 7. OpenType & accessibility considerations

**Font-feature-settings** are defined inside one `@supports` guard in `src/styles/tokens/typography.css`, so browsers without OpenType feature support simply skip them:

```css
@supports (font-feature-settings: "onum") {
  :root {
    --features-body: "onum", "liga", "kern";
    --features-tabular: "tnum", "lnum";
    /* … */
  }
}
```

**Color contrast:** every semantic color pair in `/design.md` must pass WCAG AA minimum, except `text-faint` (placeholders and large decorative text). Body text targets AAA.

---

## Summary — files to touch carefully

| File | Why it's in this doc |
|---|---|
| `src/features/music-player/components/SidebarPlayer.tsx` | YouTube affordance |
| `src/features/news-feed/components/variants/print-edition-primitives.tsx` | Period-matching primitives and hardcodes |
| `src/features/news-feed/components/variants/{TopStoriesPrintEdition,SectionPrintEdition}.tsx` | Period-matching print composition and type scale |
| `src/styles/tokens/colors.css` | Hosts `--owu-*` legacy aliases |
| `gold/**` | Regression baseline — read-only (local only, gitignored) |

Any PR modifying these files should link back to this doc and describe how the carve-out is preserved.
