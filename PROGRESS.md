# Front-End Audit Progress

## 2026-07-15 — Phase 0

- Fetched `origin/main` and created local branch
  `codex/frontend-holistic-audit` from the updated main branch.
- Read the project design source, safety carve-outs, front-end quality skill,
  and Playwright workflow requirements.
- Established the route/state inventory and initial issue ledger.
- Confirmed the baseline: production build and TypeScript pass; root lint is
  polluted by ignored Claude worktrees; Vitest has one pre-existing missing
  OCR fixture after 638 passing tests.
- Confirmed high-confidence first-paint causes in code: global opacity-zero
  route animation, competing theme writers, post-hydration date correction,
  mismatched edition loading shell, cold internal navigation, and deliberate
  landing/Ask withholding.

Current work: add the automated browser/evidence harness and independently
review Batch 0.

Next: capture baseline evidence, then assign Batch 1 to the transition fixer.

### Batch 0 implementation checkpoint

- Added Playwright/axe dependencies, four browser projects, deterministic
  storage/API fixtures, route diagnostics, CLS capture, transition filmstrips,
  audit scripts, and tracked/ignored evidence structure.
- Fixer verification: 20/20 cross-browser smoke tests, 203/203 front-end tests,
  typecheck pass, and lint with zero errors. Representative axe audit correctly
  detects the existing About-page contrast defect.
- Independent re-review: **Approved**. The corrected harness blocks live Ask
  spend, enforces diagnostics/visible first paint, records measured filmstrip
  timing, writes portable evidence, and verifies the dev/production gallery
  contract. Strict landing opacity and Search→Ask desktop CLS failures remain
  product findings rather than suppressed test noise.

### Batch 1 implementation checkpoint

- Removed the global opacity/scroll transition and About/Contact reveal gates.
- Consolidated theme initialization before paint, scoped landing dark mode,
  simplified archive context, rendered header dates synchronously, removed the
  whole-page edition loading boundary, added localized pending/prefetching, and
  converted known hard internal navigations to `Link`.
- Fixer verification: 204/204 front-end tests, focused tests, typecheck, build,
  and coherent Chromium rendering. Local Vercel Analytics 404 diagnostics must
  be filtered or disabled in the harness before the smoke gate is authoritative.
- Independent review initially rejected a unit-only `popstate` solution. The
  replacement uses race-free pathname-keyed scroll persistence plus one-shot
  explicit-navigation intent and a real App Router regression test. Final
  re-review: **Approved** (explicit pushes start at top; Back/Forward and
  edition→Search→Back restore the inner feed; delayed navigation CLS 0.0062).

### Batch 2 design-system checkpoint

- Runtime primitives now match `design.md`: exact palette, canonical spacing,
  radii, typography/line-height/tracking, dark-safe semantic accents, 12px
  minimum text, 44px controls, and restrained shadows.
- Inter was removed, JetBrains Mono 600 was loaded, compact visual variants
  were removed, and reduced motion disables smooth scroll/body transitions.
- First review rejected mobile overflow and variant/reduced-motion drift; the
  corrected 390×844 runtime check and 237 front-end tests pass. Final
  independent re-review: **Approved**.

### Batch 4 Ask workspace checkpoint

- Ask now server-renders a meaningful, stable workspace frame for JavaScript,
  no-JavaScript, first-visit, returning-session, and deep-link entry paths.
- Restore reconciliation is revision-safe, and query deep links wait for the
  restore decision before submitting once or being consumed behind existing
  turns. Daily prompts share a server-serialized UTC date seed.
- Expanded independent review: **Approved**. The deterministic suite now covers
  delayed research stages, error/retry, expiry, restore/clear, thread switching,
  real export, source reader/gallery, and nested lightbox ownership in both
  development and production. The final Ask run reached 142 focused tests;
  every reachable label is at least 12px, interactive targets are at least
  44px, stateful axe/contrast is clean, no live AI request is possible, and
  Search→Ask CLS stays at or below 0.01.

### Shared accessibility and Search checkpoint

- Added the skip link and stable main landmarks, corrected heading hierarchy
  and generic error copy, and made error headings announced and focused.
- Search filters/status/results now expose labels, busy/live state, semantic
  contrast, stale-error clearing, and App Router navigation. Shared modal,
  picker, and mobile-menu behavior now traps/restores focus and implements the
  expected arrow, Home/End, Escape, Tab, and backdrop interactions.
- Two review rounds caught source-photo numbering, invalid tab relationships,
  a serious Search contrast violation, and a subpixel-sensitive 44px gate.
  After correction, independent review: **Approved** (36 focused unit tests;
  desktop/mobile keyboard paths; and four final real-Chromium axe/target checks).

- The exhaustive state follow-up added pristine/loading/results/empty/error,
  filtering, pagination, saved-dark, and navigation coverage at both primary
  viewports. Review rejected dark accent misuse and residual popup opacity
  fades; after semantic accent-text/text-on-accent corrections and instant
  reduced-motion disclosure behavior, final independent re-review:
  **Approved** (54 focused tests and 28 Chromium state cases). Primary body
  contrast meets the 7:1 target, while stateful axe, targets, overflow, and
  first-paint theme/date stability are clean.

