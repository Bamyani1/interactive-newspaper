# `codex/frontend-holistic-audit` representative after evidence

- Branch: `codex/frontend-holistic-audit` (uncommitted implementation at capture time)
- Base: `origin/main` @ `1c1663e1819abe7b5ce3b00c153cd74c35208276`
- Captured: 2026-07-15, from the final clean verification sweep
- Production build id: `Tosy0qSXm_0G4gJX-V_j0`
- Browser: Chromium via Playwright 1.61.1
- Server: one owned Next.js **production** server (`npm run build && npm run start`) on isolated port 3219 (`PLAYWRIGHT_SERVER_MODE=production`)
- Viewports: desktop 1440×900 and mobile 390×844; viewport captures, not full-page composites
- Storage/API state: deterministic fixtures (empty weather/ask session); no live AI or live weather requests

These are representative curated stills copied from the ignored full archive
`audit-evidence/full/after/`. They pair with `../BATCH-ORIGIN-MAIN-BEFORE/`.

## Capture map

| Files | Route / state | Source |
|---|---|---|
| `landing-{desktop,mobile}-settled.png` | `/` settled — full stained-glass composition, immediate CTA (no multi-second withhold) | `full/after/landing/settled/<viewport>/page.png` |
| `ask-{desktop,mobile}-settled.png` | `/ask` settled — stable workspace frame (server-rendered, no boot-skeleton swap) | `full/after/ask/settled/<viewport>/page.png` |
| `search-{desktop,mobile}-pristine.png` | `/search` pristine | `full/after/search/settled/<viewport>/page.png` |
| `about-{desktop,mobile}-settled.png` | `/about` settled — no opacity-zero scroll reveals | `full/after/about/settled/<viewport>/page.png` |
| `edition-1960-{desktop,mobile}-settled.png` | `/edition/1960-01-13` gold-fallback representative | `full/after/edition-1960-01-13/settled/<viewport>/page.png` |
| `edition-nav-desktop-{0ms,285ms,1041ms,settled}.png`, `edition-nav-mobile-{0ms,265ms,1008ms}.png` | delayed landing→edition client navigation filmstrip — content stays coherent throughout (no empty-shell loading boundary) | `full/after/landing-to-edition/transition/<viewport>/frame-*.png` |
| `primitives-{desktop,mobile}-production-404.png` | `/dev/primitives` in **production** = HTTP 404 "Page Not Found" | `full/after/development-primitives/settled/<viewport>/page.png` |

## Notes

- **Primitives differs from BEFORE by design.** `/dev/primitives` is a development-only
  gallery (HTTP 200 in dev, as in the BEFORE set) and a **404 in production**. The AFTER
  shots record the production 404 contract; the audit visual/breakpoint sweeps assert 200 +
  gallery in development and 404 + "Page Not Found" in production.
- **Edition-navigation filmstrip** uses the sweep's actual delayed-navigation frame
  timestamps (desktop ~0/285/1041/1399ms; mobile ~0/265/1008ms) rather than the BEFORE
  set's 50/250/1000ms, because the after harness records the real delayed-RSC edges. Each
  frame shows coherent current-or-target content — the fix eliminated the blank/opacity-zero
  first paint and empty edition loading boundary visible in the BEFORE filmstrip.
- **External data.** One R2 object (`1989-10-25/images/0004_Page 4_img1.webp`) remains
  absent and is the single documented `ASSET-001` external-data deferral. Nine other
  1989–1992 editions were absent from R2 and were restored via `images:upload` (per user
  decision); those editions render normally in these captures.

No unavailable or synthetic product state is represented as a screenshot.
