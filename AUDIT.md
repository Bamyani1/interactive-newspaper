# Front-End Audit Ledger

Branch: `codex/frontend-holistic-audit`  
Started: 2026-07-15  
Scope: user-visible front-end behavior only. Backend APIs, database behavior,
RAG, OCR, and `gold/**` are excluded unless a front-end bug cannot be fixed
without them.

## Baseline gates

| Gate | Baseline | Notes |
|---|---|---|
| `npm run build` | Pass with warnings | Two existing Turbopack broad-file-pattern warnings originate in the edition image API route. |
| `npx tsc --noEmit` | Pass | A dedicated `typecheck` script is being added. |
| `npm run lint` | Fail | ESLint traverses ignored `.claude/worktrees`; checkout source has no lint errors. |
| `npm run test:run` | 638 pass, 11 skip, 1 suite fail | Existing OCR invariant expects missing `public/editions/1983-04-28/edition.json`. |

## Route and state inventory

Every row requires code inspection, settled desktop/mobile evidence, keyboard
coverage, console/hydration checks, and an explicit final verdict.

| Surface | Required states | Evidence | Status |
|---|---|---|---|
| `/` | first/return paint, Ask teaser, picker closed/open/empty/selected, disabled CTA, exit navigation, reduced motion | `full/after` | Verified — final sweep |
| `/ask` and `?q=` | boot, first visit, deep-link, streaming stages, complete/error/expired/cleared, threads, export, sources, reader, photos/lightbox | `full/after` | Verified — final sweep |
| `/search` | pristine, focus/clear, debounce/loading, results, filters, pagination, empty, error | `full/after` | Verified — final sweep |
| `/about` | first paint, settled, keyboard, reduced motion | `full/after` | Verified — final sweep |
| `/contact` | first paint, mail link states, keyboard, reduced motion | `full/after` | Verified — final sweep |
| `/edition` | redirect to latest and empty-directory fallback | `full/after` | Verified — final sweep |
| `/edition/[date]` | Top/all sections, Ads/Classifieds, date picker, next edition, weather/music states, desktop/mobile nav, light/dark, modals | `full/after` | Verified — final sweep |
| 404/error boundaries | unknown route, invalid/missing edition, edition error, root error | `full/after` | Verified — final sweep |
| `/dev/primitives` | every primitive, disabled/invalid/hover/focus, deterministic otherwise-unreachable fixtures; production 404 | `full/after` | Verified — final sweep |
| Generated editions | union of live/database and local/static lists at 1440×900 and 390×844 | `full/after` | Verified — final sweep |

Primary data outliers: `2006-04-20` (all categories and mixed media),
`1994-01-19` (expanded Ads/Classifieds), and `1960-01-13` (gold fallback).

## Issue ledger