### Batch 3 landing checkpoint

- Removed the deliberate multi-second content/navigation withholding while
  preserving the full stained-glass composition, scoped landing theme, and
  immediate no-JavaScript Ask/edition paths.
- Derived paper and SVG assets are 51.7% and 36.3% smaller respectively; the
  originals remain untouched. Ticker and ambient motion stop under reduced
  motion, and the first viewport remains stable from mobile through desktop.
- The first review rejected open picker targets below 44px. After the shared
  control correction, independent re-review: **Approved** (seven landing
  browser cases plus the intended mobile boundary-sweep skip; no-JavaScript,
  CLS, overflow, theme, reduced-motion, artwork, and target gates all green).

### Batch 6 edition and dead-UI checkpoint

- `/edition` now redirects from the cached server inventory, date navigation
  preserves explicit-push/top and browser-history scroll semantics, and the
  hidden mobile context panel no longer mounts or requests weather/music data.
- Removed the unused CinemaBackground and ArticleCard, the unreachable Scan
  Viewer contract, its hooks/exports/state, the document keyboard interceptor,
  and the final orphaned stylesheet. Print hardcode carve-outs now point to
  the three live variants and retain the historical standalone policy.
- Reconciled 351 server editions, 352 production edition paths (index plus
  dates), and 373 local directories; the 22 incomplete local-only dates are
  recorded and asserted as 404s.
- First review rejected an ambiguous restoration locator and residual
  ArticleCard CSS. After correction, independent re-review: **Approved**.
  The full Back/Forward scenario, seven focused browser/unit checks, mobile
  request suppression, sections, Ads/Classifieds, overflow, and native
  keyboard behavior all passed.

- A later state matrix added loaded/empty/error weather and music, photo
  lightbox keyboard/focus, saved theme, delayed next-edition swap, and safe
  invalid-date coverage for 2006, 1994, and the 1960 gold fallback. It exposed
  error/no-data conflation and a streamed theme initializer emitted on every
  server flush. After a per-document one-shot guard, independent review:
  **Approved** (exactly one initializer in `<head>`, none in `<body>`, stable
  saved mode, meaningful no-JavaScript content, and ten edition-state cases).

### Batch 7 dependency checkpoint

- Updated only the requested direct front-end packages to exact versions:
  Next/eslint-config-next 16.2.10, React/ReactDOM 19.2.7,
  sanitize-html 2.17.6, Tailwind/PostCSS 4.3.2, Framer Motion 12.42.2,
  and Vitest 3.2.7. Playwright 1.61.1 and axe-playwright 4.12.1 remain exact.
- Independent review: **Approved**. The lockfile contains only corresponding
  transitive changes, `npm ls --all` has no invalid peers, lint/typecheck/build
  pass, and 709 tests pass under Vitest 3.2.7. The one missing 1983 OCR
  fixture and two unchanged backend route-pattern warnings remain documented
  scope deferrals.

### Batch 8 final sweep

- Resolved three final-sweep harness gaps under fixer→reviewer discipline (no
  self-approval): production-aware `/dev/primitives` (404 in production) in the
  visual and breakpoint sweeps; a default deterministic `GET **/api/weather**`
  fixture so the exhaustive edition sweep never hits the rate-limited live
  endpoint; and an exact, recorded `ASSET-001` external-data deferral for the one
  missing R2 object with negative tests keeping every near-match and other asset
  failure fatal.
- Running the sweep to completion (past where earlier truncated runs died)
  surfaced two follow-ups, each fixed under review: the ASSET-001 aborted
  responsive candidate fired late and cross-edition, so its consumption was made
  deterministic (exact-object consume at every edition gate); and benign Next
  image-optimizer `net::ERR_ABORTED` responsive-candidate cancellations on
  present images were no longer treated as failures (image 404s and all other
  errors remain fatal — user-approved correctness fix).
- Nine 1989–1992 editions were found absent from R2 (never reached by the earlier
  truncated sweeps) and were restored via `images:upload` (137 objects) from
  existing local sources per user decision; `1989-10-25/0004` remains the single
  documented ASSET-001 deferral.
- Final clean production sweep on one owned server: lint, typecheck,
  `test:frontend` (45 files / 295 tests), `test:e2e` (91 pass / 5 skip), build
  (two documented backend warnings), `audit:visual` (production), `audit:transitions`
  (22/22, max CLS 0.0), production breakpoints, and `audit:editions` (both projects,
  all 373 union dates = 746 route/viewport states) all pass. Inventory reconciled
  to 351/352/373/22/0 with only ASSET-001 deferred. `test:run` is 730 pass / 11
  skip with only the pre-existing missing 1983 OCR fixture failing.

- Created the eight scoped conventional commits, backfilled their hashes into the
  evidence manifest, and obtained a fresh independent holistic sign-off:
  **Approved**. Protected scope confirmed untouched (no backend API, `src/lib`,
  OCR adapter, `scripts/db`/`scripts/ocr`, `ocr/`, `gold/**`, `design.md`,
  `middleware.ts`, `next.config`, or environment changes); worktree clean; branch
  kept local (no push/PR).
