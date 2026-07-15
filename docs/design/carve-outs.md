# Design Refresh — Safety Carve-Outs

This doc inventories live features, intentional hardcodes, and external contracts that the design-system refresh MUST NOT silently break. Every subsequent phase (token edits, primitive migration, Tailwind expansion, feature cleanup) must consult this doc before modifying a listed file or token.

Produced during Phase 0 of the plan at `~/.claude/plans/here-is-an-new-declarative-wozniak.md`.

---

## 1. YouTube play-button red (`bg-red-600`) — intentional affordance

**Where:** `src/features/music-player/components/SidebarPlayer.tsx:117`

**What it is:** A red circle overlaid on a YouTube thumbnail (`https://img.youtube.com/vi/${youtubeId}/mqdefault.jpg`) as the play button. YouTube brand red is the user-recognized "click here to play" cue. Replacing it with brand OWU red weakens the affordance.

**Rule:** keep `bg-red-600`. Annotate inline when migrating the rest of `SidebarPlayer.tsx`:
```tsx
{/* Intentional YouTube brand red — affordance over yt thumbnail. Do not replace with --color-accent. */}
<div className="w-12 h-12 rounded-full bg-red-600 …">
```

The surrounding `bg-black` container (line 106) is also part of the YouTube-player visual cue — keep.

---

## 2. Print-edition period-matching hardcodes

**Where:** `src/features/news-feed/components/variants/print-edition-primitives.tsx`,
`TopStoriesPrintEdition.tsx`, and `SectionPrintEdition.tsx`

**What's there:**
- `fontSize: "15px"`, `"14px"`, `"11px"`, `"10px"`, `"12px"`, `"3.5em"`
- `fontSize: "clamp(20px, 3vw, 28px)"`
- `color: "#fff"` on `HeaderBar`

**Why it's intentional:** this component reproduces a printed 1960s newspaper page on the client. Font sizes and small hardcodes are chosen to match typographic proportions of a real broadsheet — not to fit the screen design system. Blanket tokenization would flatten that effect.

**Rule:** keep these hardcodes; each is already commented inline as period-matching.

The former standalone article card also contained an independent `window.print()`
newspaper document with hardcoded `font-size`, `color: #666`, and related print
values. That unreachable component and template were removed after the dead-UI
audit. The carve-out remains in force: if a standalone printable article document
is restored, keep its print-only hardcodes isolated from screen tokens rather than
blanket-tokenizing them.

---

## 3. Gold edition — visual ground truth

**Where:** `gold/1960-01-13/` contains the actual regression-baseline edition — real scan images under `gold/1960-01-13/images/` (symlinked into `public/editions/1960-01-13/images`), plus `gold-edition.json` and `gold-edition-audit-log.md`.

**Don't modify anything in `gold/`.** It's the baseline.

---

## 4. `.env*` files — hard-blocked

Per `.claude/settings.json`, Claude Code is hard-blocked from editing/writing any `.env*` file. The refresh touches none of these. If a new environment variable becomes necessary, the user must add it manually.

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

The floating ColorCustomizer + FontCustomizer were removed. Their four brand tokens (`--owu-red`, `--owu-black`, `--owu-charcoal`, `--owu-white`) stay in `src/styles/tokens/colors.css` as aliases into the primitive palette. Reason: any stale `localStorage["tts-color-preset"]` entry in a returning user's browser may still call `document.documentElement.style.setProperty("--owu-red", …)` — keeping the names inert-but-defined prevents surprise.

**Reserved localStorage keys** (do not reuse): `tts-color-preset`, `tts-font-preset`.

---

## 7. OpenType & accessibility considerations

**Font-feature-settings** guards each group with `@supports` so older browsers don't break:

```css
@supports (font-variant-numeric: tabular-nums) {
  .date-column { font-variant-numeric: tabular-nums lining-nums; }
}
```

**Color contrast:** every semantic color pair in `/design.md` must pass WCAG AA minimum. Body text targets AAA.

---

## Summary — files to touch carefully

| File | Why it's in this doc |
|---|---|
| `src/features/music-player/components/SidebarPlayer.tsx` | YouTube affordance |
| `src/features/news-feed/components/variants/print-edition-primitives.tsx` | Period-matching primitives and hardcodes |
| `src/features/news-feed/components/variants/{TopStoriesPrintEdition,SectionPrintEdition}.tsx` | Period-matching print composition and type scale |
| `src/styles/tokens/colors.css` | Hosts `--owu-*` legacy aliases |
| `gold/**` | Regression baseline — read-only |

Any PR modifying these files should link back to this doc and describe how the carve-out is preserved.
