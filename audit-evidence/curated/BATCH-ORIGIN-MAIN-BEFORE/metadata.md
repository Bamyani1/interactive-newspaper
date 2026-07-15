# `origin/main` representative before evidence

- Source commit: `1c1663e1819abe7b5ce3b00c153cd74c35208276` (`origin/main`)
- Captured: 2026-07-15
- Browser: Chromium via Playwright 1.61.1
- Server: pristine detached worktree, Next.js development server on isolated port 4317
- Viewports: desktop 1440×900 and mobile 390×844; screenshots are viewport captures, not full-page composites
- Storage/API state: fresh browser contexts for direct-route captures; the edition transition used one continuous context

## Capture map

| Files | Route / state | Timing and method |
|---|---|---|
| `landing-{desktop,mobile}-{first,settled}.png` | `/`, delayed landing entrance | First frame immediately after `load`; settled at 5000ms. The first frames show the intentionally withheld/dim content before the artwork and CTA settle. |
| `ask-{desktop,mobile}-{boot,settled}.png` | `/ask`, initial boot versus first-visit surface | Boot immediately after `load`; settled at 1200ms. The boot frame records the blank opacity-gated root before the materially different Ask surface appears. |
| `search-{desktop,mobile}-pristine.png` | `/search`, pristine state | 1000ms after `load`; no query or fixture data entered. |
| `about-{desktop,mobile}-{first,settled}.png` | `/about`, route plus nested Reveal gates | First frame immediately after `load`; settled at 1000ms. The first frame records the blank root/reveal state. |
| `edition-1960-{desktop,mobile}-{first,settled}.png` | `/edition/1960-01-13`, gold-fallback representative | First frame immediately after `load`; settled at 1500ms. Direct navigation was not artificially delayed. |
| `edition-nav-{desktop,mobile}-{50ms,250ms,1000ms,settled}.png` | `/edition/1960-01-13` → date picker → `/edition/1994-01-19` | One real client-navigation session per viewport. Only the target RSC fetch was delayed by 1800ms; frames were captured at 50, 250, 1000, and 2400ms after selection. The sequence records the early target-date/outgoing-content mismatch, empty-shell loading boundary, outgoing-content return, and final target swap. |
| `primitives-{desktop,mobile}.png` | `/dev/primitives`, canonical gallery baseline | 600ms after `load`; the route existed on `origin/main` in development. |

No unavailable or synthetic product state was represented as a screenshot. The temporary worktree had its own dependencies and `.next`; only the PNGs listed above and this metadata file were copied into the audit branch.