| ID | Sev. | Finding and root cause | Affected surfaces | Status | Reviewer |
|---|---|---|---|---|---|
| FE-001 | P0 | Global `PageTransition` server-renders route content at opacity zero until hydration, turning any JS/font/chunk delay into a blank or half-rendered first paint. | All routes | Fixed | Approved — Batch 1 reviewer |
| FE-002 | P0 | Theme has competing post-paint writers: body always ships light, `ThemeModeManager` mutates in an effect, and `ThemeModeToggle` starts dark and mutates in a layout effect. | All header routes; landing | Fixed | Approved — Batch 1 reviewer |
| FE-003 | P1 | `ArchiveProvider` initializes `currentDate` to null, so headers server-render “No editions loaded” and correct themselves after hydration. The root also serializes unused edition metadata. | Ask, Search, About, Contact, editions | Fixed | Approved — Batch 1 reviewer |
| FE-004 | P0 | Edition `loading.tsx` replaces the real shell with an empty fixed header, blank sidebars, and mismatched skeleton geometry during navigation. | Edition cold/date navigation | Fixed | Approved — Batch 1 reviewer |
| FE-005 | P1 | Plain internal anchors and unprefetched programmatic routes trigger cold document/RSC navigation and replay first-paint defects. | Landing Ask teaser, Search results, edition controls, source reader | Fixed | Approved — Batch 1 reviewer |
| FE-006 | P1 | Landing intentionally withheld the paper/CTA for 2.5–3.7 seconds and delayed navigation behind a 500ms wash; oversized assets compounded the delay. Content and navigation are now immediate, while derived artwork is substantially smaller without replacing the originals. | Landing | Fixed | Approved — Landing reviewer |
| FE-007 | P1 | Ask swapped a minimal boot skeleton for materially different landing/chat geometry after local/session hydration. The route now server-renders the persistent workspace frame and reconciles restored data inside it. | Ask | Fixed | Approved — Ask reviewer |
| FE-008 | P1 | About/Contact use nested opacity-zero scroll reveals contrary to the project design and progressive-enhancement requirement. | About, Contact | Fixed | Approved — Batch 1 reviewer |
| FE-009 | P0 | Removing the global wrapper alone was insufficient for no-JS: landing and edition children still started opacity-zero, while Ask permanently rendered only an aria-hidden boot skeleton plus composer without JavaScript. All three now ship visible, meaningful route content. | Landing, Ask, edition | Fixed | Approved — Landing, Ask, and edition reviewers |
| FE-010 | P1 | SourceReader manually rewrote browser history state, risking Next Router cache and back/forward scroll restoration. It now uses App Router navigation and the shared dialog lifecycle. | Source reader → edition → Back | Fixed | Approved — Accessibility reviewer |
| FE-011 | P1 | In a production build, App Router same-route replacement could leave a consumed Ask `?q=` in the URL, causing refresh ambiguity. Query consumption now updates Next-compatible native history exactly once. | Ask deep links | Fixed | Approved — Ask reviewer |
| FE-012 | P1 | Local Vercel Analytics injection produced a failed request, and no App Router root error surface could cover server-render failures. Analytics now renders only on Vercel; the safe global error surface is focus-managed and fixture-tested. | Global shell/errors | Fixed | Approved — Harness reviewer |
| FE-013 | P0 | A streamed `useServerInsertedHTML` callback emitted the theme initializer on every flush (up to 49 copies), repeatedly writing `data-mode`. A per-document one-shot guard now emits exactly one script in `<head>`. | All streamed routes | Fixed | Approved — Edition-state reviewer |
| EDITION-001 | P0 | A document-level edition keyboard handler intercepted Enter/Escape even on focused header/nav controls; its `j/k/Enter` article path was dead because current print variants registered no article refs. The interceptor and dead plumbing are removed. | Edition keyboard navigation | Fixed | Approved — Edition reviewer |
| EDITION-002 | P1 | `/edition` discovered dates from ignored `public/editions`, so a clean production deploy could redirect home despite database editions. It now uses the existing cached server edition list. | Edition redirect | Fixed | Approved — Edition reviewer |
| DS-001 | P1 | CSS color scales derive incorrect values from four anchors; documented paper/muted colors do not match runtime values and a normal-text pair falls below AA. | Global tokens/components | Fixed | Approved — Batch 2 reviewer |
| DS-002 | P1 | Spacing, radius, shadow, line-height, and tracking mappings drift from `design.md`; stock Tailwind values leak into components. | Global tokens/components | Fixed | Approved — Batch 2 reviewer |
| DS-003 | P1 | Shared primitives are only partially adopted; standard actions/forms have divergent state, sizing, and focus behavior. | Shared and feature controls | Fixed (canonical primitives) | Approved — Batch 2 reviewer |
| A11Y-001 | P1 | Reduced motion was incomplete, including the landing ticker, popup opacity transitions, and several CSS animations. Continuous, entrance, disclosure, and popup motion now stop or become instantaneous. | Landing, Search, edition picker, navigation, overlays | Fixed | Approved — Residual reviewer |
| A11Y-002 | P1 | Contrast, 44px targets, keyboard focus/restore, dialog semantics, and overflow required systematic state verification. Deterministic state suites now enforce these invariants; the exhaustive route sweep remains the final evidence gate. | All interactive surfaces | Fixed; sweep pending | Approved — Residual and Ask reviewers |
| A11Y-003 | P1 | Lightbox and SourceReader lacked complete dialog focus trap/restore behavior; custom listbox/tab patterns needed keyboard-model verification. | Overlays, date pickers, edition picker | Fixed | Approved — Accessibility reviewer |
| A11Y-004 | P1 | The shared header used an `h1`, producing duplicate page-level headings, and reset styles defined a skip-link treatment without a rendered skip link. | All header routes | Fixed | Approved — Accessibility reviewer |
| A11Y-005 | P1 | TimeControls, EditionPicker, and Mobile “More” exposed partial listbox/tab/menu semantics without the required arrow/Home/End/focus-return keyboard model. | Shared and edition navigation | Fixed | Approved — Accessibility reviewer |
| A11Y-006 | P1 | Error/404 surfaces lacked a main landmark; generic unknown routes were mislabeled as edition failures and raw error messages could be exposed. | Errors, 404 | Fixed | Approved — Accessibility reviewer |
| SEARCH-001 | P1 | Search filters lacked programmatic labels and live/busy status; clearing the query could leave a stale error and result links forced hard navigation. | Search | Fixed | Approved — Accessibility reviewer |
| CONTEXT-001 | P1 | Weather and music HTTP/parse failures were collapsed into “no data,” hiding actionable failure state from users. The client hooks now distinguish deterministic error, empty, and loaded states without changing APIs. | Edition context panel | Fixed | Approved — Edition-state reviewer |
| DATA-001 | P1 | Inventories disagree: 351 server editions, 352 production edition paths (the index plus 351 dates), and 373 local date directories, including 22 local-only/incomplete entries. The server set is canonical; all 22 local-only dates are documented and asserted 404s. | Edition sweep/redirect | Reconciled | Approved — Edition reviewer |
| PERF-001 | P1 | Mobile hid the context sidebar but still fetched weather/music data and a large chart archive; nested desktop overflow could clip expanded context. Rendering is now breakpoint-gated without hydration drift. | Edition context panel | Fixed | Approved — Edition reviewer |
| DEAD-001 | P2 | `CinemaBackground` and `ArticleCard` were unused; `ScanViewer` was unreachable and its expected scanned-page asset contract is absent. Dead components, hooks, exports, state, and styles are removed; Scan Viewer restoration is explicitly deferred. | Dead/code-only UI | Fixed / restore deferred | Approved — Edition reviewer |
| TOOL-001 | P1 | Root lint gate false-fails on `.claude/worktrees`. | Tooling | Fixed | Approved — Batch 0 reviewer |
| TOOL-002 | P2 | Full Vitest has a pre-existing missing OCR fixture; front-end validation isolates it without changing OCR behavior. | Tooling | Deferred (scope) | Approved deferral — Dependency reviewer |
| TOOL-003 | P2 | Two existing build warnings arise in the unchanged backend edition-image route. | Build | Deferred (scope) | Approved deferral — Dependency reviewer |
| DEP-001 | P1 | Requested current-major front-end patches are resolved exactly; unrelated majors and backend-adjacent packages remain intentionally unchanged. | Dependencies | Fixed | Approved — Dependency reviewer |
| ASSET-001 | P2 | The external R2 object `1989-10-25/images/0004_Page 4_img1.webp` was never uploaded: the jpg→webp production rewrite points at it, so Next's image optimizer emits a 404 plus an aborted responsive candidate. The sweep tolerantly defers this exact object (keyed on its decoded R2 address, any width); near-matches and every other asset failure stay fatal. Restoring the R2 object is outside front-end scope; the visible fallback is preserved. | Edition sweep `/edition/1989-10-25` | Deferred (external data) | Approved — fresh final reviewer (Batch 8) |

## Review rule

Each fixed row must link before/after evidence, the verifying commands, the
approved commit, and a verdict from an agent other than the fixer. A row is
done only when the reviewer records `Approved`; otherwise it returns to
`Open` with itemized findings.

## Final sweep (Batch 8)

Final clean production sweep on one owned server (port 3219), production build
`Tosy0qSXm_0G4gJX-V_j0`. Full log: `audit-evidence/full/after/final-gates/00-summary.txt`.

| Gate | Result |
|---|---|
| `git diff --check`, `lint`, `typecheck` | Pass |
| `test:frontend` | 45 files / 295 tests |
| `test:e2e` (cross-browser) | 91 pass / 5 intentional skips |
| `build` | Pass; only the two documented backend image-route warnings (TOOL-003) |
| `audit:visual` (production) | Pass — `/dev/primitives` = 404 "Page Not Found", consumed |
| `audit:transitions` | 22/22; max transition CLS 0.0 (≤ 0.01) |
| breakpoints (production, chromium-desktop, workers=1) | Pass |
| `audit:editions` | Both projects pass all 373 union dates (746 route/viewport states) |
| `test:run` | 730 pass / 11 skip; only the pre-existing missing `1983-04-28` OCR fixture fails (TOOL-002) |

Edition inventory reconciled: 351 live/generated dates; 352 generated paths incl.
`/edition`; 373 local dates; 22 local-only 404s; 0 generated-only. Only ASSET-001 is
deferred (`generatedFailures=[]`, `localOnlyFailures=[]`).

Test counts rose vs the pre-sweep baseline (274→295 frontend, 709→730 full Vitest)
because the final-sweep harness fixes added tests; all pass except the documented OCR
fixture.

### Final-sweep harness fixes (fixer/reviewer, no self-approval)

| Fix | Fixer → Reviewer | Verdict |
|---|---|---|
| Production-aware `/dev/primitives` (404 in prod) in visual + breakpoint sweeps | A → B | Approved |
| Default deterministic `GET **/api/weather**` fixture + focused test | A → B | Approved |
| `ASSET-001` exact external-data deferral + negative tests | A → B | Approved |
| Deterministic ASSET-001 abort consumption (cross-edition-leak-safe) | A2/A3 → B2/B3 | Approved |
| Ignore benign Next image-optimizer `net::ERR_ABORTED` responsive-candidate cancellations (404s + all other errors stay fatal) | A4 → B4 | Approved |

### External-data action

Nine 1989–1992 editions (`1990-09-26`, `1990-10-31`, `1990-12-12`, `1991-02-07`,
`1991-04-24`, `1991-09-11`, `1991-11-19`, `1992-02-11`, `1992-03-24`) were absent from
R2 — never observed by the earlier truncated sweeps (desktop died at #11 on weather,
mobile at #268 on 1989-10-25). Per user decision they were restored to R2 via
`images:upload` (137 objects) from existing local sources. `1989-10-25/0004` is
intentionally left absent as the single documented `ASSET-001` external-data deferral;
restoring it stays outside front-end scope.
